"""
The guest's tray, line by line — what the waiter changes, and how to take it back.

A "line" is one row in the tray: an item + its size + its add-ons (+ a note). Two sizes of the same dish are
two lines, so voice changes can target one exactly ("বড়টা বাদ দিন", "make the second one half").

  line_key()   the same identity the storefront uses (CartContext.cartLineKey): id::variation::groupId:optionId|…
  with_refs()  numbers the lines L1, L2 … for the model (and keeps the key for the UI)
  simulate()   applies validated ops to the lines → the tray after this turn (for replies, read-back, undo)
  last_change  what one turn changed (lines before + keys after) — "undo" restores exactly that
  summary()    "2টা স্প্রিং রোল, 1টা মিনারেল ওয়াটার (লার্জ)" + total + item count
  warnings()   lines that can't be ordered now, or clash with the guest's allergy / diet
"""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

# ------------------------------------------------------------------ identity


def modifiers_key(mods: Optional[List[Dict[str, Any]]]) -> str:
    return "|".join(sorted(f"{m.get('groupId')}:{m.get('optionId')}" for m in mods or [] if m.get("groupId")))


def line_key(item_id: str, variation: Optional[str], mods: Optional[List[Dict[str, Any]]]) -> str:
    """Must match apps/tastebud CartContext.cartLineKey()."""
    return f"{item_id}::{variation or ''}::{modifiers_key(mods)}"


