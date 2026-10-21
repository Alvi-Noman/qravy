"""The AI waiter's "can this dish be ordered now?" (availability.py, through fetch_menu_snapshot) next to the menu
page's / checkout's for the same test restaurant (services/auth-service/scripts/availability-parity.ts writes those,
read here from stdin) — every disagreement listed, grouped. None = the waiter and the menu always say the same.

    python scripts/availability_parity.py < ts.json
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402

data = json.load(sys.stdin)
sub = data["subdomain"]
groups = defaultdict(list)
for r in data["rows"]:
    groups[(r["branch"], r["channel"], r["at"])].append(r)

diffs = defaultdict(list)
checked = 0
for (branch, channel, at), rows in sorted(groups.items()):
    now = datetime.strptime(at, "%Y-%m-%dT%H:%M:%S.%fZ")  # (UTC, as the waiter's clock)
    snap = server.fetch_menu_snapshot(sub, branch=branch, channel=channel, now=now)
    ours = {str(it["id"]): it for it in snap.get("items") or []}
    for r in rows:
        it = ours.get(r["id"])
        ai = bool(it) and bool(it.get("available"))
        checked += 1
        if ai != r["orderable"]:
            why_ai = "not in the waiter's menu" if not it else (it.get("unavailableReason") or "available")
            diffs[(r["item"], r["orderable"], ai)].append((branch, channel, at, r["why"], why_ai))

print(f"checked {checked} (dish × time × branch × channel); disagreements: {sum(len(v) for v in diffs.values())}")
for (item, menu, ai), cases in sorted(diffs.items(), key=lambda kv: -len(kv[1])):
    print(f"\n{item}: menu/checkout says {'ORDERABLE' if menu else 'off'}, the waiter says {'ORDERABLE' if ai else 'off'}"
          f" — {len(cases)} times")
    for branch, channel, at, why_menu, why_ai in cases[:3]:
        print(f"   {branch}/{channel} {at}  menu: {why_menu}  |  waiter: {why_ai}")
