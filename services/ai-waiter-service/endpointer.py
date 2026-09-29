"""Hands-free turn-taking in a noisy restaurant: WHEN has this guest finished speaking — or did nobody speak?

Runs on the server, on the audio as it streams in (the guest's phone downloads nothing extra):
- Silero VAD (the model faster-whisper ships) says, every 32 ms, how likely the sound is human SPEECH — not
  clatter, music or a chair.
- The ROOM's level is measured all the time ("minimum statistics": the quiet gaps between words are the room).
- The GUEST's own voice level is learned: the phone is at their mouth, so their voice arrives far louder than the
  next table's (restaurants run ~65–85 dBA, but the guest is ~10 cm away, the next table 1–2 m). Within a turn, once
  they've started, only speech near THEIR level keeps the turn open — other people's talk doesn't. In a listen window
  after a question, their level from the previous turn (`ref_db`) is the bar — so the next table can't start a turn.

Events from push(): "start" (the guest began speaking), "end" (quiet for END_MS after speech — send the turn),
"silence" (a listen window passed and nobody spoke — close quietly, no reply). Tunable by env for real restaurants.
"""

import os
from collections import deque
from typing import Deque, List, Optional

import numpy as np

RATE = 16000
FRAME = 512  # 32 ms at 16 kHz — Silero's frame
END_MS = int(os.environ.get("VAD_END_MS", "1000"))  # this much quiet after speech = they're done
MIN_SPEECH_MS = int(os.environ.get("VAD_MIN_SPEECH_MS", "250"))  # shorter than this is a cough / clink
MARGIN_DB = float(os.environ.get("VAD_MARGIN_DB", "10"))  # speech must be this far above the room to start
REF_DROP_DB = float(os.environ.get("VAD_REF_DROP_DB", "6"))  # in a listen window: within this of the guest's level
KEEP_DROP_DB = float(os.environ.get("VAD_KEEP_DROP_DB", "16"))  # mid-turn: softer syllables down to this still count
SPEECH_PROB = float(os.environ.get("VAD_SPEECH_PROB", "0.5"))
KEEP_PROB = 0.3  # once speaking, a softer frame still counts (hysteresis)
FLOOR_MIN_DB = -75.0
_ROOM_FRAMES = 94  # ~3 s of sound to estimate the room's level from
_WARMUP = 6  # ~0.2 s heard before anything can start

_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper.vad import get_vad_model  # the Silero model faster-whisper ships (no download)

        _MODEL = get_vad_model()
    return _MODEL


def available() -> bool:
    try:
        _model()
        return True
    except Exception as e:  # no onnxruntime / model → the app keeps tap-to-send
        print("[endpointer] Silero VAD unavailable:", e)
        return False


def _db(frame: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(frame * frame))) if frame.size else 0.0
    return 20.0 * np.log10(max(rms, 1e-6))


class Endpointer:
    def __init__(self, rate: int = RATE, listen_ms: Optional[int] = None, ref_db: Optional[float] = None,
                 end_ms: int = END_MS, min_speech_ms: int = MIN_SPEECH_MS, margin_db: float = MARGIN_DB):
        self.rate = rate
        self.listen_frames = int(listen_ms / 32) if listen_ms else None
        self.ref_db = ref_db  # the guest's voice level from their previous turn (same phone, same distance)
        self.end_frames = max(1, int(end_ms / 32))
        self.min_frames = max(1, int(min_speech_ms / 32))
        self.margin = margin_db
        self.state = _model().get_initial_state(batch_size=1)
        self.buf = np.zeros(0, dtype=np.float32)
        self.room: Deque[float] = deque(maxlen=_ROOM_FRAMES)
        self.voice: List[float] = []  # this guest's speech frames (dB) this turn
        self.voice_frames: List[np.ndarray] = []  # …and their audio — for the voice match (voiceprint.py)
        self.frames = 0
        self.speech = 0
        self.quiet = 0
        self.started = False
        self.done: Optional[str] = None

    def floor(self) -> Optional[float]:
        """The room's level (dBFS): a low percentile of the last ~3 s. None until ~0.2 s has been heard."""
        if len(self.room) < _WARMUP:
            return None
        return max(FLOOR_MIN_DB, float(np.percentile(np.array(self.room), 10)))

    def voice_level(self) -> Optional[float]:
        """The guest's own speaking level this turn (dBFS) — the bar for their next listen window."""
        return float(np.percentile(np.array(self.voice), 70)) if len(self.voice) >= self.min_frames else None

    def speech_audio(self) -> np.ndarray:
        """Only the guest's own speech this turn (16 kHz float32) — no silence, no quieter background."""
        return np.concatenate(self.voice_frames) if self.voice_frames else np.zeros(0, np.float32)

    @property
    def listen_window(self) -> bool:
        """This turn was an automatic listen window (the mic reopened by itself), not a tap."""
        return self.listen_frames is not None

    def _starts(self, prob: float, db: float) -> bool:
        f = self.floor()
        if f is None or prob < SPEECH_PROB or db < f + self.margin:
            return False
        return self.ref_db is None or db >= self.ref_db - REF_DROP_DB

    def _keeps(self, prob: float, db: float) -> bool:
        f = self.floor() or FLOOR_MIN_DB
        level = self.voice_level()
        bar = max(f + self.margin * 0.5, (level - KEEP_DROP_DB) if level is not None else -1e9)
        return prob >= KEEP_PROB and db >= bar

    def push(self, pcm16: bytes) -> Optional[str]:
        """Feed raw PCM16 mono; returns "start" / "end" / "silence" when something happened, else None."""
        if self.done:
            return None
        x = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        if self.rate != RATE and x.size:
            n = int(round(x.size * RATE / self.rate))
            x = np.interp(np.linspace(0, x.size - 1, n), np.arange(x.size), x).astype(np.float32)
        self.buf = np.concatenate([self.buf, x])
        event: Optional[str] = None
        while self.buf.size >= FRAME and not self.done:
            frame, self.buf = self.buf[:FRAME], self.buf[FRAME:]
            self.frames += 1
            out, self.state = _model()(frame, self.state, RATE)
            prob = float(np.asarray(out).reshape(-1)[0])
            db = _db(frame)
            self.room.append(db)
            if self.started:
                if self._starts(prob, db):
                    self.voice.append(db)
                if self._keeps(prob, db):
                    self.quiet = 0
                    self.voice_frames.append(frame)
                else:
                    self.quiet += 1
                    if self.quiet >= self.end_frames:
                        self.done = event = "end"
            else:
                if self._starts(prob, db):
                    self.speech += 1
                    self.voice.append(db)
                    self.voice_frames.append(frame)
                    self.quiet = 0
                    if self.speech >= self.min_frames:
                        self.started = True
                        event = "start"
                else:
                    self.quiet += 1
                    if self.quiet > 8:  # a short blip long ago doesn't add up to a sentence
                        self.speech, self.voice, self.voice_frames = 0, [], []
                if not self.started and self.listen_frames and self.frames >= self.listen_frames:
                    self.done = event = "silence"
        return event
