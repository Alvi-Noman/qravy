"""THE offer engine — the one place that decides whether the waiter offers anything extra this turn, what, and how
it's said. The model never pitches (brain cuts its pitches out of the reply), and suggestion cards for an offer
appear only when this engine decides.

  B  the meal's gaps — what each tray dish is FOR (upsell.dish_roles) → only the single biggest gap is offered
  C  what kind of offer: rice / bread for a curry, a combo (the menu's own "make it a meal" add-on, or a combo dish cheaper than its parts),
     more of the main for a group, a side, a drink (cold with spicy food), an add-on for the dish just ordered
     (a dip), a dessert at the end. The size-up is a hint in the option picker (size_hints), never a question.
  E  when — right after food is added, and at "that's all". Never on a question, a complaint, a correction, the turn
     after an offer, after two "no"s, or more than twice a visit.
  F  how — one sentence: a reason tied to THEIR food, the price or the saving, a yes/no question ("হ্যাঁ" adds it)
  G  for whom — a drink per head for a group; the time of day comes in through the ranked picks
  H  every offer has an id and its A/B arm (wording × timing, per session); the outcome is recorded next turn
"""
import hashlib
import os
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import tray as _tray
from recommender import GuestProfile, OrderStats, dish_facts, is_packaged
from upsell import dish_roles
from waiter_knowledge import MenuIndex, _money

MAX_OFFERS = 2  # a visit
MAX_DECLINES = 2  # two "no"s → no more offers this visit

_MEAL_OPTION = re.compile(r"\bmeal\b|combo|\+|মিল", re.I)
_COMBO_DISH = re.compile(r"\bcombo\b|\bmeal\b|\bset\b", re.I)
_SPICY_CHOICE = re.compile(r"spicy|hot|ঝাল", re.I)
_COLD = re.compile(r"lemonade|shake|juice|lassi|cola|coke|sprite|7 ?up|fanta|soda|iced|cold|mojito|smoothie", re.I)
_SPLIT_PARTS = re.compile(r"\s*(?:\+|&|,|\band\b|\bwith\b)\s*", re.I)
_NAME_STOP = {"combo", "meal", "set", "and", "with", "the", "a", "of", "our", "portion"}


# ------------------------------------------------------------------ A/B (H)

