"""Would LIVE speech-to-text (ElevenLabs Scribe v2 Realtime, words written WHILE the guest talks) hear our guests as well
as today's whole-recording ElevenLabs call — and how much sooner is the text ready? Replays the saved guest clips
(voice_clips, kept 7 days) at real speaking speed through both, side by side. Read-only: it changes nothing; it only
uses ElevenLabs credits (≈ 2 × the clips' length).

Run INSIDE the waiter container (it has the clips, the ElevenLabs key and ffmpeg):
  docker compose -f compose.production.yml cp services/ai-waiter-service/scripts/stt_live_check.py \
      ai-waiter-service:/app/scripts/stt_live_check.py
  docker compose -f compose.production.yml exec ai-waiter-service python scripts/stt_live_check.py --n 30
Options: --n 30 (clips, newest first)  --tenant <subdomain>  --no-batch (live only)  --fast (no real-time pacing)
"""
import argparse
import asyncio
import base64
import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
import websockets  # noqa: E402
from bson import ObjectId  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from rapidfuzz import fuzz  # noqa: E402

import stt_engines  # noqa: E402  (today's whole-recording call, exactly as the waiter makes it)
from bn_translit import to_bangla_script  # noqa: E402

KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
CLIENT = MongoClient(os.environ.get("MONGO_URI", "mongodb://mongo:27017"))
DB = CLIENT[os.environ.get("MONGO_DB", "qravy")]
MENU_DB = CLIENT[os.environ.get("MENU_DB", os.environ.get("MONGO_DB", "qravy"))]
ITEMS = MENU_DB[os.environ.get("MENU_COLLECTION", "menu_items")]
RATE = 16000
CHUNK_MS = 100
LIVE_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
URL_BUDGET = 7000  # (the dish names travel in the address of the live connection — kept to a safe length)


def credits() -> Optional[Tuple[int, int]]:
    try:
        r = httpx.get("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": KEY}, timeout=15)
        d = r.json()
        return int(d.get("character_count") or 0), int(d.get("character_limit") or 0)
    except Exception:
        return None


def to_pcm(mp3: bytes) -> bytes:
    return subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1",
                           "-ar", str(RATE), "pipe:1"], input=mp3, capture_output=True, timeout=30, check=True).stdout


_TERMS: Dict[Tuple[str, str], List[str]] = {}


def keyterms(tenant: str, lang: str) -> List[str]:
    """The menu's dish names as the guest says them — the same hint the waiter gives ElevenLabs today."""
    key = (tenant or "", lang)
    if key in _TERMS:
        return _TERMS[key]
    tid = None
    for coll in (DB.tenants, MENU_DB.tenants):
        t = coll.find_one({"$or": [{"slug": tenant}, {"subdomain": tenant}, {"code": tenant}, {"name": tenant}]},
                          {"_id": 1})
        if t:
            tid = t["_id"]
            break
    names: List[str] = []
    if tid is not None:
        for d in ITEMS.find({"tenantId": tid, "status": "active", "hidden": False}, {"name": 1}).limit(400):
            n = re.sub(r"\s+", " ", re.sub(r"\s*\(.*?\)\s*", " ", str(d.get("name") or ""))).strip()
            if n:
                names.append(to_bangla_script(n) if lang == "bn" else n)
    terms = [k for k in dict.fromkeys(names) if 1 < len(k) <= 50 and len(k.split()) <= 5][:100]
    _TERMS[key] = terms
    return terms


def live_url(lang: str, terms: List[str]) -> Tuple[str, int]:
    q: List[Tuple[str, str]] = [("model_id", "scribe_v2_realtime"), ("audio_format", "pcm_16000"),
                                ("language_code", "en" if lang == "en" else "bn"), ("commit_strategy", "manual")]
    used = 0
    for k in terms:
        trial = urllib.parse.urlencode(q + [("keyterms", k)])
        if len(trial) > URL_BUDGET:
            break
        q.append(("keyterms", k))
        used += 1
    return LIVE_URL + "?" + urllib.parse.urlencode(q), used


async def live(pcm: bytes, lang: str, terms: List[str], pace: bool) -> Dict[str, Any]:
    """Stream the clip as if the guest were speaking now; the text, and how long after their last word it was final."""
    url, used = live_url(lang, terms)
    out: Dict[str, Any] = {"text": None, "after_end_ms": None, "first_partial_ms": None, "terms": used, "error": None}
    step = RATE * 2 * CHUNK_MS // 1000
    try:
        async with websockets.connect(url, extra_headers={"xi-api-key": KEY}, max_size=None, open_timeout=15) as ws:
            t0 = time.monotonic()
            t_end: Optional[float] = None
            got: List[str] = []

            async def send() -> None:
                nonlocal t_end
                for i in range(0, len(pcm), step):
                    last = i + step >= len(pcm)
                    await ws.send(json.dumps({"message_type": "input_audio_chunk", "sample_rate": RATE,
                                              "audio_base_64": base64.b64encode(pcm[i:i + step]).decode(),
                                              "commit": last}))
                    if last:
                        t_end = time.monotonic()  # the guest's last word
                    elif pace:
                        await asyncio.sleep(CHUNK_MS / 1000)

            sender = asyncio.create_task(send())
            try:
                while True:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                    kind = msg.get("message_type")
                    if kind == "partial_transcript" and out["first_partial_ms"] is None and msg.get("text"):
                        out["first_partial_ms"] = int((time.monotonic() - t0) * 1000)
                    elif kind in ("committed_transcript", "committed_transcript_with_timestamps"):
                        got.append(str(msg.get("text") or "").strip())
                        if t_end is not None:
                            out["after_end_ms"] = int((time.monotonic() - t_end) * 1000)
                            break
                    elif "error" in str(kind) or kind in ("auth_error", "quota_exceeded", "rate_limited",
                                                          "input_error", "invalid_request", "insufficient_audio_activity"):
                        out["error"] = f"{kind}: {msg.get('error')}"
                        break
            finally:
                sender.cancel()
            out["text"] = " ".join(t for t in got if t).strip()
    except Exception as e:  # noqa: BLE001
        out["error"] = repr(e)[:200]
    return out


