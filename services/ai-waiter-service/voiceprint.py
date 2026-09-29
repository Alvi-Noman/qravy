"""Is it the same guest? — voice matching for hands-free listen windows.

When the mic reopens by itself after the waiter's question, a loud person at the next table could otherwise answer
for the guest. So the guest's voice is learned from the turns THEY started (a tap), and an automatic listen window's
answer only counts if it sounds like them.

- Model: 3D-Speaker ERes2Net (Apache-2.0, ~39 MB, 16 kHz) through sherpa-onnx — runs on the server's CPU
  (~30 ms per second of speech); guests download nothing.
- Judged on the WHOLE answer once it ends (1 s alone isn't reliable — tested), and only rejected when CLEARLY
  someone else (similarity < VOICE_MATCH_MIN, 0.2): on real guest recordings that never rejected the guest, while
  rejecting ~95% of other speakers. Answers under 0.8 s of speech ("হ্যাঁ") aren't judged — too short to tell.
- The voiceprint is 512 numbers in server memory for that conversation only — never stored, never sent anywhere.
"""

import os
from typing import Dict, Optional, Tuple

import numpy as np

MODEL = os.environ.get("SPEAKER_MODEL", "/app/models/speaker.onnx")
MATCH_MIN = float(os.environ.get("VOICE_MATCH_MIN", "0.2"))
MIN_JUDGE_S = 0.8  # shorter answers can't be told apart — the loudness checks decide
MIN_ENROLL_S = 1.0

_EX = None
_FAILED = False
_PRINTS: Dict[str, Tuple[np.ndarray, int]] = {}  # session → (mean voiceprint, turns learned from)


def available() -> bool:
    global _EX, _FAILED
    if _EX is not None:
        return True
    if _FAILED or not os.path.exists(MODEL):
        return False
    try:
        import sherpa_onnx

        _EX = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=MODEL, num_threads=1)
        )
        return True
    except Exception as e:
        _FAILED = True
        print("[voiceprint] unavailable (voice matching off):", e)
        return False


def embed(samples: np.ndarray) -> Optional[np.ndarray]:
    """float32 16 kHz mono → a unit-length voiceprint (None if too short / unavailable)."""
    if not available() or samples is None or samples.size < MIN_JUDGE_S * 16000:
        return None
    s = _EX.create_stream()
    s.accept_waveform(16000, np.ascontiguousarray(samples, dtype=np.float32))
    s.input_finished()
    e = np.asarray(_EX.compute(s), dtype=np.float32)
    n = float(np.linalg.norm(e))
    return e / n if n > 0 else None


def learn(session: Optional[str], samples: np.ndarray) -> None:
    """A turn the guest started themselves (a tap) → their voice. Averaged over turns."""
    if not session or samples is None or samples.size < MIN_ENROLL_S * 16000:
        return
    e = embed(samples)
    if e is None:
        return
    old = _PRINTS.get(session)
    if old is None:
        _PRINTS[session] = (e, 1)
    else:
        mean, n = old
        m = (mean * n + e) / (n + 1)
        _PRINTS[session] = (m / float(np.linalg.norm(m)), min(n + 1, 20))
    if len(_PRINTS) > 5000:
        _PRINTS.pop(next(iter(_PRINTS)))


def same_guest(session: Optional[str], samples: np.ndarray) -> Tuple[Optional[bool], Optional[float]]:
    """(True / False / None = can't tell, similarity). None when we don't know their voice yet or it's too short."""
    known = _PRINTS.get(session or "")
    if known is None:
        return None, None
    e = embed(samples)
    if e is None:
        return None, None
    score = float(known[0] @ e)
    return score >= MATCH_MIN, score


def forget(session: Optional[str]) -> None:
    _PRINTS.pop(session or "", None)
