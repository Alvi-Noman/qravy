"""Other speech-to-text engines, for the mic test page only (server.py /stt-test): the same clip through Gemini and
ElevenLabs Scribe next to the waiter's own gpt-4o-transcribe, to see which hears Bangla best. The waiter itself
doesn't use these. Keys in the waiter's env: GEMINI_API_KEY, ELEVENLABS_API_KEY (unset → "not set up")."""
import base64
import io
import os
import re
import wave
from typing import Optional, Tuple

import httpx

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_STT_MODEL", "gemini-flash-latest").strip()
_gemini_model = GEMINI_MODEL  # (moves on to the model Google names when it retires this one)
ELEVEN_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ELEVEN_MODEL = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v1").strip()
TIMEOUT_S = 20.0


def _wav(pcm16: bytes, rate: int) -> bytes:
    bio = io.BytesIO()
    with wave.open(bio, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16)
    return bio.getvalue()


async def gemini(pcm16: bytes, rate: int, menu_words: str = "") -> Tuple[Optional[str], str]:
    """(transcript, error). Told it's a guest ordering at a restaurant in Bangla, and the menu's words when given."""
    if not GEMINI_KEY:
        return None, "not set up (GEMINI_API_KEY)"
    ask = ("Transcribe this audio exactly as spoken. It is a guest speaking Bangla (Bengali) to a restaurant's "
           "waiter. Write Bangla in Bengali script; keep English words the way they were said. Don't translate, "
           "correct or add anything. Output only the transcript.")
    if menu_words:
        ask += f" Words that may come up (the menu): {menu_words}"
    body = {
        "contents": [{"parts": [{"text": ask},
                                {"inline_data": {"mime_type": "audio/wav",
                                                 "data": base64.b64encode(_wav(pcm16, rate)).decode()}}]}],
        "generationConfig": {"temperature": 0, "thinkingConfig": {"thinkingBudget": 0}},
    }
    global _gemini_model
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            for _ in range(3):
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{_gemini_model}:generateContent"
                r = await c.post(url, json=body, headers={"x-goog-api-key": GEMINI_KEY})
                if r.status_code == 404:
                    # a model Google retired: its error names the one to use ("…use models/gemini-3.8-flash…")
                    named = [n for n in re.findall(r"models/(gemini-[\w.\-]*\w)", r.text) if n != _gemini_model]
                    if named:
                        _gemini_model = named[0]
                        continue
                if r.status_code == 400 and "thinking" in r.text.lower() and "thinkingConfig" in body["generationConfig"]:
                    body["generationConfig"].pop("thinkingConfig")  # (a newer model with another thinking setting)
                    continue
                break
        if r.status_code >= 400:
            return None, f"Gemini ({_gemini_model}) error {r.status_code}: {r.text[:200]}"
        parts = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        return " ".join(str(p.get("text") or "") for p in parts if not p.get("thought")).strip(), ""
    except Exception as e:  # noqa: BLE001
        return None, f"Gemini failed: {e!r}"[:200]


async def elevenlabs(pcm16: bytes, rate: int) -> Tuple[Optional[str], str]:
    """(transcript, error) from ElevenLabs Scribe, told the language is Bangla."""
    if not ELEVEN_KEY:
        return None, "not set up (ELEVENLABS_API_KEY)"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            r = await c.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": ELEVEN_KEY},
                data={"model_id": ELEVEN_MODEL, "language_code": "ben", "tag_audio_events": "false"},
                files={"file": ("audio.wav", _wav(pcm16, rate), "audio/wav")},
            )
        if r.status_code >= 400:
            return None, f"ElevenLabs error {r.status_code}: {r.text[:200]}"
        return str(r.json().get("text") or "").strip(), ""
    except Exception as e:  # noqa: BLE001
        return None, f"ElevenLabs failed: {e!r}"[:200]