async def batch(pcm: bytes, lang: str, terms: List[str]) -> Dict[str, Any]:
    """Today's call: the whole recording after the guest stopped."""
    t = time.monotonic()
    text, err = await stt_engines.elevenlabs(pcm, RATE, terms, timeout_s=15, language="eng" if lang == "en" else "ben")
    return {"text": text, "after_end_ms": int((time.monotonic() - t) * 1000), "error": err or None}


def norm(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[।.,!?;:\"'()\-–—]", " ", str(s or ""))).strip().lower()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--tenant")
    ap.add_argument("--no-batch", action="store_true")
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    if not KEY:
        sys.exit("ELEVENLABS_API_KEY is not set in this container")

    q: Dict[str, Any] = {"audio": {"$exists": True}, "text": {"$nin": [None, ""]}}
    if a.tenant:
        q["tenant"] = a.tenant
    turns = list(DB.transcripts.find(q, {"audio": 1, "text": 1, "tenant": 1, "engine": 1, "ai.meta.language": 1})
                 .sort("ts", -1).limit(a.n * 2))
    before = credits()
    print(f"clips to test: up to {a.n} · ElevenLabs credits used/limit before: {before}")
    rows: List[Dict[str, Any]] = []
    for t in turns:
        if len(rows) >= a.n:
            break
        try:
            clip = DB.voice_clips.find_one({"_id": ObjectId(str(t["audio"]))})
        except Exception:
            clip = None
        if not clip or not clip.get("audio"):
            continue  # (older than 7 days: already deleted)
        lang = "en" if (t.get("ai") or {}).get("meta", {}).get("language") == "en" else "bn"
        pcm = to_pcm(bytes(clip["audio"]))
        terms = keyterms(str(t.get("tenant") or ""), lang)
        lv = await live(pcm, lang, terms, pace=not a.fast)
        bt = None if a.no_batch else await batch(pcm, lang, terms[:lv["terms"]] if lv["terms"] else terms)
        row = {"tenant": t.get("tenant"), "sec": round(len(pcm) / 2 / RATE, 1), "lang": lang,
               "heard_then": t.get("text"), "engine_then": t.get("engine"),
               "live": lv, "batch_now": bt,
               "same_as_batch": (bt is not None and norm(lv["text"]) == norm(bt["text"])),
               "similar_to_batch": (fuzz.ratio(norm(lv["text"]), norm(bt["text"])) if bt else None)}
        rows.append(row)
        print(f"\n#{len(rows)} {row['tenant']} · {row['sec']}s · {lang} · heard then ({row['engine_then']}): {row['heard_then']}")
        print(f"   live : {lv['text']!r}  — ready {lv['after_end_ms']} ms after the last word"
              + (f"  ERROR {lv['error']}" if lv["error"] else ""))
        if bt:
            print(f"   whole: {bt['text']!r}  — ready {bt['after_end_ms']} ms after the last word"
                  + (f"  ERROR {bt['error']}" if bt["error"] else "")
                  + f"   (same: {row['same_as_batch']}, similarity {row['similar_to_batch']}%)")

    ok = [r for r in rows if not r["live"]["error"] and r["live"]["after_end_ms"] is not None]
    print("\n================ summary ================")
    print(f"clips tested: {len(rows)} · live answered: {len(ok)}")
    if ok:
        print(f"live  — text ready after the last word: median {statistics.median(r['live']['after_end_ms'] for r in ok)} ms")
    both = [r for r in ok if r["batch_now"] and not r["batch_now"]["error"]]
    if both:
        print(f"whole — text ready after the last word: median {statistics.median(r['batch_now']['after_end_ms'] for r in both)} ms")
        print(f"same words as today's method: {sum(r['same_as_batch'] for r in both)} of {len(both)} · "
              f"average similarity {round(statistics.mean(r['similar_to_batch'] for r in both))}%")
        diff = [r for r in both if not r["same_as_batch"]]
        if diff:
            print("\ndifferent (check which one is right — listen in the conversations page):")
            for r in diff:
                print(f"  live : {r['live']['text']}\n  whole: {r['batch_now']['text']}\n")
    after = credits()
    print(f"ElevenLabs credits used/limit after: {after}"
          + (f" (this test used {after[0] - before[0]})" if before and after else ""))
    with open("/tmp/stt_live_check.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1, default=str)
    print("all results: /tmp/stt_live_check.json")


if __name__ == "__main__":
    asyncio.run(main())
