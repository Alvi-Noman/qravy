# fine_tuning/export_transcripts.py
import argparse, json, os, sys, time, re
from datetime import datetime, timezone
from pymongo import MongoClient
from pymongo.errors import PyMongoError

SCRIPT_VERSION = "r4-dedupe-on-write+userIntended+notes+cs-fallback"
print("[export_transcripts] LOADED from:", __file__)

# --- simple script detectors for a tiny auto-note ---
_BN = re.compile(r"[\u0980-\u09FF]")       # Bengali
_EN = re.compile(r"[A-Za-z]")              # Latin
_NUM = re.compile(r"[0-9]")

def _auto_note(user_text: str) -> str:
    t = (user_text or "").strip()
    has_bn = bool(_BN.search(t))
    has_en = bool(_EN.search(t))
    if has_bn and has_en:
        return "User spoke broken Bangla-English mix."
    if has_bn:
        return "User spoke Bangla (may include ASR noise)."
    if has_en:
        return "User spoke English/Latin (may include ASR noise)."
    if _NUM.search(t):
        return "Contains numbers; verify amounts/quantities."
    return "Needs review; add intended clean sentence."

def iso_now():
    return datetime.now(timezone.utc).isoformat()

def today_path(outdir: str) -> str:
    day = datetime.utcnow().strftime("%Y%m%d")
    os.makedirs(outdir, exist_ok=True)
    return os.path.join(outdir, f"review_transcripts-{day}.jsonl")

def to_review_line(doc: dict) -> dict:
    """
    Shape one transcript doc into a review line:
      - Keep the raw user text as the user message
      - Include response with replyText/intent/language
      - ADD userIntended="" and a heuristic notes string
      - Preserve meta and a small _source block for traceability
    """
    user_text = (doc.get("text") or "").strip()
    ai = doc.get("ai") or {}
    meta = (ai.get("meta") or {})

    response = {
        "replyText": ai.get("replyText") or "",
        "intent": meta.get("intent"),
        "language": meta.get("language"),
        # 👇 fields for your review/labeling flow
        "userIntended": "",
        "notes": _auto_note(user_text),
        # keep model/tenant/etc. visible in review
        "meta": meta,
    }
    line = {
        "messages": [
            {"role": "system", "content": "Return ONLY JSON"},
            {"role": "user", "content": user_text}
        ],
        "response": response,
        "_source": {
            "_id": str(doc.get("_id")),
            "session": doc.get("session"),
            "engine": doc.get("engine"),
            "ts": (doc.get("ts").isoformat() if doc.get("ts") else None),
        }
    }
    return line

def _load_existing_ids(path: str) -> set[str]:
    ids = set()
    if not os.path.exists(path):
        return ids
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    sid = (((obj or {}).get("_source") or {}).get("_id"))
                    if sid:
                        ids.add(str(sid))
                except Exception:
                    # ignore malformed lines
                    continue
    except Exception:
        # if file cannot be read, treat as empty (don't block export)
        pass
    return ids

def write_lines(path: str, docs: list[dict]) -> int:
    if not docs:
        return 0
    existing_ids = _load_existing_ids(path)
    fresh = [d for d in docs if str(d.get("_id")) not in existing_ids]
    if not fresh:
        return 0
    with open(path, "a", encoding="utf-8") as f:
        for d in fresh:
            f.write(json.dumps(to_review_line(d), ensure_ascii=False) + "\n")
    skipped = len(docs) - len(fresh)
    if skipped:
        print(f"↪︎ skipped duplicates: {skipped} (already in {os.path.basename(path)})")
    return len(fresh)

