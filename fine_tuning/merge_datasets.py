# fine_tuning/merge_datasets.py
"""
Merge & FIX multiple JSONL datasets into OpenAI chat fine-tune format.

Output format per line:
{"messages":[
  {"role":"system","content":"Return ONLY JSON"},
  {"role":"user","content":"..."},
  {"role":"assistant","content":"{\"replyText\":\"...\",\"intent\":\"...\",\"language\":\"bn\"}"}
]}

Key behaviors:
- Accepts mixed inputs having {"messages":[...], "response": {...}} or already FT-ready.
- Ensures last message is assistant; converts 'response' -> assistant content (JSON string).
- Injects a default system line if none exists.
- Dedupes on final 'messages'.
- Skips invalid/broken rows and reports counts.
"""

from __future__ import annotations
import argparse, glob, hashlib, io, json, os, random, sys
from typing import Dict, Iterable, List, Tuple, Any

DEFAULT_INPUTS = [
    "fine_tuning/menu_qa.jsonl",
    "fine_tuning/behavior.jsonl",
    "fine_tuning/robustness_noisy.jsonl",
    "fine_tuning/new_transcripts.jsonl",
]

DEFAULT_SYSTEM = "Return ONLY JSON"

def iter_jsonl(path: str) -> Iterable[Tuple[Dict[str, Any], int]]:
    with io.open(path, "r", encoding="utf-8") as f:
        for ln, line in enumerate(f, start=1):
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            try:
                yield json.loads(s), ln
            except Exception as e:
                print(f"[warn] {path}:{ln}: skip invalid JSON ({e})", file=sys.stderr)

def canon_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

def messages_fingerprint(msgs: List[Dict[str, str]]) -> str:
    # Fingerprint only the final messages array (post-fix) so dedupe matches output
    return hashlib.sha256(canon_dumps({"messages": msgs}).encode("utf-8")).hexdigest()

def as_str(x: Any) -> str:
    return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, separators=(",", ":"))

def to_assistant_content(resp: Dict[str, Any]) -> str:
    # Keep the keys you want the model to learn to emit
    keep: Dict[str, Any] = {}
    for k in ("replyText", "intent", "language", "items", "notes", "meta"):
        if k in resp:
            keep[k] = resp[k]
    return json.dumps(keep, ensure_ascii=False, separators=(",", ":"))

def normalize_messages(msgs: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if isinstance(msgs, dict):
        msgs = [msgs]
    if not isinstance(msgs, list):
        return out
    for m in msgs:
        if not isinstance(m, dict):
            continue
        role, content = m.get("role"), m.get("content")
        if isinstance(role, str) and isinstance(content, str):
            out.append({"role": role, "content": content})
    return out

def ensure_system(msgs: List[Dict[str, str]]) -> None:
    # If no system present, insert a default system as the first message
    if not any(m.get("role") == "system" for m in msgs):
        msgs.insert(0, {"role": "system", "content": DEFAULT_SYSTEM})

def last_is_assistant(msgs: List[Dict[str, str]]) -> bool:
    return bool(msgs) and msgs[-1].get("role") == "assistant" and isinstance(msgs[-1].get("content"), str)

def fix_example(ex: Dict[str, Any]) -> List[Dict[str, str]] | None:
    """
    Convert a raw example into FT-ready messages or return None if can't fix.
    Accepted inputs:
      - {"messages":[...], "response": {...}}
      - {"messages":[..., {"role":"assistant","content": "..."}]}
      - {"messages":[{"role":"user","content":"..."}], "response": {...}}
    """
    # Strip known wrappers we don't need
    ex = dict(ex)
    ex.pop("_source", None)  # ignore exporter metadata

    msgs = normalize_messages(ex.get("messages"))
    resp = ex.get("response")

    # Inject default system if missing
    ensure_system(msgs)

    # If already FT-ready and valid, just ensure assistant.content is string
    if last_is_assistant(msgs):
        # If assistant content accidentally stored as JSON object, stringify it
        if not isinstance(msgs[-1]["content"], str):
            msgs[-1]["content"] = as_str(msgs[-1]["content"])
        return msgs if len([m for m in msgs if m["role"] == "user"]) > 0 else None

    # If we have a response dict, wrap it as assistant content
    if isinstance(resp, dict):
        assistant_text = to_assistant_content(resp)
        msgs.append({"role": "assistant", "content": assistant_text})
        # Require at least one user message
        return msgs if len([m for m in msgs if m["role"] == "user"]) > 0 else None

    # If no response and no assistant, can't train from it
    return None

def resolve_inputs(argv_inputs: List[str]) -> List[str]:
    if argv_inputs:
        files: List[str] = []
        for pat in argv_inputs:
            expanded = glob.glob(pat)
            if not expanded and os.path.isfile(pat):
                expanded = [pat]
            files.extend(expanded)
    else:
        files = [p for p in DEFAULT_INPUTS if os.path.isfile(p)]
    # De-dup preserving order
    seen, uniq = set(), []
    for p in files:
        if p not in seen and os.path.isfile(p):
            uniq.append(p)
            seen.add(p)
    return uniq

def main():
    ap = argparse.ArgumentParser(description="Merge + FIX JSONL datasets for OpenAI chat fine-tuning.")
    ap.add_argument("--inputs", nargs="*", default=None, help="Input files/patterns.")
    ap.add_argument("--out", default="fine_tuning/merged_dataset.jsonl", help="Output JSONL.")
    ap.add_argument("--shuffle", action="store_true", help="Shuffle merged examples before writing.")
    ap.add_argument("--seed", type=int, default=1337, help="Random seed for --shuffle.")
    ap.add_argument("--limit", type=int, default=None, help="Write at most N examples (after dedupe).")
    args = ap.parse_args()

    inputs = resolve_inputs(args.inputs or [])
    if not inputs:
        print("[error] No input files found.", file=sys.stderr)
        sys.exit(2)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    total_read = 0
    fixed_ok = 0
    skipped = 0
    dedup_pruned = 0

    kept_msgs: List[List[Dict[str, str]]] = []
    seen_hashes = set()

    print("🔎 Merging from:")
    for p in inputs:
        print(f"   • {p}")

    for path in inputs:
        for obj, ln in iter_jsonl(path):
            total_read += 1
            msgs = fix_example(obj)
            if not msgs:
                skipped += 1
                continue

            fp = messages_fingerprint(msgs)
            if fp in seen_hashes:
                dedup_pruned += 1
                continue
            seen_hashes.add(fp)

            kept_msgs.append(msgs)
            fixed_ok += 1

    if args.shuffle:
        random.seed(args.seed)
        random.shuffle(kept_msgs)

    if args.limit is not None:
        kept_msgs = kept_msgs[: max(0, args.limit)]

    with io.open(args.out, "w", encoding="utf-8") as f:
        for msgs in kept_msgs:
            f.write(json.dumps({"messages": msgs}, ensure_ascii=False, separators=(",", ":")) + "\n")

    print("\n✅ Merge+Fix complete")
    print(f"   Inputs           : {len(inputs)} files")
    print(f"   Total read       : {total_read}")
    print(f"   Kept (FT-ready)  : {fixed_ok}")
    print(f"   Skipped (bad)    : {skipped}")
    print(f"   Duplicates pruned: {dedup_pruned}")
    print(f"   Output           : {args.out}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[aborted]")
        sys.exit(130)
