"""Replay real guest turns through the waiter (the real model) and check what must hold — see CLAUDE.md.

Data (kept OUT of git — real guests' words): a folder with
  menus.json   {subdomain: {name, tz, opening, periods, items: [{name, price, category, periods, variations, off, description}]}}
  cases.py     CASES = [(id, subdomain, "HH:MM", [turns], expect)]   — bad answers that must now be right
  good.json    [{id, restaurant, at, turns}]                           — ordinary turns (no expectations; compared)

  python evals/replay/run.py --data <folder> --mode both --out report.json      (needs OPENAI_API_KEY)
Modes: current (today's flow), ai-first (WAITER_AI_FIRST: word-pattern answers become facts for the model), both.
"""
import argparse
import asyncio
import importlib.util
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))

import availability  # noqa: E402
import brain  # noqa: E402
import session_ctx  # noqa: E402
from waiter_knowledge import meal_kinds  # noqa: E402

CALLS = {"n": 0}
_orig = brain._call_openai


async def _counted(messages):
    CALLS["n"] += 1
    return await _orig(messages)


brain._call_openai = _counted


def load(data):
    menus = json.load(open(os.path.join(data, "menus.json"), encoding="utf-8"))
    spec = importlib.util.spec_from_file_location("replay_cases", os.path.join(data, "cases.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    good_path = os.path.join(data, "good.json")
    good = json.load(open(good_path, encoding="utf-8")) if os.path.exists(good_path) else []
    cases = [(c[0], c[1], c[2], c[3], c[4] if len(c) > 4 else {}) for c in mod.CASES]
    cases += [(g["id"], g["restaurant"], g["at"], g["turns"], {}) for g in good]
    return menus, cases


def snapshot(menu, minute):
    periods = menu.get("periods") or [{k: p[k] for k in ("id", "name", "start", "end")} for p in availability.DEFAULT_PERIODS]
    rules = {"periods": periods}
    now = set(availability.periods_at(minute, rules))
    opening = menu.get("opening") or []
    is_open = True
    if opening:
        hh, mm = divmod(minute, 60)
        day = 2  # (a Tuesday — the windows' day lists decide)
        is_open = any(day in (w.get("days") or []) and (
            w["start"] <= f"{hh:02d}:{mm:02d}" < w["end"] if w["start"] < w["end"]
            else f"{hh:02d}:{mm:02d}" >= w["start"] or f"{hh:02d}:{mm:02d}" < w["end"]) for w in opening)
    items = []
    for i, it in enumerate(menu["items"]):
        if it.get("off"):
            continue
        ps = it.get("periods")
        row = {"id": f"d{i}", "name": it["name"], "category": it.get("category") or "", "categoryId": it.get("category") or "",
               "price": it.get("price") or 0, "description": it.get("description") or "",
               "variations": [{"name": v, "price": it.get("price") or 0} for v in it.get("variations") or []]}
        if ps:
            row["periods"] = list(ps)  # (as production's snapshot: the dish's serving periods — "বোয়াল at breakfast?")
        if not is_open or (ps and not (set(ps) & now)):
            row["available"] = False
        items.append(row)
    return items, periods, is_open


async def run_case(case, menus):
    cid, sub, at, turns, _exp = case
    hh, mm = map(int, at.split(":"))
    minute = hh * 60 + mm
    menu = menus[sub]
    items, periods, is_open = snapshot(menu, minute)
    state, hist, cart, out_turns = None, [], [], []
    sid = f"replay-{cid}-{time.time()}"
    for said in turns:
        names = [p["name"] for p in periods if str(p["id"]) in availability.periods_at(minute, {"periods": periods})]
        ctx = {"cartItems": [dict(c) for c in cart], "localTime": f"Tue {hh:02d}:{mm:02d}", "mealKinds": meal_kinds(names, hh),
               "table": "5"}
        CALLS["n"] = 0
        try:
            out = await brain.generate_reply(said, channel="dine-in", menu_snapshot={"items": items, "periods": periods},
                                             locale="bn", history=hist, dialog_state=state, context=ctx,
                                             restaurant={"staffAlerts": True, "online": True, "opening": menu.get("opening") or []},
                                             conversation_id=sid)
        except Exception as e:  # noqa: BLE001
            out_turns.append({"guest": said, "error": repr(e)})
            break
        m = out["meta"]
        for op in m.get("cartOps") or []:
            iid = op.get("itemId")
            if op.get("op") == "add":
                line = next((c for c in cart if c["itemId"] == iid and c.get("variation", "") == (op.get("variant") or "")), None)
                if line:
                    line["qty"] += op.get("quantity") or 1
                else:
                    cart.append({"itemId": iid, "id": iid, "name": op.get("name"), "qty": op.get("quantity") or 1,
                                 "variation": op.get("variant") or "",
                                 "price": next((float(i.get("price") or 0) for i in items if i["id"] == iid), 0)})
            elif op.get("op") == "remove":
                cart = [c for c in cart if c["itemId"] != iid]
            elif op.get("op") == "set":
                for c in cart:
                    if c["itemId"] == iid:
                        c["qty"] = op.get("quantity") or c["qty"]
                cart = [c for c in cart if c["qty"] > 0]
        if m.get("clearCart"):
            cart = []
        session_ctx.update_state("replay", sid, meta=m, user_text=said)
        state = session_ctx.get_state("replay", sid)
        reply = out.get("replyText") or ""
        hist += [{"role": "user", "content": said}, {"role": "assistant", "content": reply}]
        dec = m.get("decision") or {}
        out_turns.append({
            "guest": said, "reply": reply, "by": "AI" if CALLS["n"] else "RULE",
            "cards": [s.get("title") for s in (m.get("suggestions") or [])][:6],
            "buttons": [o.get("label") for o in dec.get("chooseOptions") or []],
            "tray": [(c["name"], c["qty"]) for c in cart],
        })
    return {"id": cid, "restaurant": sub, "at": at, "open": is_open, "turns": out_turns}


def check(result, exp):
    """[(what, ok)] for a case's expectations, on its last turn."""
    if not exp:
        return []
    last = result["turns"][-1] if result["turns"] else {}
    reply = last.get("reply") or ""
    tray = [n for n, _q in last.get("tray") or []]
    out = []
    for piece in exp.get("tray_has") or []:
        out.append((f"tray has {piece!r}", any(piece in n for n in tray)))
    for piece in exp.get("tray_not") or []:
        out.append((f"tray has no {piece!r}" if piece else "tray stays empty", not any(piece in n for n in tray)))
    for rx in exp.get("says") or []:
        out.append((f"says /{rx}/", bool(re.search(rx, reply))))
    for rx in exp.get("not_says") or []:
        out.append((f"doesn't say /{rx}/", not re.search(rx, reply)))
    if exp.get("buttons"):
        out.append(("offers a choice", bool(last.get("buttons") or last.get("cards"))))
    if "error" in last:
        out.append(("no error", False))
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--mode", choices=["current", "ai-first", "both"], default="both")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    menus, cases = load(a.data)
    if a.only:  # one id or several, comma-separated ("--only 42-boyal,59-dup") — a run costs money: only what changed
        want = [x.strip() for x in a.only.split(",") if x.strip()]
        cases = [c for c in cases if any(w in c[0] for w in want)]
    modes = ["current", "ai-first"] if a.mode == "both" else [a.mode]
    report = {"modes": modes, "cases": []}
    for case in cases:
        entry = {"id": case[0], "expect": case[4], "runs": {}}
        for mode in modes:
            brain.AI_FIRST = mode == "ai-first"
            res = await run_case(case, menus)
            res["checks"] = check(res, case[4])
            entry["runs"][mode] = res
            ok = all(o for _w, o in res["checks"]) if res["checks"] else None
            last = (res["turns"] or [{}])[-1]
            print(f"[{mode:8}] {case[0]:28} {'PASS' if ok else 'FAIL' if ok is False else '    '}  "
                  f"{last.get('by', '')}: {(last.get('reply') or last.get('error') or '')[:110]}", flush=True)
        report["cases"].append(entry)
    for mode in modes:
        checked = [e for e in report["cases"] if e["runs"][mode]["checks"]]
        passed = sum(all(o for _w, o in e["runs"][mode]["checks"]) for e in checked)
        rule = sum(t["by"] == "RULE" for e in report["cases"] for t in e["runs"][mode]["turns"] if "by" in t)
        total = sum(1 for e in report["cases"] for t in e["runs"][mode]["turns"] if "by" in t)
        print(f"== {mode}: {passed}/{len(checked)} expectations met · {rule}/{total} replies written by rules")
    if a.out:
        json.dump(report, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    asyncio.run(main())
