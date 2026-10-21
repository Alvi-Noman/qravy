"""Other speech-to-text engines: Gemini (the mic test page only) and ElevenLabs Scribe — on the mic test page, and as
the waiter's own ears at the restaurants switched to it in Cortex (server.py cloud_transcribe; gpt-4o is the backup).
Keys in the waiter's env: GEMINI_API_KEY, ELEVENLABS_API_KEY (unset → "not set up")."""
import asyncio
import base64
import io
import os
import re
import time
import wave
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_STT_MODEL", "gemini-flash-latest").strip()
_gemini_model = GEMINI_MODEL  # (moves on to the model Google names when it retires this one)
ELEVEN_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ELEVEN_MODEL = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v2").strip()
_eleven_model = ELEVEN_MODEL  # (back to scribe_v1 if this account has no v2)
_keyterms_ok = True
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


async def elevenlabs(pcm16: bytes, rate: int, keyterms: Optional[List[str]] = None,
                     timeout_s: float = TIMEOUT_S, language: str = "ben") -> Tuple[Optional[str], str]:
    """(transcript, error) from ElevenLabs Scribe, told the language is Bangla — and, with `keyterms`, the menu's dish
    names to listen for (Scribe v2). Credits used up → STATUS["out"] (the waiter goes back to gpt-4o)."""
    global _eleven_model, _keyterms_ok
    if not ELEVEN_KEY:
        return None, "not set up (ELEVENLABS_API_KEY)"
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as c:
            for _ in range(3):
                data: List[Tuple[str, str]] = [("model_id", _eleven_model), ("language_code", language),
                                               ("tag_audio_events", "false")]
                if keyterms and _keyterms_ok:
                    data += [("keyterms", k) for k in keyterms[:100]]
                r = await c.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": ELEVEN_KEY},
                                 data=data, files={"file": ("audio.wav", _wav(pcm16, rate), "audio/wav")})
                low = r.text.lower()
                if r.status_code in (400, 422) and "keyterm" in low and _keyterms_ok:
                    _keyterms_ok = False  # (a model / account without keyterms: plain from now on)
                    continue
                if r.status_code in (400, 404, 422) and "model" in low and _eleven_model != "scribe_v1":
                    _eleven_model = "scribe_v1"  # (scribe_v2 not on this account: the one that is)
                    continue
                break
        if r.status_code >= 400:
            # the credits are used up (not a rate limit: a 429 is "too many at once", it passes)
            used_up = "quota_exceeded" in r.text or (
                r.status_code in (401, 402) and re.search(r"quota|credit|insufficient", r.text, re.I))
            if used_up:
                STATUS.update({"out": True, "outAt": time.time(), "lastError": r.text[:300]})
            return None, f"ElevenLabs error {r.status_code}: {r.text[:200]}"
        STATUS["out"] = False
        return str(r.json().get("text") or "").strip(), ""
    except Exception as e:  # noqa: BLE001
        return None, f"ElevenLabs failed: {e!r}"[:200]


# ---------- the account's credits, for Cortex ("ElevenLabs credits low — top up") ----------

STATUS: Dict[str, Any] = {"out": False}
LOW_SHARE = float(os.environ.get("ELEVENLABS_LOW_SHARE", "0.1"))  # below this share of the month's credits → "low"
LOW_CREDITS = int(os.environ.get("ELEVENLABS_LOW_CREDITS", "1000"))  # …or below this many (≈ 15 minutes of audio)


async def refresh_status(db: Any) -> Dict[str, Any]:
    """The account's credits now (GET /v1/user/subscription) → qravy.settings {_id: "elevenlabs_status"} for Cortex."""
    doc: Dict[str, Any] = {"configured": bool(ELEVEN_KEY), "checkedAt": datetime.utcnow(), "model": _eleven_model,
                           "out": bool(STATUS.get("out")), "lastError": STATUS.get("lastError")}
    if ELEVEN_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as c:
                r = await c.get("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": ELEVEN_KEY})
            if r.status_code < 400:
                s = r.json()
                used, limit = int(s.get("character_count") or 0), int(s.get("character_limit") or 0)
                left = max(0, limit - used)
                reset = s.get("next_character_count_reset_unix")
                doc.update({"used": used, "limit": limit, "left": left, "tier": s.get("tier"),
                            "resetsAt": datetime.utcfromtimestamp(reset) if reset else None,
                            "low": left < max(LOW_CREDITS, int(limit * LOW_SHARE)), "statusError": None})
                if left > 0 and STATUS.get("out") and time.time() - float(STATUS.get("outAt") or 0) > 600:
                    STATUS["out"] = False  # (topped up: back on)
                    doc["out"] = False
                if left <= 0:
                    STATUS.update({"out": True, "outAt": time.time()})
                    doc["out"] = True
            else:
                doc["statusError"] = f"{r.status_code}: {r.text[:200]}"
        except Exception as e:  # noqa: BLE001
            doc["statusError"] = repr(e)[:200]
    try:
        await asyncio.to_thread(db.settings.update_one, {"_id": "elevenlabs_status"}, {"$set": doc}, True)
    except Exception as e:  # noqa: BLE001
        print("[stt_engines] status save failed:", e)
    return doc
