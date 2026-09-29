"""
Speech-to-text A/B test on YOUR voice.

1. Turn test mode on (no restart needed):      python evals/stt_ab.py on
2. Open the waiter and read the SENTENCES below, one per mic press, in order.
   Every utterance goes to both engines; the audio and both transcripts are saved (qravy.stt_ab).
3. Report (optionally replaying the saved audio through extra variants — a few cents):
       python evals/stt_ab.py report --minutes 60 --rerun
4. Turn it off:                                 python evals/stt_ab.py off

Scores are character error rates (CER) against the sentence you read: 0% = perfect. English words in a
transcript are converted to Bangla script first, so "French Fry" and "ফ্রেঞ্চ ফ্রাই" count as the same.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import os
import re
import sys
import wave
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SENTENCES = [
    "একটা স্পেশাল ফ্রাইড প্রন আর দুইটা ফ্রেঞ্চ ফ্রাই দিন",
    "বিফ উইথ রেড কারি কি খুব ঝাল?",
    "আমরা দুইজন, কী খাওয়া যায় বলেন তো?",
    "চিকেন কর্ন স্যুপের দাম কত?",
    "সেট মেনু এ থ্রিতে কী কী আছে?",
    "ঝাল কম দিয়ে একটা মাসালা চিকেন দিন",
    "স্প্রিং রোলটা বাদ দেন",
    "ডেজার্ট কিছু আছে?",
    "এক বোতল পানি দেন",
    "আর কিছু লাগবে না, অর্ডারটা দিয়ে দিন",
    "হ্যাঁ, দিয়ে দিন",
    "বিলটা দিয়েন",
]

_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def norm(text: str) -> str:
    from bn_translit import to_bangla_script

    t = to_bangla_script(text or "").translate(_BN_DIGITS).lower()
    return re.sub(r"[\s\W_]+", "", t, flags=re.U)


def cer(ref: str, hyp: str) -> float:
    a, b = norm(ref), norm(hyp)
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return min(1.0, prev[-1] / len(a))


def pcm_from_wav(data: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(data), "rb") as w:
        return w.readframes(w.getnframes()), w.getframerate()


def db():
    from pymongo import MongoClient

    return MongoClient(os.environ.get("MONGO_URI", "mongodb://mongo:27017"))[os.environ.get("MONGO_DB", "qravy")]


def toggle(on: bool) -> None:
    db().settings.update_one({"_id": "stt_ab"}, {"$set": {"on": on, "at": datetime.utcnow()}}, upsert=True)
    print(f"A/B test mode {'ON' if on else 'OFF'} (takes effect within ~10 s)")


async def rerun(docs, tenant: str) -> None:
    import server as srv

    prompt = srv.stt_prompt(tenant, "bn")
    variants = {
        "groq+menu": lambda pcm, r: srv.groq_transcribe(pcm, "bn", rate=r, prompt=prompt),
        "openai_mini": lambda pcm, r: srv.openai_transcribe(pcm, "bn", rate=r, model="gpt-4o-mini-transcribe"),
        "gpt-4o+menu": lambda pcm, r: srv.openai_transcribe(pcm, "bn", rate=r, prompt=prompt, model="gpt-4o-transcribe"),
    }
    col = db().stt_ab
    for d in docs:
        pcm, rate = pcm_from_wav(bytes(d["wav"]))
        for name, fn in variants.items():
            if name in d["results"]:
                continue
            out, ms = await srv._timed(fn(pcm, rate))
            d["results"][name] = {"text": out, "ms": ms}
            col.update_one({"_id": d["_id"]}, {"$set": {f"results.{name}": {"text": out, "ms": ms}}})


def report(minutes: int, do_rerun: bool, tenant: str) -> None:
    since = datetime.utcnow() - timedelta(minutes=minutes)
    docs = list(db().stt_ab.find({"ts": {"$gte": since}}).sort("ts", 1))
    # the language retry can transcribe the same clip twice — keep the first of any pair within 2 s
    uniq = []
    for d in docs:
        if uniq and (d["ts"] - uniq[-1]["ts"]).total_seconds() < 2 and d.get("session") == uniq[-1].get("session"):
            continue
        uniq.append(d)
    if not uniq:
        print(f"No A/B clips in the last {minutes} minutes. Turn it on (python evals/stt_ab.py on) and talk to the waiter.")
        return
    if do_rerun:
        asyncio.run(rerun(uniq, tenant))

    engines = []
    for d in uniq:
        for k in d["results"]:
            if k not in engines:
                engines.append(k)
    scores = {e: [] for e in engines}
    ms = {e: [] for e in engines}
    def closest(d):
        """Guests repeat or skip a sentence — match each clip to the sentence the best engine heard."""
        best = min(
            ((min(cer(s, (r or {}).get("text") or "") for r in d["results"].values()), s) for s in SENTENCES),
            key=lambda x: x[0],
        )
        return best[1] if best[0] < 0.6 else None

    for i, d in enumerate(uniq):
        ref = closest(d)
        print(f"\n#{i + 1}  {(d['ts'] + timedelta(hours=6)).strftime('%H:%M:%S')}" + (f"   YOU READ: {ref}" if ref else ""))
        for e in engines:
            r = d["results"].get(e) or {}
            text = r.get("text") or "(nothing)"
            score = ""
            if ref:
                c = cer(ref, r.get("text") or "")
                scores[e].append(c)
                score = f"  [{c:.0%} wrong]"
            if r.get("ms"):
                ms[e].append(r["ms"])
            print(f"   {e:18s} {text}{score}")

    print("\n==================== SUMMARY (lower is better)")
    for e in sorted(engines, key=lambda k: (sum(scores[k]) / len(scores[k])) if scores[k] else 9):
        avg = sum(scores[e]) / len(scores[e]) if scores[e] else None
        spd = sum(ms[e]) / len(ms[e]) / 1000 if ms[e] else None
        print(f"  {e:18s} error {avg:.0%}" if avg is not None else f"  {e:18s} error n/a", end="")
        print(f"   avg time {spd:.1f}s" if spd else "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["on", "off", "report", "sentences"])
    ap.add_argument("--minutes", type=int, default=120)
    ap.add_argument("--rerun", action="store_true", help="also try groq+menu, openai without menu, gpt-4o-transcribe")
    ap.add_argument("--tenant", default="burger-house")
    a = ap.parse_args()
    if a.cmd in ("on", "off"):
        toggle(a.cmd == "on")
    elif a.cmd == "sentences":
        for i, s in enumerate(SENTENCES, 1):
            print(f"{i:2d}. {s}")
    else:
        report(a.minutes, a.rerun, a.tenant)


if __name__ == "__main__":
    main()