def export_once(coll, outdir: str, mark_value: str, batch: int, *, force: bool = False, lastN: int = 0) -> int:
    """
    Export docs to today's review file.
      - default: only status=="new"
      - --force: ignore status
      - --lastN: export last N docs regardless of status (no marking)
    """
    if lastN > 0:
        docs = list(coll.find({"ai.replyText": {"$exists": True, "$ne": ""}})
                    .sort("_id", -1).limit(lastN))
        docs.reverse()  # chronological order in the output file
        mark_ids = []
    else:
        q = {"ai.replyText": {"$exists": True, "$ne": ""}}
        if not force:
            q["status"] = "new"
        docs = list(coll.find(q).sort("_id", 1).limit(batch))
        mark_ids = [d["_id"] for d in docs]

    if not docs:
        return 0

    path = today_path(outdir)
    n = write_lines(path, docs)

    if mark_ids and n > 0:
        coll.update_many({"_id": {"$in": mark_ids}},
                         {"$set": {"status": mark_value, "exportedAt": datetime.utcnow()}})
    print(f"📤 exported {n} -> {path} (force={force} lastN={lastN})")
    return n

def watch_forever(coll, outdir: str, mark_value: str, *, interval: float):
    """
    Prefer change streams; if unavailable, fall back to polling.
    Dedupe-on-write guarantees only one JSONL line per transcript _id.
    """
    try:
        pipeline = [{"$match": {"operationType": {"$in": ["insert", "replace", "update"]}}}]
        with coll.watch(pipeline=pipeline, full_document='updateLookup') as stream:
            print("👂 watching MongoDB change stream for new transcripts…")
            for ev in stream:
                try:
                    doc = ev.get("fullDocument") or {}
                    if (doc.get("status") == "new" and (doc.get("ai") or {}).get("replyText")):
                        path = today_path(outdir)
                        n = write_lines(path, [doc])
                        if n > 0:
                            coll.update_one({"_id": doc["_id"]},
                                            {"$set": {"status": mark_value,
                                                      "exportedAt": datetime.utcnow()}})
                            print(f"📤 exported 1 -> {path} (op={ev.get('operationType')})")
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    # Don't crash on individual events
                    print("⚠️ watcher event error:", repr(e))
    except PyMongoError as e:
        print("❌ change stream failed:", e)
        print(f"↩️ Falling back to polling every {interval}s… (replica set required for change streams)")
        try:
            while True:
                n = export_once(coll, outdir, mark_value, batch=100, force=False, lastN=0)
                time.sleep(interval if n == 0 else 0.2)
        except KeyboardInterrupt:
            print("\n🛑 polling stopped")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mongo", default=os.environ.get("MONGO_URI", "mongodb://localhost:27017"))
    ap.add_argument("--db", default="qravy")
    ap.add_argument("--coll", default="transcripts")
    ap.add_argument("--outdir", default="fine_tuning")
    ap.add_argument("--batch", type=int, default=100)
    ap.add_argument("--mark", default="exported", help="value to set in status after export")
    ap.add_argument("--once", action="store_true", help="export once then exit")
    ap.add_argument("--watch", action="store_true", help="use MongoDB Change Streams (stream forever)")
    ap.add_argument("--interval", type=float, default=5.0, help="poll seconds (fallback/legacy)")
    # convenience flags
    ap.add_argument("--force", action="store_true", help="export even if status != 'new'")
    ap.add_argument("--lastN", type=int, default=0, help="export last N docs regardless of status")
    ap.add_argument("--version", action="store_true", help="print script version and exit")
    args = ap.parse_args()

    if args.version:
        print("[export_transcripts] version:", SCRIPT_VERSION)
        sys.exit(0)

    client = MongoClient(args.mongo)
    coll = client[args.db][args.coll]

    if args.once:
        export_once(coll, args.outdir, args.mark, args.batch, force=args.force, lastN=args.lastN)
        return

    if args.watch:
        try:
            watch_forever(coll, args.outdir, args.mark, interval=args.interval)
        except KeyboardInterrupt:
            print("\n🛑 watcher stopped")
        return

    # Legacy polling daemon
    try:
        while True:
            n = export_once(coll, args.outdir, args.mark, args.batch, force=args.force, lastN=args.lastN)
            time.sleep(args.interval if n == 0 else 0.2)
    except KeyboardInterrupt:
        print("\n🛑 polling stopped")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