def arm_for(tenant: Optional[str], session: Optional[str]) -> Dict[str, str]:
    """The session's arm: wording (a reason, or just the thing and its price) × timing (right after food is added
    and at the end, or only at the end). Stable per session, split evenly per restaurant. UPSELL_AB=off → the
    default arm for everyone."""
    if str(os.environ.get("UPSELL_AB", "on")).lower() in ("0", "off", "false", "no"):
        return {"wording": "reason", "timing": "early"}
    h = int(hashlib.sha1(f"{tenant or ''}|{session or ''}".encode()).hexdigest(), 16)
    return {"wording": "reason" if h % 2 == 0 else "short", "timing": "early" if (h // 2) % 2 == 0 else "late"}


# ------------------------------------------------------------------ the offer

@dataclass
class Offer:
    type: str  # combo | meal_addon | more_food | rice | main | side | drink | addon | dessert
    moment: str  # first_add | wrap_up
    text: str
    ops: List[Dict[str, Any]]  # applied on "yes" — the same shape as brain's validated ops
    item_ids: List[str]
    value: float  # what a yes adds to the bill (৳; negative = the guest saves)
    arm: Dict[str, str] = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    at: float = field(default_factory=time.time)
    card: Optional[Dict[str, Any]] = None  # the offered dish as a card in the tray (tap = yes)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Ctx:
    """What the engine needs to know about this turn."""
    index: MenuIndex
    orderable: Dict[str, bool]
    rows: List[Dict[str, Any]]  # the tray AFTER this turn's changes (tray.simulate rows)
    added: List[Dict[str, Any]]  # this turn's add ops
    picks: List[Dict[str, Any]]  # ranked for this guest and the time of day (best first)
    stats: OrderStats
    profile: GuestProfile
    clash: Callable[[Dict[str, Any]], List[str]]
    lang: str
    arm: Dict[str, str]
    meal_kinds: Iterable[str] = ()
    done_types: Iterable[str] = ()  # offered already this visit — never the same kind twice ("a drink?" … "a drink?")


def may_offer(reco: Any, moment: str, arm: Dict[str, str]) -> bool:
    """The budget and the timing arm (the per-turn "never now" rules are brain's: it knows the turn)."""
    if int(getattr(reco, "offers_made", 0) or 0) >= MAX_OFFERS:
        return False
    if int(getattr(reco, "offer_declines", 0) or 0) >= MAX_DECLINES:
        return False
    if moment == "first_add" and arm.get("timing") == "late":
        return False
    return True


def plan(moment: str, c: Ctx) -> Optional[Offer]:
    """The one offer for this moment (or None): the biggest gap first."""
    if not c.rows:
        return None
    if moment == "first_add":
        added_food = [o for o in c.added if o.get("op") == "add" and _is_food(c.index.by_id.get(str(o.get("itemId"))))]
        if not added_food:
            return None  # a drink / a dessert just added — nothing to build on
        # a table of four with one burger: "make it four" comes before any extra; with spicy food a cold drink
        # comes before a side
        spicy = bool(_roles(c)["spicy"])
        steps = (_more_food, _combo_swap, _meal_addon, _rice, _main) + ((_drink, _side) if spicy else (_side, _drink)) + (_addon,)
    else:
        steps = (_drink, _dessert)
    for step in steps:
        o = step(moment, c)
        if o and o.type not in set(c.done_types):
            o.arm = dict(c.arm)
            return o
    return None


# ------------------------------------------------------------------ the tray's shape (B)

def _is_food(it: Optional[Dict[str, Any]]) -> bool:
    if not it:
        return False
    r = dish_roles(it)
    return not (r["drink"] or r["dessert"])


def _roles(c: Ctx) -> Dict[str, Any]:
    items = [(c.index.by_id.get(str(r.get("itemId"))), r) for r in c.rows]
    items = [(it, r) for it, r in items if it]
    rs = [(dish_roles(it), it, r) for it, r in items]
    mains = sum(int(r.get("quantity") or 0) for ro, _it, r in rs if ro["main"] or ro["handheld"])
    spicy = [it for ro, it, r in rs if (dish_facts(it)["heat"] in ("spicy", "likely spicy")
                                        or any(_SPICY_CHOICE.search(str(m.get("name") or "")) and not re.search(r"regular|mild", str(m.get("name") or ""), re.I)
                                               for m in r.get("modifiers") or []))]
    return {
        "ids": {str(r.get("itemId")) for _it, r in items},
        "mains": mains,
        "side": any(ro["side"] for ro, _i, _r in rs),
        "drink": any(ro["drink"] for ro, _i, _r in rs),
        "dessert": any(ro["dessert"] for ro, _i, _r in rs),
        "real_food": any(ro["main"] or ro["rice"] or ro["handheld"] for ro, _i, _r in rs),
        "starter": any(ro.get("starter") or ro.get("snack") for ro, _i, _r in rs),
        "handheld": [it for ro, it, _r in rs if ro["handheld"]],
        "spicy": spicy,
    }


def _anchor(c: Ctx) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """The dish the offer builds on: the food just added (its menu item and its tray line)."""
    for o in c.added:
        it = c.index.by_id.get(str(o.get("itemId")))
        if o.get("op") == "add" and _is_food(it):
            row = next((r for r in reversed(c.rows) if str(r.get("itemId")) == str(o.get("itemId"))), None)
            return it, row
    return None, None


def _simple(it: Dict[str, Any]) -> bool:
    """Can a "yes" add it as it is? (no required choice to pick)"""
    return not any(int(g.get("min") or 0) > 0 for g in it.get("modifierGroups") or [])


def _smallest_size(it: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sizes = [v for v in it.get("variations") or [] if v.get("name")]
    return min(sizes, key=lambda v: float(v.get("price") or 0)) if sizes else None


def _price(it: Dict[str, Any]) -> float:
    v = _smallest_size(it)
    return float((v or {}).get("price") or it.get("price") or 0)


def _best(kind: str, c: Ctx, ctx_ids: set, spicy: bool = False) -> Optional[Dict[str, Any]]:
    """The dish to offer for a gap: what's ordered with this tray in real orders, what suits this guest and the
    time (the ranked picks), made here rather than a bottle, a cold drink with spicy food; never a clash, a
    declined dish, or something already in the tray."""
    rank = {c.index.item_id(it): n for n, it in enumerate(c.picks)}
    best, best_s = None, -1e9
    for it in c.index.items:
        iid = c.index.item_id(it)
        if (iid in ctx_ids or not c.orderable.get(iid, True) or not dish_roles(it)[kind] or not _simple(it)
                or iid in (c.profile.declined or []) or c.clash(it)):
            continue
        name = str(it.get("name") or "")
        s = c.stats.pair_score(iid, ctx_ids)
        s += max(0.0, 1.5 - 0.15 * rank[iid]) if iid in rank else 0.0
        s += 0.5 if it.get("signature") else 0.0
        if kind == "drink":
            if re.search(r"\bwater\b|পানি", name, re.I):
                continue  # nobody upsells a bottle of water
            s += 0.6 if not is_packaged(it) else 0.0
            s += 0.8 if spicy and _COLD.search(name) else 0.0
        if kind == "rice":
            s += 1.0 if re.search(r"\brice\b", name, re.I) else 0.0  # fried rice: the classic partner for a curry
            s += 0.5 if not re.search(r"special|prawn|mixed", name, re.I) else 0.0  # plain, affordable
        s -= _price(it) / 1000.0  # the easier yes, all else equal
        if s > best_s:
            best, best_s = it, s
    return best


def _add_op(it: Dict[str, Any], c: Ctx, qty: int = 1) -> Dict[str, Any]:
    v = _smallest_size(it) if len([x for x in it.get("variations") or [] if x.get("name")]) > 1 else None
    op = {"op": "add", "itemId": c.index.item_id(it), "name": str(it.get("name")), "quantity": qty}
    if v:
        op["variant"], op["price"] = str(v["name"]), float(v.get("price") or 0)
    return op


def _label(it: Dict[str, Any]) -> str:
    v = _smallest_size(it) if len([x for x in it.get("variations") or [] if x.get("name")]) > 1 else None
    return f"{it.get('name')} ({v['name']})" if v else str(it.get("name"))


def _card(it: Dict[str, Any], c: Ctx, why: str) -> Dict[str, Any]:
    return {"itemId": c.index.item_id(it), "title": str(it.get("name")), "price": _price(it), "subtitle": why}


def _say(c: Ctx, reason_bn: str, reason_en: str, short_bn: str, short_en: str) -> str:
    """F: a reason tied to their food — or, in the "short" arm, just the thing and its price."""
    short = c.arm.get("wording") == "short"
    if c.lang == "bn":
        return short_bn if short else reason_bn
    return short_en if short else reason_en


# ------------------------------------------------------------------ the offers (C)

def _combo_swap(moment: str, c: Ctx) -> Optional[Offer]:
    """A combo dish that IS what's in the tray, for less ("Chicken Burger" + "Fries" → "Chicken Burger Combo")."""
    for combo in c.index.items:
        cid = c.index.item_id(combo)
        name = str(combo.get("name") or "")
        if (not _COMBO_DISH.search(name) and "combo" not in [str(t).lower() for t in combo.get("tags") or []]) \
                or not c.orderable.get(cid, True) or cid in {str(r.get("itemId")) for r in c.rows} or not _simple(combo):
            continue
        words = {w for w in re.findall(r"[a-z]+", name.lower()) if w not in _NAME_STOP}
        lines = []
        for r in c.rows:
            it = c.index.by_id.get(str(r.get("itemId")))
            toks = {w for w in re.findall(r"[a-z]+", str((it or {}).get("name") or "").lower()) if w not in _NAME_STOP}
            if it and toks and toks <= words and not r.get("modifiers"):
                lines.append(r)
        covered = set().union(*[{w for w in re.findall(r"[a-z]+", str(r.get("name") or "").lower())} for r in lines]) if lines else set()
        if len(lines) < 2 or not words <= covered or len({int(r.get("quantity") or 1) for r in lines}) != 1:
            continue
        qty = int(lines[0].get("quantity") or 1)
        apart = sum(float(r.get("price") or 0) for r in lines)
        price = _price(combo)
        if price >= apart:
            continue
        save = _money((apart - price) * qty)
        names = " আর ".join(str(r.get("name")) for r in lines) if c.lang == "bn" else " and ".join(str(r.get("name")) for r in lines)
        ops = [{"op": "remove", "itemId": str(r.get("itemId")), "name": str(r.get("name")), "lineKey": r.get("key")} for r in lines]
        ops.append(_add_op(combo, c, qty))
        text = _say(c,
                    f"{names} আলাদা না নিয়ে {name} নিলে {save} কম পড়বে — করে দেব?",
                    f"Getting the {name} instead of the {names} separately saves you {save} — shall I switch it?",
                    f"{name} করে দিলে {save} কম — করে দেব?", f"Switch to the {name} and save {save}?")
        return Offer("combo", moment, text, ops, [cid], -(apart - price) * qty, card=_card(combo, c, f"save {save}"))
    return None


def _parts_price(option_name: str, c: Ctx) -> Optional[float]:
    """"Fries + soft drink" → what those cost on their own (the cheapest of each kind here); None when unclear.
    A "soft drink" is a ready-made drink (a Coke) — not water, not a lemonade made here; a dish part is matched by the
    dish's NAME (a category like "Shakes & Drinks" says nothing about which drink). What's already in the tray still
    has its price."""
    total = 0.0
    for part in [p for p in _SPLIT_PARTS.split(option_name.lower()) if p.strip()]:
        words = {w for w in re.findall(r"[a-z]+", part) if w not in _NAME_STOP and len(w) > 2}
        if not words:
            return None
        drink_word = bool(words & {"drink", "drinks", "soda", "beverage"})
        fits = []
        for it in c.index.items:
            if not c.orderable.get(c.index.item_id(it), True):
                continue
            name = str(it.get("name") or "").lower()
            if drink_word:
                if dish_roles(it)["drink"] and is_packaged(it) and not re.search(r"\bwater\b", name):
                    fits.append(_price(it))
            elif any(re.search(rf"\b{re.escape(w)}", name) for w in words):
                fits.append(_price(it))
        if not fits:
            return None
        total += min(fits)
    return total


def _meal_addon(moment: str, c: Ctx) -> Optional[Offer]:
    """The menu's own "Make it a meal — Fries + soft drink +৳150" on the dish just added, when the tray doesn't have
    those yet — with what it saves against buying them separately."""
    it, row = _anchor(c)
    if not it or not row:
        return None
    shape = _roles(c)
    if shape["side"] and shape["drink"]:
        return None
    have = {str(m.get("name")) for m in row.get("modifiers") or []}
    for g in it.get("modifierGroups") or []:
        if int(g.get("min") or 0) > 0:
            continue
        for o in g.get("options") or []:
            if not o.get("name") or o["name"] in have:
                continue
            if not (_MEAL_OPTION.search(str(g.get("name") or "")) or _MEAL_OPTION.search(str(o["name"]))):
                continue
            extra = float(o.get("price") or 0)
            apart = _parts_price(str(o["name"]), c)
            save = (apart - extra) if apart else 0.0
            op = _edit_op(it, row, [str(o["name"])], c)
            dish, opt, plus = str(it.get("name")), str(o["name"]), _money(extra)
            if save > 0:
                bn = f"{dish} মিল করে দিলে {opt} মাত্র +{plus} — আলাদা নেওয়ার চেয়ে {_money(save)} কম। করে দেব?"
                en = f"Make the {dish} a meal — {opt} for just +{plus}, {_money(save)} less than separately. Shall I?"
            else:
                bn = f"{dish} মিল করে দেব? {opt} সহ +{plus}।"
                en = f"Shall I make the {dish} a meal? {opt} for +{plus}."
            text = _say(c, bn, en, f"{dish} মিল করে দেব? +{plus}", f"Make the {dish} a meal for +{plus}?")
            return Offer("meal_addon", moment, text, [op], [c.index.item_id(it)], extra * int(row.get("quantity") or 1))
    return None


def _edit_op(it: Dict[str, Any], row: Dict[str, Any], add_choices: List[str], c: Ctx) -> Dict[str, Any]:
    mods = list(row.get("modifiers") or []) + _tray.resolve_choices(it, add_choices)
    variant = row.get("variation") or ""
    return {"op": "edit", "itemId": c.index.item_id(it), "name": str(it.get("name")), "lineKey": row.get("key"),
            "quantity": int(row.get("quantity") or 1), "variant": variant, "choices": [m["name"] for m in mods],
            "modifiers": mods, "price": _tray.unit_price(it, variant, mods)}


def _more_food(moment: str, c: Ctx) -> Optional[Offer]:
    """G: a table of 4 with one burger → "আপনারা ৪ জন — Crispy Chicken Burger ৪টা করে দেব?"."""
    party = int(c.profile.party_size or 0)
    it, row = _anchor(c)
    if party < 2 or not it or not row or _roles(c)["mains"] >= party:
        return None
    r = dish_roles(it)
    if not (r["main"] or r["handheld"]):
        return None
    have = int(row.get("quantity") or 1)
    unit = float(row.get("price") or 0)
    extra = _money(unit * (party - have))
    op = {"op": "set", "itemId": c.index.item_id(it), "name": str(it.get("name")), "lineKey": row.get("key"), "quantity": party}
    dish = str(it.get("name"))
    text = _say(c, f"আপনারা {party} জন — {dish} {party}টা করে দেব? (আরও {extra})",
                f"There are {party} of you — make it {party} × {dish}? ({extra} more)",
                f"{dish} {party}টা করে দেব? +{extra}", f"Make it {party} × {dish}? +{extra}")
    return Offer("more_food", moment, text, [op], [c.index.item_id(it)], unit * (party - have))


def _rice(moment: str, c: Ctx) -> Optional[Offer]:
    """A curry with nothing to eat it with → the rice / bread that goes with it."""
    it, _row = _anchor(c)
    shape = _roles(c)
    if not it or not dish_roles(it)["needs_rice"] or any(
            dish_roles(c.index.by_id[i])["rice"] for i in shape["ids"] if i in c.index.by_id):
        return None
    r = _best("rice", c, shape["ids"])
    if not r:
        return None
    dish, name, p = str(it.get("name")), _label(r), _money(_price(r))
    text = _say(c, f"{dish}-এর সাথে {name} ভালো যাবে ({p}) — দেব?",
                f"{name} goes well with the {dish} ({p}) — shall I add it?",
                f"{name} {p} — দেব?", f"{name} for {p}?")
    return Offer("rice", moment, text, [_add_op(r, c)], [c.index.item_id(r)], _price(r),
                 card=_card(r, c, f"with your {dish}"))


def _main(moment: str, c: Ctx) -> Optional[Offer]:
    """Only starters so far (a soup, pakoras) → the main course: the guest's best-fitting main, e.g. "স্টার্টারের পর
    মেইন কোর্সে Chicken Fried Rice নেবেন? (৳৩২০) — দেব?" (a soup and two pakoras once got no offer at all)."""
    shape = _roles(c)
    it, _row = _anchor(c)
    if shape["real_food"] or not it or not shape["starter"]:
        return None
    m = _best("main", c, shape["ids"])
    if not m:
        return None
    name, p = _label(m), _money(_price(m))
    text = _say(c, f"স্টার্টারের পর মেইন কোর্সে {name} নেবেন? ({p}) — দেব?",
                f"For the main course, how about the {name} ({p})? Shall I add it?",
                f"মেইন কোর্সে {name} {p} — দেব?", f"{name} for the main, {p}?")
    return Offer("main", moment, text, [_add_op(m, c)], [c.index.item_id(m)], _price(m),
                 card=_card(m, c, "for the main course"))


def _side(moment: str, c: Ctx) -> Optional[Offer]:
    """A burger / wings with nothing on the side → the side that goes with it."""
    shape = _roles(c)
    it, _row = _anchor(c)
    if shape["side"] or not it or not dish_roles(it)["handheld"]:
        return None
    side = _best("side", c, shape["ids"])
    if not side:
        return None
    dish, s, p = str(it.get("name")), _label(side), _money(_price(side))
    text = _say(c, f"{dish}-এর সাথে {s} খুব ভালো জমে ({p}) — দেব?",
                f"{s} goes great with the {dish} ({p}) — shall I add it?",
                f"{s} {p} — দেব?", f"{s} for {p}?")
    return Offer("side", moment, text, [_add_op(side, c)], [c.index.item_id(side)], _price(side),
                 card=_card(side, c, f"with your {dish}"))


def _drink(moment: str, c: Ctx) -> Optional[Offer]:
    """No drink in the tray → one drink (a cold one with spicy food; one each for a group)."""
    shape = _roles(c)
    if shape["drink"] or not (shape["real_food"] or shape["side"] or shape["starter"]):
        return None
    spicy = shape["spicy"]
    drink = _best("drink", c, shape["ids"], spicy=bool(spicy))
    if not drink:
        return None
    party = int(c.profile.party_size or 0)
    qty = party if party >= 2 else 1
    d, unit = _label(drink), _price(drink)
    total = _money(unit * qty)
    anchor, _row = _anchor(c)
    dish = str((spicy[0] if spicy else anchor or {}).get("name") or "")
    if qty > 1:
        bn = f"আপনারা {qty} জন — সবার জন্য {qty}টা {d} দেব? ({total})"
        en = f"There are {qty} of you — {qty} × {d} for the table? ({total})"
    elif spicy:
        bn = f"{dish} বেশ ঝাল — সাথে একটা ঠান্ডা {d} ভালো যাবে ({total})। দেব?"
        en = f"The {dish} is quite spicy — a cold {d} goes well with it ({total}). Shall I add one?"
    elif dish:
        bn = f"{dish}-এর সাথে একটা {d} নেবেন? ({total})"
        en = f"Would you like a {d} with the {dish}? ({total})"
    else:
        bn = f"সাথে একটা {d} নেবেন? ({total})"
        en = f"Would you like a {d} with that? ({total})"
    text = _say(c, bn, en, f"{qty}টা {d} {total} — দেব?", f"{qty} × {d} for {total}?")
    why = "cold, for the spice" if spicy else ("one each" if qty > 1 else "to drink")
    return Offer("drink", moment, text, [_add_op(drink, c, qty)], [c.index.item_id(drink)], unit * qty,
                 card=_card(drink, c, why))


def _addon(moment: str, c: Ctx) -> Optional[Offer]:
    """The dish just added has extras nobody picked (a dip for the wings) → the one most ordered / first listed."""
    it, row = _anchor(c)
    if not it or not row:
        return None
    chosen = {str(m.get("name")) for m in row.get("modifiers") or []}
    optional = [g for g in it.get("modifierGroups") or [] if int(g.get("min") or 0) == 0]
    if any(o.get("name") in chosen for g in optional for o in g.get("options") or []):
        return None  # they already picked an extra
    for g in it.get("modifierGroups") or []:
        if int(g.get("min") or 0) > 0 or _MEAL_OPTION.search(str(g.get("name") or "")):
            continue
        # (not what the dish already comes with: "Golden chicken tenders with garlic mayo" → no Garlic mayo)
        said_in = f"{it.get('name') or ''} {it.get('description') or ''}".lower()
        opts = [o for o in g.get("options") or [] if o.get("name") and float(o.get("price") or 0) > 0
                and str(o["name"]).lower() not in said_in]
        if not opts:
            continue
        o = opts[0]
        dish, opt, plus = str(it.get("name")), str(o["name"]), _money(float(o.get("price") or 0))
        q = int(row.get("quantity") or 1)
        text = _say(c, f"{dish}-এর সাথে একটা {opt} নেবেন? +{plus} — দেব?",
                    f"Would you like {opt} with the {dish}? +{plus}",
                    f"{opt} +{plus} — দেব?", f"Add {opt} for +{plus}?")
        return Offer("addon", moment, text, [_edit_op(it, row, [opt], c)], [c.index.item_id(it)],
                     float(o.get("price") or 0) * q)
    return None


def _dessert(moment: str, c: Ctx) -> Optional[Offer]:
    """At the end, after a real meal, nothing sweet yet (not at breakfast) → one dessert."""
    shape = _roles(c)
    if shape["dessert"] or not shape["real_food"] or "breakfast" in {str(k).lower() for k in c.meal_kinds}:
        return None
    d = _best("dessert", c, shape["ids"])
    if not d:
        return None
    name, p = _label(d), _money(_price(d))
    text = _say(c, f"শেষে মিষ্টি কিছু হবে? {name} ({p}) — দেব?", f"Something sweet to finish — the {name} ({p})?",
                f"{name} {p} — দেব?", f"{name} for {p}?")
    return Offer("dessert", moment, text, [_add_op(d, c)], [c.index.item_id(d)], _price(d), card=_card(d, c, "to finish"))


# ------------------------------------------------------------------ in the reply

def swap_closing(reply: str, offer_text: str) -> str:
    """"…যোগ করলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" → "…যোগ করলাম। <the offer>" (it asks its own question)."""
    from upsell import _CLOSING_BN, _CLOSING_EN

    pat = _CLOSING_BN if _CLOSING_BN.search(reply or "") else _CLOSING_EN
    return (pat.sub("", reply or "").rstrip() + " " + offer_text).strip()


# ------------------------------------------------------------------ yes / no

def accepted_text(o: Dict[str, Any], ops: List[Dict[str, Any]], lang: str) -> str:
    """"1টা Coca-Cola যোগ করলাম।" / "Hot Wings-এর সাথে Garlic mayo যোগ করলাম।" — what the yes did."""
    bn = lang == "bn"
    bits = []
    for op in ops:
        if op["op"] == "add":
            label = op["name"] + (f" ({op['variant']})" if op.get("variant") else "")
            bits.append(f"{op['quantity']}টা {label} যোগ করলাম।" if bn else f"Added {op['quantity']} × {label}.")
        elif op["op"] == "edit":
            new = [c for c in op.get("choices") or []][-1:] or [""]
            bits.append(f"{op['name']}-এর সাথে {new[0]} যোগ করলাম।" if bn else f"Added {new[0]} to the {op['name']}.")
        elif op["op"] == "set":
            bits.append(f"{op['name']} এখন {op['quantity']}টা।" if bn else f"{op['name']} is now {op['quantity']}.")
    if o.get("type") == "combo":
        bits = [f"{ops[-1]['name']} করে দিলাম।" if bn else f"Switched to the {ops[-1]['name']}."]
    return " ".join(bits)


# ------------------------------------------------------------------ C2: the size-up, in the option picker

def size_hints(sizes: List[Dict[str, Any]], lang: str) -> Dict[str, str]:
    """{"10 pcs": "আরও ৪ পিস, মাত্র +৳170"} — the bigger sizes' step up (per piece when the names say how many), and
    "best value" on the one that costs least per piece. Shown on the chips; never asked."""
    bn = lang == "bn"
    priced = sorted([s for s in sizes if isinstance(s.get("price"), (int, float))], key=lambda s: float(s["price"]))
    out: Dict[str, str] = {}
    if len(priced) < 2:
        return out
    count = {s["name"]: int(m.group(1)) for s in priced for m in [re.search(r"(\d+)", str(s["name"]))] if m}
    per = {n: float(s["price"]) / count[n] for s in priced for n in [s["name"]] if count.get(n)}
    best = min(per, key=per.get) if len(per) == len(priced) else None
    for prev, s in zip(priced, priced[1:]):
        diff = _money(float(s["price"]) - float(prev["price"]))
        more = count.get(s["name"], 0) - count.get(prev["name"], 0) if s["name"] in count and prev["name"] in count else 0
        if more > 0:
            out[s["name"]] = f"আরও {more} পিস, মাত্র +{diff}" if bn else f"{more} more for +{diff}"
        else:
            out[s["name"]] = f"মাত্র +{diff}" if bn else f"just +{diff}"
        if best == s["name"]:
            out[s["name"]] += " · সবচেয়ে সাশ্রয়ী" if bn else " · best value"
    return out
