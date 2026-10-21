"""What the guest SAID, as sound: each voice turn's audio, kept a few days so the restaurant (its AI conversations page)
and Qravy (Cortex) can play it next to what the speech-to-text heard — "আমার আস্তে দরকার ছিলো" makes sense once you
hear it.

A small MP3 per turn (mono, 24 kbps: ~3 KB a second, ~10 KB a turn) in its own collection (`voice_clips`), linked
from the turn by id (`transcripts.audio`), deleted by itself after VOICE_CLIP_DAYS (default 7). Only the people who
can read the transcripts can play them: the restaurant's owners / admins, and Cortex.
"""
import os
import subprocess
from datetime import datetime
from typing import Any, Dict, Optional

from bson import Binary, ObjectId

DAYS = int(os.environ.get("VOICE_CLIP_DAYS", "7"))
ON = os.environ.get("VOICE_CLIPS", "on").lower() not in ("0", "off", "false")
MAX_SECONDS = 60  # (a turn longer than this is noise left running — not kept)

_coll = None


def attach(db: Any) -> None:
    """The collection, and the index that deletes a clip DAYS after it was said."""
    global _coll
    _coll = db.voice_clips
    try:
        _coll.create_index("at", expireAfterSeconds=DAYS * 24 * 3600, name=f"ttl_{DAYS}d")
    except Exception as e:  # an index with another expiry already there (VOICE_CLIP_DAYS changed) — keep going
        print("[voice_clips] ttl index:", e)
    try:
        _coll.create_index([("tenant", 1), ("at", -1)], name="tenant_at")
    except Exception:
        pass


def to_mp3(pcm16: bytes, rate: int = 16000) -> Optional[bytes]:
    """Raw PCM16 mono → a small MP3 (ffmpeg, already in the image). None if it can't be encoded."""
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0",
             "-c:a", "libmp3lame", "-b:a", "24k", "-ar", "16000", "-f", "mp3", "pipe:1"],
            input=pcm16, capture_output=True, timeout=20, check=True,
        )
        return out.stdout or None
    except Exception as e:
        print("[voice_clips] encode failed:", e)
        return None


def save(pcm16: bytes, rate: int, tenant: Optional[str], session: Optional[str], location: Optional[str]) -> Optional[str]:
    """Keep this turn's audio; its id (to put on the turn), or None (off / too short / too long / failed)."""
    if not ON or _coll is None or not pcm16:
        return None
    seconds = len(pcm16) / 2 / max(rate, 1)
    if seconds < 0.3 or seconds > MAX_SECONDS:
        return None
    mp3 = to_mp3(pcm16, rate)
    if not mp3:
        return None
    try:
        res = _coll.insert_one({
            "at": datetime.utcnow(), "tenant": tenant, "session": session, "location": location,
            "mime": "audio/mpeg", "ms": int(seconds * 1000), "bytes": len(mp3), "audio": Binary(mp3),
        })
        return str(res.inserted_id)
    except Exception as e:
        print("[voice_clips] save failed:", e)
        return None


def get(clip_id: str) -> Optional[Dict[str, Any]]:
    """The clip ({tenant, mime, audio, …}) — or None (unknown id, or already deleted)."""
    if _coll is None:
        return None
    try:
        return _coll.find_one({"_id": ObjectId(clip_id)})
    except Exception:
        return None
