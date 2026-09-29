"""
Review REAL guest conversations — free (no AI calls). Reads the transcripts the waiter already stores
(qravy.transcripts) and reports what to look at:

  - volume, languages, recommendation modes
  - how often the safety net fired (meta.guards) and on which turns
  - model outages / apologies
  - recommendation acceptance: suggested or paired dishes the guest then ordered in the same session

Run inside the ai-waiter container:
  docker exec -w /tmp/waiter qravy-ai-waiter-service-1 python evals/review_transcripts.py --days 7
  (add --tenant burger-house to filter, --show 30 for more flagged turns)

Turn the flagged ones into eval cases (evals/cases.py) so they never regress.
"""
from __future__ import annotations

import argparse
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from pymongo import MongoClient

APOLOGY = ("having a little trouble", "didn't catch that", "দুঃখিত, একটু সমস্যা", "দুঃখিত, শুনতে পাইনি")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--tenant", default="")
    ap.add_argument("--show", type=int, default=15)
    args = ap.parse_args()

    db = MongoClient(os.environ.get("MONGO_URI", "mongodb://mongo:27017"))[os.environ.get("MONGO_DB", "qravy")]
    q = {"ts": {"$gte": datetime.utcnow() - timedelta(days=args.days)}}
    if args.tenant:
        q["tenant"] = args.tenant
    rows = list(db.transcripts.find(q, {"session": 1, "text_norm": 1, "ai": 1, "ts": 1, "tenant": 1}).sort("ts", 1))
    if not rows:
        print(f"No conversations in the last {args.days} days.")
        return

    langs, modes, intents, guards = Counter(), Counter(), Counter(), Counter()
    fallback = apologies = 0
    flagged = []
    offered_by_session = defaultdict(set)
    accepted = offered_total = 0
    sessions = set()

    for r in rows:
        meta = (r.get("ai") or {}).get("meta") or {}
        reply = (r.get("ai") or {}).get("replyText") or ""
        sid = r.get("session") or "?"
        sessions.add(sid)
        langs[meta.get("language", "?")] += 1
        modes[meta.get("recoMode", "-")] += 1
        intents[meta.get("intent", "?")] += 1
        g = meta.get("guards") or []
        guards.update(g)
        if meta.get("fallback"):
            fallback += 1
        if any(a in reply for a in APOLOGY):
            apologies += 1
        if g or meta.get("fallback"):
            flagged.append((r.get("ts"), sid, r.get("text_norm"), reply, g or ["fallback"]))
        # acceptance: something we suggested earlier in the session gets added now
        for op in meta.get("cartOps") or []:
            if op.get("op") == "add" and op.get("itemId") in offered_by_session[sid]:
                accepted += 1
                offered_by_session[sid].discard(op["itemId"])
        new_offers = {s.get("itemId") for s in (meta.get("suggestions") or []) + (meta.get("upsell") or []) if s.get("itemId")}
        offered_total += len(new_offers - offered_by_session[sid])
        offered_by_session[sid] |= new_offers

    n = len(rows)
    pct = lambda x: f"{100 * x / max(1, n):.1f}%"  # noqa: E731
    print(f"\n=== Virtual waiter review — last {args.days} days{' — ' + args.tenant if args.tenant else ''}")
    print(f"turns: {n}   conversations: {len(sessions)}   avg turns/conversation: {n / max(1, len(sessions)):.1f}")
    print(f"languages: {dict(langs)}")
    print(f"intents: {dict(intents)}")
    print(f"recommendation modes: {dict(modes)}")
    print(f"AI unavailable (fallback): {fallback} ({pct(fallback)})   apologies: {apologies} ({pct(apologies)})")
    print(f"recommendations offered: {offered_total}   ordered afterwards: {accepted}"
          f"   acceptance: {100 * accepted / max(1, offered_total):.1f}%")
    print("\nsafety net (turns where it stepped in):")
    for tag, c in guards.most_common():
        print(f"  {tag:<28} {c:>5}  ({pct(c)} of turns)")
    if not guards:
        print("  nothing fired")
    print(f"\nflagged turns (latest {args.show}) — worth reading, then adding to evals/cases.py:")
    for ts, sid, said, reply, g in flagged[-args.show:]:
        print(f"- [{ts:%Y-%m-%d %H:%M}] {sid}  {', '.join(g)}")
        print(f"    guest:  {said}")
        print(f"    waiter: {reply}")


if __name__ == "__main__":
    main()