def with_refs(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Give every line its key and a short ref (L1, L2 …) the model can point at."""
    for n, r in enumerate(rows, start=1):
        r.setdefault("key", line_key(str(r.get("itemId")), r.get("variation"), r.get("modifiers")))
        r["line"] = f"L{n}"
    return rows


def resolve_choices(item: Dict[str, Any], names: List[str]) -> List[Dict[str, Any]]:
    """Choice names → the item's real options {groupId, groupName, optionId, name, price} (same as the storefront)."""
    out: List[Dict[str, Any]] = []
    for want in names or []:
        w = str(want).strip().lower()
        for g in item.get("modifierGroups") or []:
            opt = next((o for o in g.get("options") or [] if str(o.get("name", "")).strip().lower() == w), None)
            if opt and not any(m["groupId"] == str(g.get("id")) and m["optionId"] == str(opt.get("id")) for m in out):
                out.append({"groupId": str(g.get("id")), "groupName": str(g.get("name") or ""), "optionId": str(opt.get("id")),
                            "name": str(opt.get("name")), "price": float(opt.get("price") or 0)})
                break
    return out


def unit_price(item: Dict[str, Any], variation: Optional[str], mods: List[Dict[str, Any]]) -> float:
    base = item.get("price") or 0
    if variation:
        v = next((v for v in item.get("variations") or [] if str(v.get("name", "")).lower() == variation.lower()), None)
        if v and isinstance(v.get("price"), (int, float)):
            base = v["price"]
    return float(base or 0) + sum(float(m.get("price") or 0) for m in mods)


# ------------------------------------------------------------------ simulate a turn's ops


def simulate(rows: List[Dict[str, Any]], ops: List[Dict[str, Any]], clear: bool, by_id: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The tray after `ops` (validated UI ops). Lines keep their keys; new lines get theirs."""
    out = [] if clear else [copy.deepcopy(r) for r in rows]

    def find(key: Optional[str]) -> Optional[Dict[str, Any]]:
        return next((r for r in out if r.get("key") == key), None) if key else None

    for op in ops:
        kind, iid = op.get("op"), str(op.get("itemId") or "")
        it = by_id.get(iid) or {}
        row = find(op.get("lineKey"))
        if kind == "restore":
            line = copy.deepcopy(op.get("line") or {})
            if line:
                ex = find(line.get("key"))
                if ex:
                    ex["quantity"] += int(line.get("quantity") or 0)
                else:
                    out.append(line)
            continue
        if kind == "add":
            mods = op.get("modifiers") or resolve_choices(it, op.get("choices") or [])
            variation = op.get("variant") or ""
            key = line_key(iid, variation, mods)
            ex = find(key)
            if ex:
                ex["quantity"] += int(op.get("quantity") or 1)
                if op.get("note"):
                    ex["notes"] = op["note"]
            else:
                out.append({
                    "key": key, "itemId": iid, "name": it.get("name") or op.get("name") or iid,
                    "quantity": int(op.get("quantity") or 1), "variation": variation, "modifiers": mods,
                    "notes": op.get("note") or "",
                    "price": float(op["price"]) if isinstance(op.get("price"), (int, float)) else unit_price(it, variation, mods),
                })
            continue
        targets = [row] if row else [r for r in out if r.get("itemId") == iid]
        for r in targets:
            if kind == "set":
                r["quantity"] = int(op.get("quantity") or 0)
            elif kind == "remove":
                r["quantity"] = 0
            elif kind == "note":
                r["notes"] = "" if op.get("removeNote") else (op.get("note") or r.get("notes") or "")
            elif kind == "edit":
                variation = op.get("variant") if op.get("variant") is not None else r.get("variation")
                mods = op.get("modifiers") if op.get("modifiers") is not None else r.get("modifiers") or []
                r.update({
                    "variation": variation or "", "modifiers": mods,
                    "notes": "" if op.get("removeNote") else (op.get("note") or r.get("notes") or ""),
                    "price": unit_price(it, variation, mods) if it else r.get("price"),
                })
                r["key"] = line_key(iid, variation, mods)
    return [r for r in out if int(r.get("quantity") or 0) > 0]


def change_record(before: List[Dict[str, Any]], after: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """What changed this turn, for "undo": the affected lines as they were, and the keys they have now."""
    b = {r["key"]: r for r in before}
    a = {r["key"]: r for r in after}
    changed_after = [k for k, r in a.items() if k not in b or _line_state(b[k]) != _line_state(r)]
    changed_before = [k for k, r in b.items() if k not in a or _line_state(a[k]) != _line_state(r)]
    if not changed_after and not changed_before:
        return None
    return {
        "before": [copy.deepcopy(b[k]) for k in changed_before],
        "after_keys": changed_after,
        "after": [copy.deepcopy(a[k]) for k in changed_after],
    }


def _line_state(r: Dict[str, Any]) -> Tuple[Any, ...]:
    return (int(r.get("quantity") or 0), r.get("notes") or "")


def undo_ops(change: Dict[str, Any], rows: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Ops that put the tray back as it was before `change` — None when the tray has moved on since."""
    now = {r["key"]: r for r in rows}
    ops: List[Dict[str, Any]] = []
    for line in change.get("after") or []:
        cur = now.get(line["key"])
        if not cur or int(cur.get("quantity") or 0) != int(line.get("quantity") or 0):
            return None  # the guest changed that line since (by tapping) — undoing blindly would be wrong
        ops.append({"op": "remove", "itemId": line["itemId"], "name": line["name"], "lineKey": line["key"]})
    for line in change.get("before") or []:
        ops.append({"op": "restore", "itemId": line["itemId"], "name": line["name"], "line": _ui_line(line)})
    return ops or None


def _ui_line(r: Dict[str, Any]) -> Dict[str, Any]:
    keep = ("key", "itemId", "name", "quantity", "variation", "modifiers", "notes", "price")
    return {k: copy.deepcopy(r.get(k)) for k in keep}


# ------------------------------------------------------------------ talking about the tray


def label(r: Dict[str, Any]) -> str:
    extras = [x for x in [r.get("variation"), *[m.get("name") for m in r.get("modifiers") or []]] if x]
    return f"{r['quantity']} × {r['name']}" + (f" ({', '.join(extras)})" if extras else "")


def summary(rows: List[Dict[str, Any]]) -> Tuple[str, float, int]:
    total = sum(float(r.get("price") or 0) * int(r.get("quantity") or 0) for r in rows)
    count = sum(int(r.get("quantity") or 0) for r in rows)
    return ", ".join(label(r) for r in rows), total, count


TRAY_QUESTION = re.compile(
    r"what'?s in my (tray|cart|order)|what (did|have) (i|we) order(ed)?|what (have i|i have) (got|added)|"
    r"how many items|read (back )?my order|my order so far|"
    r"(ট্রে|কার্ট|অর্ডার)(তে|এ|ে)?\s*(এখন\s*)?(কী|কি)\s*(কী|কি)?\s*(আছে|আছেন|হলো|হয়েছে)|"
    r"(কী|কি)\s*(কী|কি)\s*(নিলাম|নিয়েছি|অর্ডার করেছি|অর্ডার দিলাম|দিয়েছি)|কতগুলো (আইটেম|জিনিস|খাবার)|কয়টা (আইটেম|জিনিস)|"
    r"আমার অর্ডার(টা)? (বলুন|বলেন|শোনান|পড়ে শোনান)",
    re.I,
)

UNDO = re.compile(
    r"^\W*(undo|undo (that|it)|take (that|it) back|go back|revert|put it back)\W*$|"
    r"\b(undo( that| it)?|revert (that|it)|change it back)\b|"
    r"আগের মতো (করে )?(দিন|দেন|করুন|করেন)|আগেরটা ফিরিয়ে|ফিরিয়ে (দিন|দেন|আনুন)|শেষ(টা)? (বাদ|বাতিল) (দিন|দেন|করুন)|"
    r"ভুল হয়েছে,? আগের|আনডু",
    re.I,
)

# short relative requests about the line just changed (no dish named): "আরেকটা দিন", "one more", "একটা কমান"
RELATIVE = re.compile(
    r"^\W*(?:(?P<more>আরেকটা|আর একটা|আরো একটা|আরও একটা|আরেক প্লেট|আরো এক প্লেট|one more|another one|another|same again|"
    r"ekta more|arekta)|(?P<less>একটা কমান|একটা কম|একটা কমিয়ে দিন|একটা কমিয়ে দেন|one less|take one off|ekta kom))"
    r"(?:\s*(?:দিন|দেন|দাও|দ্যান|please|plz|প্লিজ|ভাই|করেন|করুন))*\W*$",
    re.I,
)

MORE_WORDS = re.compile(r"\b(more|another|extra|again|also|plus|one more|additional)\b|আরো|আরও|আরেক|বাড়িয়ে|এক্সট্রা|আবার", re.I)

ALL_WORDS = re.compile(r"\b(all|both|every|everything)\b|সব|সবগুলো|দুইটাই|দুটোই|সবকটা|পুরোটা", re.I)

BIG_QTY = 10


def facts(rows: List[Dict[str, Any]], by_id: Dict[str, Dict[str, Any]], *, party: int = 0, budget: int = 0,
          dish_facts=None, drinks_on_menu: bool = True) -> str:
    """The tray as a whole, for questions like "is this enough for the 3 of us?", "is it over my budget?",
    "what else do we need?" — numbers the model can reason with instead of guessing."""
    if not rows:
        return ""
    _, total, count = summary(rows)
    parts = [f"{count} items, total ৳{int(total) if total == int(total) else round(total, 2)}"]
    kinds = [dish_facts(by_id.get(str(r["itemId"])) or {"name": r["name"]}) for r in rows] if dish_facts else []
    mains = sum(
        int(r["quantity"]) for r, f in zip(rows, kinds)
        if (f.get("main") or f.get("complete_meal") or f.get("rice")) and not f.get("drink")
    ) if kinds else 0
    drinks = sum(int(r["quantity"]) for r, f in zip(rows, kinds) if f.get("drink")) if kinds else 0
    if kinds:
        parts.append(f"{mains} main dish{'es' if mains != 1 else ''}, {drinks} drink{'s' if drinks != 1 else ''}")
    if party:
        per = mains / party if party else 0
        parts.append(f"party of {party}: about {per:.1f} main dishes per person"
                     + (" — probably not enough" if per < 0.8 else " — looks like plenty" if per >= 1.5 else " — about right"))
        if drinks < party and drinks_on_menu:
            parts.append(f"{party - drinks} more drink(s) would give everyone one")
    elif kinds and not drinks and drinks_on_menu:
        parts.append("no drink yet")
    if budget:
        diff = budget - total
        parts.append(f"budget ৳{budget}: " + (f"৳{int(diff)} left" if diff >= 0 else f"OVER by ৳{int(-diff)}"))
    return "; ".join(parts)


def warnings(rows: List[Dict[str, Any]], by_id: Dict[str, Dict[str, Any]], orderable: Dict[str, bool],
             clash) -> List[Dict[str, Any]]:
    """Lines to flag: can't be ordered now (sold out / out of hours), or clash with the guest's allergy/diet.
    `clash(item) → [reasons]` comes from the recommender's safety rules."""
    out = []
    for r in rows:
        it = by_id.get(str(r.get("itemId"))) or {}
        if it and not orderable.get(str(r.get("itemId")), True):
            out.append({"lineKey": r["key"], "itemId": r["itemId"], "name": r["name"], "kind": "unavailable",
                        "reason": it.get("unavailableReason") or "not available right now"})
            continue
        why = clash(it) if it else []
        if why:
            out.append({"lineKey": r["key"], "itemId": r["itemId"], "name": r["name"], "kind": "diet", "reason": why[0]})
    return out
