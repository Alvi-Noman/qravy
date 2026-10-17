"""
A Bengali (bhaat) restaurant's meal, the way its waiter offers it.

At a ভাত-মাছ restaurant nobody is recommended "আলু ভর্তা" or "ডাল" as a dish of its own: the meal is rice, with fish or
meat curries, and bhorta / bhaji / dal on the side. Asked "কী খাওয়া যায়?" while rice is being served, the waiter says
"এখন ভাত খেতে পারেন। ভাতের সাথে মাছের মধ্যে রুই আর ইলিশ আছে, মাংসের মধ্যে গরুর ভুনা আছে। সাথে আলু ভর্তা বা ডাল
নিতে পারেন।" — not a list of five dishes. Fast food, Chinese, cafés: none of this applies (no plain rice + curries).

Pure (no I/O).
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

from waiter_knowledge import is_dessert, is_side, item_hints, kind_text

_PLAIN_RICE_EN = re.compile(r"\b(plain|steamed|white|sada|shada|boiled) rice\b|^\s*(rice|bhat|bhaat|vat)\s*(\(.*\))?\s*$")
_DAL = re.compile(r"(?<![ঀ-৿])ডাল(?![ঀ-৿])|\bdh?aa?l\b")
_RED_MEAT = {"beef", "mutton", "duck"}
_FISH = {"fish", "prawn/shrimp"}
# a curry by its own name (ভুনা, ঝোল, কারি, কালিয়া, ঝাল ফ্রাই… — kind_text's "curry"), a fish dish of any kind
_CURRY = re.compile(r"\bcurry\b|\bbhuna\b|\bjhol\b|\bkalia\b|\brezala\b|\bkorma\b|\bmasala\b|\bdo ?piaz|\bjhal\b")


def _name(it: Dict[str, Any]) -> str:
    return str(it.get("name") or "")


_SYMBOLS = re.compile(r"[☀-➿⬀-⯿\U0001F000-\U0001FAFF️]")  # 🌶 ✓ ★ — not said out loud


def said_name(it: Dict[str, Any]) -> str:
    """How the waiter says it: "রুই মাছ (গ্রাসি)" → "রুই মাছ", "দেশি মুরগির ঝোল ✓" → "দেশি মুরগির ঝোল"."""
    return re.sub(r"\s+", " ", _SYMBOLS.sub("", re.sub(r"\s*\(.*?\)", "", _name(it)))).strip()


def is_plain_rice(it: Dict[str, Any]) -> bool:
    """সাদা ভাত, ভাত, সুগন্ধি ভাত, Plain Rice — by its own name (a "মাছ…" category doesn't make it fish)."""
    name = _name(it).lower()
    return "plain rice" in kind_text({"name": name}) or bool(_PLAIN_RICE_EN.search(name))


def role(it: Dict[str, Any]) -> str:
    """What a dish is at a bhaat meal: 'rice', 'fish', 'chicken', 'meat' (curries eaten with rice), 'side'
    (bhorta / bhaji / dal), or '' (anything else: biryani, kebab, naan, drinks, desserts…)."""
    if is_plain_rice(it):
        return "rice"
    name = _name(it)
    own = kind_text({"name": name})
    curry = bool(_CURRY.search(own) or _CURRY.search(name.lower()))  # (ঝাল ফ্রাই is a curry, not a snack "fry")
    if is_dessert(it) or re.search(r"\b(drink|lassi|juice|coffee|tea|shake|soup|salad|biryani|kacchi|tehari|khichuri|"
                                   r"polao|noodle|naan|kebab|grill|set menu|platter)\b", own) or (
            not curry and re.search(r"\bsnack\b", own)):
        return ""
    # the dish's own name first: মাছ ভর্তা is a side, শুটকি ভুনা a curry even in a "ভর্তা ভাজির…" category
    if re.search(r"\bside\b", own) or _DAL.search(name.lower()) or re.search(r"সবজি|\bsobji\b|\bvaji\b|\bbhaji\b", name.lower()):
        return "side"
    has = set(item_hints({"name": name})["contains"])  # by its own name only
    if has & _FISH:
        return "fish"
    if curry and "chicken" in has:
        return "chicken"
    if curry and has & _RED_MEAT:
        return "meat"
    if is_side(it):
        return "side"
    return ""


def _classic_side(it: Dict[str, Any]) -> bool:
    """আলু ভর্তা, ডাল, শাক ভাজি — what a waiter names first (before চিংড়ির ভর্তা)."""
    return item_hints(it)["diet"] == "likely vegetarian" or bool(_DAL.search(_name(it).lower()))


def is_bhaat_house(items: Iterable[Dict[str, Any]]) -> bool:
    """Plain rice on the menu and at least three fish / meat curries to eat it with."""
    roles = [role(it) for it in items]
    return "rice" in roles and sum(r in ("fish", "chicken", "meat") for r in roles) >= 3


def meal(ordered: List[Dict[str, Any]], *, per_group: int = 2, curries: int = 5, sides: int = 2) -> Optional[Dict[str, Any]]:
    """From dishes already ranked for this guest and this time (best first): the rice, then the curries by group and
    the sides. None when there's no rice or fewer than two curries to offer with it."""
    rice = next((it for it in ordered if role(it) == "rice"), None)
    groups: Dict[str, List[Dict[str, Any]]] = {"fish": [], "chicken": [], "meat": [], "side": []}
    seen: set = set()
    for it in ordered:
        r = role(it)
        key = said_name(it).lower()
        if r in groups and key not in seen:
            seen.add(key)
            groups[r].append(it)
    picked = {g: groups[g][:per_group] for g in ("fish", "chicken", "meat")}
    # at most `curries` in all: trim from the end (meat, then chicken), never below one per group
    while sum(len(v) for v in picked.values()) > curries:
        for g in ("meat", "chicken", "fish"):
            if len(picked[g]) > 1:
                picked[g].pop()
                break
        else:
            break
    if not rice or sum(len(v) for v in picked.values()) < 2:
        return None
    side = sorted(groups["side"], key=lambda it: not _classic_side(it))  # (stable: the guest's ranking within each)
    return {"rice": rice, **picked, "side": side[:sides]}


def _join(names: List[str], last: str) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {last} " + names[-1]


def meal_text(m: Dict[str, Any], lang: str, *, rice_in_tray: bool = False) -> str:
    """'এখন ভাত খেতে পারেন। ভাতের সাথে মাছের মধ্যে A আর B আছে, মুরগির মধ্যে C আছে, মাংসের মধ্যে D আছে।
    সাথে E বা F নিতে পারেন।'"""
    names = {g: [said_name(it) for it in m.get(g) or []] for g in ("fish", "chicken", "meat", "side")}
    if lang == "bn":
        labels = {"fish": "মাছের মধ্যে", "chicken": "মুরগির মধ্যে", "meat": "মাংসের মধ্যে"}
        parts = [f"{labels[g]} {_join(names[g], 'আর')} আছে" for g in ("fish", "chicken", "meat") if names[g]]
        s = ("" if rice_in_tray else "এখন ভাত খেতে পারেন। ") + "ভাতের সাথে " + ", ".join(parts) + "।"
        if names["side"]:
            s += f" সাথে {_join(names['side'], 'বা')} নিতে পারেন।"
        return s
    labels = {"fish": "fish like", "chicken": "chicken like", "meat": "meat like"}
    parts = [f"{labels[g]} {_join(names[g], 'and')}" for g in ("fish", "chicken", "meat") if names[g]]
    s = ("" if rice_in_tray else "Right now you can have rice — ") + "with it we have " + _join(parts, "and") + "."
    if names["side"]:
        s += f" You could add {_join(names['side'], 'or')} on the side."
    return s[0].upper() + s[1:]


def house_note(items: List[Dict[str, Any]], orderable_items: List[Dict[str, Any]]) -> str:
    """For the model's turn context at a bhaat restaurant (empty elsewhere)."""
    if not is_bhaat_house(items):
        return ""
    rice = next((it for it in orderable_items if role(it) == "rice"), None)
    if not rice:
        return ("HOUSE STYLE: a Bengali rice-and-curry restaurant, but rice isn't being served right now — don't offer a "
                "rice meal; bhorta / bhaji / dal are sides for rice, never recommend them on their own.")
    return (
        "HOUSE STYLE: a Bengali rice-and-curry (ভাত) restaurant. A meal here is rice with fish / chicken / meat curries, "
        f"and bhorta / bhaji / dal on the side ({said_name(rice)} can be ordered now). Recommend like a Bengali waiter: "
        "offer rice with the curries — \"এখন ভাত খেতে পারেন। ভাতের সাথে মাছের মধ্যে … আছে, মাংসের মধ্যে … আছে। সাথে "
        "… ভর্তা বা ডাল নিতে পারেন।\" Never recommend a bhorta, bhaji or dal as a dish on its own — only as something "
        "to have WITH rice. When the guest orders a curry without rice, ask if they'd like rice with it."
    )
