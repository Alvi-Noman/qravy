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

import bangla_meal
import menu_answers
import tray as _tray
from recommender import GuestProfile, OrderStats, dish_facts, is_packaged
from upsell import dish_roles
from upsell import of_bn as upsell_of_bn
from waiter_knowledge import MenuIndex, _money, kind_text

MAX_OFFERS = 2  # a visit
MAX_DECLINES = 2  # two "no"s → no more offers this visit

_MEAL_OPTION = re.compile(r"\bmeal\b|combo|\+|মিল", re.I)
_COMBO_DISH = re.compile(r"\bcombo\b|\bmeal\b|\bset\b", re.I)
_SPICY_CHOICE = re.compile(r"spicy|hot|ঝাল", re.I)
_COLD = re.compile(r"lemonade|shake|juice|lassi|cola|coke|sprite|7 ?up|fanta|soda|iced|cold|mojito|smoothie|borhani|"
                   r"লাচ্ছি|লাস্সি|জুস|লেবু|লাইম|কোলা|কোক|স্প্রাইট|ফান্টা|সেভেন আপ|ঠান্ডা|ঠাণ্ডা|আইস|বোরহানি|মোজিতো|শরবত|রস", re.I)
_HOT = re.compile(r"\btea\b|coffee|espresso|latte|cappuccino|americano|\bhot\b|(?<![ঀ-৿])চা(?![ঀ-৿])|কফি|গরম", re.I)
_ICED = re.compile(r"iced|\bice\b|cold|আইসড|আইস্ড|আইস|ঠান্ডা|ঠাণ্ডা|frapp", re.I)
_BORHANI = re.compile(r"borhani|বোরহানি", re.I)
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
    # (timing is always "early" now: the "late" half of the sessions never heard an offer at all — the end offer was
    # skipped after every "আর কিছু লাগবে…?" — only the wording is still split)
    return {"wording": "reason" if h % 2 == 0 else "short", "timing": "early"}


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
    # a question with named answers ("পরোটা নেবেন, নাকি নান?"): [{"label", "match" (regex), "items" (ids)}] — one
    # dish → added; several → "কোন নান দেব — …?"
    choices: Optional[List[Dict[str, Any]]] = None
    # asked after a yes ("…সাথে ভাত দেব?" → "ভাতের সাথে মাছ নেবেন, নাকি মাংস?"): {"text", "choices"}
    then: Optional[Dict[str, Any]] = None

    def __post_init__(self) -> None:
        # the 🌶 / ✓ marks on a dish name are for the menu card — never said ("…ষোল আনা স্পেশাল চা 🌶🌶 নেবেন?")
        self.text = re.sub(r"\s{2,}", " ", bangla_meal._SYMBOLS.sub("", self.text or "")).replace(" ?", "?").strip()

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
    # the owner's upsells (Settings → Upsell & picks): "a guest orders these → offer these" — they come first
    owner_rules: List[Dict[str, Any]] = field(default_factory=list)


def may_offer(reco: Any, moment: str, arm: Dict[str, str]) -> bool:
    """The budget and the timing arm (the per-turn "never now" rules are brain's: it knows the turn)."""
    if int(getattr(reco, "offers_made", 0) or 0) >= MAX_OFFERS:
        return False
    if int(getattr(reco, "offer_declines", 0) or 0) >= MAX_DECLINES:
        return False
    if moment == "first_add" and arm.get("timing") == "late":
        return False
    return True


# what completes a meal (rice / bread with a curry or a kebab, rice with ডাল / ভর্তা) — asked whatever the timing arm:
# a ডাল with nothing to eat it with isn't an upsell
MEAL_COMPLETING = ("rice", "bread", "bread_side")


def plan(moment: str, c: Ctx, only: Optional[Iterable[str]] = None) -> Optional[Offer]:
    """The one offer for this moment (or None): the biggest gap first. `only`: just these offer types."""
    if not c.rows:
        return None
    if only is not None:
        if moment != "first_add" or not any(o.get("op") == "add" for o in c.added):
            return None
        o = _rice(moment, c)
        if o and o.type in set(only) and o.type not in set(c.done_types):
            o.arm = dict(c.arm)
            return o
        return None
    # the owner's own rule beats the engine's pick (any dish the guest just ordered, or anything in the tray at the end)
    own = _owner(moment, c)
    if own:
        own.arm = dict(c.arm)
        return own
    if moment == "first_add":
        added_food = [o for o in c.added if o.get("op") == "add" and _is_food(c.index.by_id.get(str(o.get("itemId"))))]
        if not added_food:
            # a coffee / tea → a bite with it (the café classic); any other drink / dessert — nothing to build on
            o = _bite(moment, c)
            if o and o.type not in set(c.done_types):
                o.arm = dict(c.arm)
                return o
            return None
        # a table of four with one burger: "make it four" comes before any extra; with spicy food a cold drink
        # comes before a side
        spicy = bool(_roles(c)["spicy"])
        steps = (_more_food, _combo_swap, _meal_addon, _rice, _with_bread, _main) + ((_drink, _side) if spicy else (_side, _drink)) + (_addon,)
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
    bhaat = kind == "rice" and bangla_meal.is_bhaat_house(c.index.items)
    anchor_it, _ = _anchor(c)
    anchor_name = str((anchor_it or {}).get("name") or "")
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
            hot = bool(_HOT.search(kind_text(it))) and not _ICED.search(name)
            # tea / coffee go with breakfast or the afternoon — never "a cold one for the spice", never with a meal
            # ("বিফ শিক কাবাব বেশ ঝাল — সাথে একটা ঠান্ডা ষোল আনা স্পেশাল চা")
            if hot and (spicy or not set(c.meal_kinds or ()) & {"breakfast", "afternoon"}):
                continue
            s += 0.6 if not is_packaged(it) else 0.0
            if hot and "breakfast" in set(c.meal_kinds or ()) and re.search(r"\b(cha|chai|tea)\b|(?<![ঀ-৿])চা(?![ঀ-৿])", name, re.I):
                s += 1.0  # পরোটা-ডিমের সাথে চা — the Bengali breakfast cup, before a coffee
            s += 0.8 if spicy and _COLD.search(name) else 0.0
            if _BORHANI.search(name) and any(dish_facts(c.index.by_id[i])["complete_meal"] for i in ctx_ids if i in c.index.by_id):
                s += 1.5  # borhani with the kacchi / biryani — what every guest there drinks
        if kind == "rice":
            s += 1.0 if re.search(r"\brice\b", kind_text({"name": name})) else 0.0  # fried rice: the classic partner for a curry
            s += 0.5 if not re.search(r"special|prawn|mixed|স্পেশাল|মিক্স", name, re.I) else 0.0  # plain, affordable
            if bhaat and bangla_meal.is_plain_rice(it):
                s += 1.5  # a Bengali rice-and-curry place: সাদা ভাত with the ভুনা, not naan or fried rice
            if _ROAST.search(anchor_name) and re.search(r"polao|pulao|পোলাও", name + " " + kind_text({"name": name}), re.I):
                s += 3.0  # মুরগির রোস্ট / রেজালা / কোরমা with পোলাও — the wedding plate, not সাদা ভাত
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

def _owner(moment: str, c: Ctx) -> Optional[Offer]:
    """The owner's rule: the guest ordered one of its dishes (or a dish of its categories) → offer its first dish
    that can be added now (orderable, not in the tray, no required choice, not declined, no clash). Right after the
    order: the dishes just added; at "that's all": anything in the tray. Each offered dish only once a visit."""
    rules = [r for r in c.owner_rules or [] if isinstance(r, dict) and r.get("on", True) is not False]
    if not rules:
        return None
    tray_ids = {str(r.get("itemId")) for r in c.rows}
    if moment == "first_add":
        trig = [c.index.by_id.get(str(o.get("itemId"))) for o in c.added if o.get("op") == "add"]
    else:
        trig = [c.index.by_id.get(str(r.get("itemId"))) for r in c.rows]
    trig = [t for t in trig if t]
    if not trig:
        return None
    done = set(c.done_types)
    for rule in rules:
        when_ids = {str(x) for x in rule.get("whenItemIds") or []}
        cats = {str(x).strip().lower() for x in rule.get("whenCategories") or [] if str(x).strip()}
        anchor = next((t for t in trig if c.index.item_id(t) in when_ids
                       or str(t.get("category") or "").strip().lower() in cats), None)
        if not anchor:
            continue
        for oid in [str(x) for x in rule.get("offerItemIds") or []]:
            it = c.index.by_id.get(oid)
            if (not it or oid in tray_ids or not c.orderable.get(oid, True) or not _simple(it)
                    or oid in (c.profile.declined or []) or c.clash(it) or f"owner:{oid}" in done):
                continue
            dish, d, p = str(anchor.get("name") or ""), _label(it), _money(_price(it))
            text = _say(c, f"{dish}-এর সাথে একটা {d} নেবেন? ({p})", f"Would you like a {d} with the {dish}? ({p})",
                        f"{d} {p} — দেব?", f"{d} for {p}?")
            return Offer(f"owner:{oid}", moment, text, [_add_op(it, c)], [oid], _price(it),
                         card=_card(it, c, f"with your {dish}"))
    return None


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
    # one each is for a dish one person eats (a burger, a kacchi, a set menu) — a curry, a sizzling, a Chinese main is
    # shared at the table with rice ("আপনারা 6 জন — Chicken Masala 6টা করে দেব?" was nonsense)
    f = dish_facts(it)
    if not (r["handheld"] or (f["complete_meal"] and not re.search(r"platter|family|sizzl|for \d|for (two|three|four)", f["text"]))):
        return None
    have = int(row.get("quantity") or 1)
    unit = float(row.get("price") or 0)
    extra = _money(unit * (party - have))
    op = {"op": "set", "itemId": c.index.item_id(it), "name": str(it.get("name")), "lineKey": row.get("key"), "quantity": party}
    dish = str(it.get("name"))
    text = _say(c, f"আপনারা {party} জন — {dish} {party}টা করে দেব? (আরও {extra})",
                f"There are {party} of you — make it {party} × {dish}? ({extra} more)",
                f"{dish} {party}টা করে দেব? +{extra}", f"Make it {party} × {dish}? +{extra}")
    in_tray = sum(float(x.get("price") or 0) * int(x.get("quantity") or 1) for x in c.rows)
    if c.profile.budget and in_tray + unit * (party - have) > c.profile.budget:
        return None  # never offered past the budget they gave
    return Offer("more_food", moment, text, [op], [c.index.item_id(it)], unit * (party - have))


_KEBAB = re.compile(r"kebab|kabab|tikka|shashlik|\bgrill\b|tandoori|\bboti\b|chaap|reshmi|seekh|\bshik\b|কাবাব|টিক্কা|গ্রিল|চাপ")
_POROTA = re.compile(r"পরোটা|পারাটা|রুটি|\b(porota|paratha|parata|roti|ruti|chapati)\b", re.I)
_NAAN = re.compile(r"(?<![ঀ-৿])নান(?![ঀ-৿])|\bnaa?n\b", re.I)


def is_kebab(it: Dict[str, Any]) -> bool:
    """A kebab / tikka / grill eaten with bread — not a "grilled chicken burger" or a kebab roll (held in the hand)
    or a platter (a meal of its own)."""
    r = dish_roles(it)
    name = str(it.get("name") or "")
    if _ROAST.search(name) and not re.search(r"kebab|kabab|tikka|tandoori|grill|কাবাব|টিক্কা|তন্দুরি|গ্রিল", name, re.I):
        return False  # মুরগির রোস্ট is the wedding curry (with পোলাও), not a grill
    return bool(_KEBAB.search(kind_text({"name": name}))) and not (r["handheld"] or r["drink"] or r["dessert"]
                                                                     or r["rice"] or dish_facts(it)["complete_meal"])


def _plain_first(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The plain one first ("পরোটা" before "পাঁচ পরোটা"): the shortest name."""
    return sorted(items, key=lambda it: len(bangla_meal.said_name(it)))


def _sellable(c: Ctx, it: Dict[str, Any], tray_ids: set) -> bool:
    iid = c.index.item_id(it)
    return (iid not in tray_ids and c.orderable.get(iid, True) and _simple(it)
            and iid not in (c.profile.declined or []) and not c.clash(it))


def bread_offer(moment: str, c: Ctx, tray_ids: set) -> Optional[Offer]:
    """Kebabs and no bread → "সাথে পরোটা নেবেন, নাকি নান?" (both on the menu), or the one bread there is."""
    breads = [b for b in c.index.items if dish_roles(b)["rice"] and not bangla_meal.is_plain_rice(b)
              and (_POROTA.search(str(b.get("name") or "")) or _NAAN.search(str(b.get("name") or "")))
              and _sellable(c, b, tray_ids)]
    porota = _plain_first([b for b in breads if _POROTA.search(str(b.get("name") or ""))])
    naan = _plain_first([b for b in breads if _NAAN.search(str(b.get("name") or "")) and b not in porota])
    if not (porota or naan):
        return None
    bn = c.lang == "bn"
    if porota and naan:
        text = "সাথে পরোটা নেবেন, নাকি নান?" if bn else "Would you like paratha or naan with it?"
        choices = [{"label": "পরোটা" if bn else "paratha", "match": _POROTA.pattern, "items": [c.index.item_id(b) for b in porota]},
                   {"label": "নান" if bn else "naan", "match": _NAAN.pattern, "items": [c.index.item_id(b) for b in naan]}]
        return Offer("bread", moment, text, [], [x for ch in choices for x in ch["items"]], _price((porota + naan)[0]),
                     choices=choices)
    b = (porota or naan)[0]
    name, p = bangla_meal.said_name(b), _money(_price(b))
    text = _say(c, f"সাথে {name} দেব? ({p})", f"{name} with it? ({p})", f"সাথে {name} দেব? {p}", f"{name}? {p}")
    return Offer("bread", moment, text, [_add_op(b, c)], [c.index.item_id(b)], _price(b), card=_card(b, c, "with your kebab"))


_DAL = re.compile(r"(?<![ঀ-৿])ডাল(?![ঀ-৿])|\bdh?aa?l\b|lentil", re.I)
_EGG = re.compile(r"ডিম|\begg\b|omelet", re.I)
_BHAJI = re.compile(r"ভাজি|সবজি|\b(bhaji|vaji|sobji|sabji|vegetable)\b", re.I)


def _with_bread(moment: str, c: Ctx) -> Optional[Offer]:
    """Parathas / naan / roti alone → what they're eaten with: "পরোটার সাথে ডাল নেবেন, নাকি ডিম ভাজি?" (it offered
    nothing — a plate of bread on its own)."""
    it, _row = _anchor(c)
    if not it or not (_POROTA.search(str(it.get("name") or "")) or _NAAN.search(str(it.get("name") or ""))):
        return None
    ids = {str(r.get("itemId")) for r in c.rows}
    if any(dish_roles(c.index.by_id[i])["main"] or bangla_meal.role(c.index.by_id[i]) == "side"
           or _DAL.search(str(c.index.by_id[i].get("name") or "")) or _EGG.search(str(c.index.by_id[i].get("name") or ""))
           for i in ids if i in c.index.by_id and i != c.index.item_id(it)):
        return None  # something to eat it with is there already
    bn = c.lang == "bn"
    choices = []
    for label_bn, label_en, rx in (("ডাল", "dal", _DAL), ("ডিম", "egg", _EGG), ("ভাজি", "bhaji", _BHAJI)):
        hits = _plain_first([x for x in c.index.items if _sellable(c, x, ids) and rx.search(str(x.get("name") or ""))
                             and not dish_roles(x)["drink"] and not _POROTA.search(str(x.get("name") or ""))])
        if hits:
            choices.append({"label": label_bn if bn else label_en, "match": rx.pattern,
                            "items": [c.index.item_id(x) for x in hits[:3]]})
        if len(choices) == 2:
            break
    if not choices:
        return None
    first = c.index.by_id[choices[0]["items"][0]]
    if len(choices) == 1:
        name, p = bangla_meal.said_name(first), _money(_price(first))
        text = _say(c, f"{_of(str(it.get('name')))} সাথে {name} দেব? ({p})", f"{name} with it? ({p})",
                    f"সাথে {name} দেব? {p}", f"{name}? {p}")
        return Offer("bread_side", moment, text, [_add_op(first, c)], [c.index.item_id(first)], _price(first),
                     card=_card(first, c, "with your bread"))
    a, b = choices[0]["label"], choices[1]["label"]
    text = (f"{_of(bangla_meal.said_name(it))} সাথে {a} নেবেন, নাকি {b}?" if bn
            else f"Would you like {a} or {b} with it?")
    return Offer("bread_side", moment, text, [], [x for ch in choices for x in ch["items"]], _price(first), choices=choices)


def _rice_for_side(moment: str, c: Ctx, it: Dict[str, Any], tray_ids: set) -> Optional[Offer]:
    """A Bengali rice place, ডাল / ভর্তা / ভাজি and no rice → "ডাল নিচ্ছেন বুঝেছি — সাথে ভাত দেব?", and after a yes
    "ভাতের সাথে মাছ নেবেন, নাকি মাংস?" (from the curries that can be ordered now)."""
    if bangla_meal.role(it) != "side" or not bangla_meal.is_bhaat_house(c.index.items):
        return None
    if any(bangla_meal.role(c.index.by_id[i]) in ("rice", "fish", "chicken", "meat") or dish_facts(c.index.by_id[i])["rice"]
           for i in tray_ids if i in c.index.by_id):
        return None  # rice or a curry is there already — the ডাল goes with it
    rice = next((r for r in _plain_first([r for r in c.index.items if bangla_meal.is_plain_rice(r)])
                 if _sellable(c, r, tray_ids)), None)
    if not rice:
        return None
    d, p = bangla_meal.said_name(it), _money(_price(rice))
    bn = c.lang == "bn"
    text = (f"{d} নিচ্ছেন বুঝেছি — সাথে ভাত দেব? ({bangla_meal.said_name(rice)} {p})" if bn
            else f"Got the {d} — shall I add rice with it? ({bangla_meal.said_name(rice)}, {p})")
    ordered = [x for x in c.picks if c.orderable.get(c.index.item_id(x), True)] + list(c.index.items)
    fish = [x for x in dict.fromkeys(map(c.index.item_id, ordered)) if bangla_meal.role(c.index.by_id[x]) == "fish"
            and _sellable(c, c.index.by_id[x], tray_ids)]
    meat = [x for x in dict.fromkeys(map(c.index.item_id, ordered)) if bangla_meal.role(c.index.by_id[x]) in ("meat", "chicken")
            and _sellable(c, c.index.by_id[x], tray_ids)]
    then = None
    if fish and meat:
        then = {"text": "ভাতের সাথে মাছ নেবেন, নাকি মাংস?" if bn else "With the rice — fish, or meat?",
                "choices": [{"label": "মাছ" if bn else "fish", "match": r"মাছ|\bfish\b|\bmach\b", "items": fish},
                            {"label": "মাংস" if bn else "meat",
                             "match": r"মাংস|মাংশ|গরু|খাসি|মাটন|মুরগি|মুরগী|চিকেন|বিফ|হাঁস|\b(meat|beef|mutton|chicken)\b", "items": meat}]}
    return Offer("rice", moment, text, [_add_op(rice, c)], [c.index.item_id(rice)], _price(rice),
                 card=_card(rice, c, f"with your {d}"), then=then)


def _rice(moment: str, c: Ctx) -> Optional[Offer]:
    """A curry with nothing to eat it with → the rice / bread that goes with it."""
    it, _row = _anchor(c)
    shape = _roles(c)
    if it:
        side = _rice_for_side(moment, c, it, shape["ids"])
        if side:
            return side
        # a kebab — and nehari / paya / haleem, or any curry at breakfast — is eaten with bread
        with_bread = is_kebab(it) or bool(_BREAD_DISH.search(str(it.get("name") or "") + " " + kind_text({"name": it.get("name")}))) or (
            "breakfast" in {str(k).lower() for k in c.meal_kinds} and dish_roles(it)["needs_rice"])
        if with_bread and not any(
                dish_roles(c.index.by_id[i])["rice"] for i in shape["ids"] if i in c.index.by_id):
            bread = bread_offer(moment, c, shape["ids"])
            if bread:
                return bread
    if not it or not dish_roles(it)["needs_rice"] or any(
            dish_roles(c.index.by_id[i])["rice"] for i in shape["ids"] if i in c.index.by_id):
        return None
    r = _best("rice", c, shape["ids"])
    if not r:
        return None
    dish, name, p = str(it.get("name")), _label(r), _money(_price(r))
    party = int(c.profile.party_size or 0)
    plates = max(party, int((_row or {}).get("quantity") or 1))
    if plates >= 2 and _ROAST.search(dish) and re.search(r"polao|pulao|পোলাও", name + " " + kind_text({"name": name}), re.I):
        # "চারটা মুরগির রোস্ট" → a plate of polao with each: "4টা মুরগির রোস্টের সাথে 4টা এক্সট্রা পোলাও রাইস দেব? (৳320)"
        d, rn, tot = bangla_meal.said_name(it), bangla_meal.said_name(r), _money(_price(r) * plates)
        text = _say(c, f"{plates}টা {upsell_of_bn(d)} সাথে {plates}টা {rn} দেব? ({tot})",
                    f"{plates} × {rn} with the {d}? ({tot})", f"{plates}টা {rn} {tot} — দেব?", f"{plates} × {rn} for {tot}?")
        return Offer("rice", moment, text, [_add_op(r, c, plates)], [c.index.item_id(r)], _price(r) * plates,
                     card=_card(r, c, "one each"))
    if party >= 2 and bangla_meal.is_plain_rice(r) and bangla_meal.is_bhaat_house(c.index.items):
        # a table of five eats five plates of rice: "আপনারা 5 জন — সবার জন্য 5টা সাদা ভাত দেব? (৳200)"
        rn, tot = bangla_meal.said_name(r), _money(_price(r) * party)
        text = _say(c, f"আপনারা {party} জন — সবার জন্য {party}টা {rn} দেব? ({tot})",
                    f"There are {party} of you — {party} × {rn} for the table? ({tot})",
                    f"{party}টা {rn} {tot} — দেব?", f"{party} × {rn} for {tot}?")
        return Offer("rice", moment, text, [_add_op(r, c, party)], [c.index.item_id(r)], _price(r) * party,
                     card=_card(r, c, "one each"))
    if bangla_meal.is_plain_rice(r) and bangla_meal.is_bhaat_house(c.index.items):
        # how a Bengali waiter asks: "গরুর লাল ভুনার সাথে ভাত দেব?" (the dish said plainly, no "-এর", no "(মিনিকেট…)")
        d, rn = bangla_meal.said_name(it), bangla_meal.said_name(r)
        poss = d + ("য়ের" if re.search(r"[িীইঈ]$", d) else "")
        poss = poss if poss != d else upsell_of_bn(d)
        text = _say(c, f"{poss} সাথে ভাত দেব? ({rn} {p})", f"Rice with the {d}? ({rn}, {p})",
                    f"সাথে ভাত দেব? {p}", f"Rice with it? {p}")
    else:
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
    text = _say(c, f"স্টার্টারের পর মেইন কোর্সে {name} নেবেন? ({p})",
                f"For the main course, how about the {name} ({p})? Shall I add it?",
                f"মেইন কোর্সে {name} {p} — দেব?", f"{name} for the main, {p}?")
    return Offer("main", moment, text, [_add_op(m, c)], [c.index.item_id(m)], _price(m),
                 card=_card(m, c, "for the main course"))


def _side(moment: str, c: Ctx) -> Optional[Offer]:
    """A burger / wings with nothing on the side → the side that goes with it."""
    shape = _roles(c)
    it, _row = _anchor(c)
    # a Bengali rice-house curry / fish (the rice is there or coming) with nothing on the side → the waiter's classic:
    # "সাথে ডাল নেবেন, নাকি আলু ভর্তা?"
    if it and bangla_meal.role(it) in ("fish", "chicken", "meat") and bangla_meal.is_bhaat_house(c.index.items):
        ids = {str(r.get("itemId")) for r in c.rows}
        if any(bangla_meal.role(c.index.by_id[i]) == "side" for i in ids if i in c.index.by_id):
            return None
        dal = _plain_first([x for x in c.index.items if _sellable(c, x, ids) and bangla_meal.role(x) == "side"
                            and _DAL.search(str(x.get("name") or ""))])
        bhorta = _plain_first([x for x in c.index.items if _sellable(c, x, ids) and bangla_meal.role(x) == "side"
                               and re.search(r"আলু ভর্তা|বেগুন ভর্তা|ভর্তা|bhorta|bharta", str(x.get("name") or ""), re.I)])
        bn = c.lang == "bn"
        if dal and bhorta:
            choices = [{"label": "ডাল" if bn else "dal", "match": _DAL.pattern, "items": [c.index.item_id(dal[0])]},
                       {"label": bangla_meal.said_name(bhorta[0]), "match": re.escape(bangla_meal.said_name(bhorta[0]).split()[0]) + "|ভর্তা|bhorta",
                        "items": [c.index.item_id(bhorta[0])]}]
            text = (f"সাথে ডাল নেবেন, নাকি {bangla_meal.said_name(bhorta[0])}?" if bn
                    else f"Some dal or {bangla_meal.said_name(bhorta[0])} with it?")
            return Offer("side", moment, text, [], [ch["items"][0] for ch in choices], _price(dal[0]), choices=choices)
        one = (dal or bhorta or [None])[0]
        if one is None:
            return None
        name, p = bangla_meal.said_name(one), _money(_price(one))
        text = _say(c, f"সাথে {name} দেব? ({p})", f"{name} with it? ({p})", f"{name} {p} — দেব?", f"{name} for {p}?")
        return Offer("side", moment, text, [_add_op(one, c)], [c.index.item_id(one)], _price(one), card=_card(one, c, "on the side"))
    fam = menu_answers.families(it) if it else set()
    # (+ a pizza / pasta → the garlic bread, fried chicken / wings → the fries: what everyone orders with them)
    if shape["side"] or not it or not (dish_roles(it)["handheld"] or fam & {"pizza", "pasta", "fried_chicken"}):
        return None
    want = (r"garlic bread|bread ?sticks?|wings|গার্লিক ব্রেড" if fam & {"pizza", "pasta"} else
            r"fries|wedges|coleslaw|onion ring|ফ্রাই" if fam & {"fried_chicken", "burger", "handheld"} else "")
    side = None
    if want:
        fits = [x for x in c.index.items if _sellable(c, x, shape["ids"]) and re.search(want, str(x.get("name") or ""), re.I)
                and not dish_roles(x)["drink"] and x is not it]
        side = min(fits, key=lambda x: (bool(re.search(r"peri|cheese|loaded|parmesan|special", str(x.get("name") or ""), re.I)),
                                         _price(x))) if fits else None
    side = side or _best("side", c, shape["ids"])
    if not side:
        return None
    dish, s, p = str(it.get("name")), _label(side), _money(_price(side))
    text = _say(c, f"{_of(dish)} সাথে {s} খুব ভালো জমে ({p}) — দেব?",
                f"{s} goes great with the {dish} ({p}) — shall I add it?",
                f"{s} {p} — দেব?", f"{s} for {p}?")
    return Offer("side", moment, text, [_add_op(side, c)], [c.index.item_id(side)], _price(side),
                 card=_card(side, c, f"with your {dish}"))


_ROAST = re.compile(r"roast|rezala|korma|রোস্ট|রেজালা|কোরমা", re.I)
_BREAD_DISH = re.compile(r"nehari|paya|haleem|halim|নেহারি|পায়া|হালিম", re.I)
_HOT_DRINK = re.compile(r"coffee|espresso|latte|cappuccino|americano|mocha|\btea\b|(?<![ঀ-৿])চা(?![ঀ-৿])|কফি", re.I)
_BITE = re.compile(r"cake|brownie|cookie|pastry|muffin|croissant|donut|doughnut|waffle|cheesecake|sandwich|biscuit|"
                   r"singara|samosa|কেক|ব্রাউনি|কুকি|পেস্ট্রি|স্যান্ডউইচ|বিস্কুট|সিঙ্গারা|সমুচা", re.I)


def _bite(moment: str, c: Ctx) -> Optional[Offer]:
    """A coffee / tea just ordered, nothing to eat with it → "Cappuccino-র সাথে একটা Brownie নেবেন? (৳150)"."""
    it = next((c.index.by_id.get(str(o.get("itemId"))) for o in c.added if o.get("op") == "add"), None)
    if not it or not _HOT_DRINK.search(kind_text(it) + " " + str(it.get("name") or "")):
        return None
    ids = {str(r.get("itemId")) for r in c.rows}
    if any(_BITE.search(str((c.index.by_id.get(i) or {}).get("name") or "")) or dish_roles(c.index.by_id[i])["dessert"]
           for i in ids if i in c.index.by_id):
        return None
    bites = [b for b in c.index.items if _sellable(c, b, ids) and _BITE.search(kind_text(b) + " " + str(b.get("name") or ""))]
    if not bites:
        return None
    rank = {c.index.item_id(x): n for n, x in enumerate(c.picks)}
    b = min(bites, key=lambda x: (-c.stats.pair_score(c.index.item_id(x), ids), rank.get(c.index.item_id(x), 99), _price(x)))
    name, p = _label(b), _money(_price(b))
    dish = str(it.get("name") or "")
    text = _say(c, f"{_of(dish)} সাথে একটা {name} নেবেন? ({p})", f"A {name} with your {dish}? ({p})",
                f"{name} {p} — দেব?", f"{name} for {p}?")
    return Offer("bite", moment, text, [_add_op(b, c)], [c.index.item_id(b)], _price(b), card=_card(b, c, f"with your {dish}"))


def _of(name: str) -> str:
    """"গরুর লাল ভুনা" → "গরুর লাল ভুনার", "Chicken Roast" → "Chicken Roast-এর"."""
    said = bangla_meal.said_name({"name": name})
    return upsell_of_bn(said) if re.search(r"[ঀ-৿]$", said) else f"{said}-এর"


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
    # one each: the table's head-count, or — not said — the plates one person eats each (2 kacchis → 2 borhani)
    plates = sum(int(r.get("quantity") or 1) for r in c.rows if str(r.get("itemId")) in c.index.by_id
                 and menu_answers.course(c.index.by_id[str(r.get("itemId"))]) == "main"
                 and menu_answers.families(c.index.by_id[str(r.get("itemId"))]) & {"burger", "handheld", "rice_dish", "set"})
    qty = party if party >= 2 else (min(plates, 6) if plates >= 2 else 1)
    d, unit = _label(drink), _price(drink)
    total = _money(unit * qty)
    anchor, _row = _anchor(c)
    # (the meal, not its rice: "গরুর লাল ভুনার সাথে…", never "সাদা ভাত-এর সাথে একটা রসনা নেবেন?")
    if anchor is not None and not (dish_roles(anchor)["main"] or dish_roles(anchor)["handheld"]):
        anchor = next((c.index.by_id[str(r["itemId"])] for r in reversed(c.rows) if str(r["itemId"]) in c.index.by_id
                       and (dish_roles(c.index.by_id[str(r["itemId"])])["main"]
                            or dish_roles(c.index.by_id[str(r["itemId"])])["handheld"])), anchor)
    dish = str((spicy[0] if spicy else anchor or {}).get("name") or "")
    if qty > 1 and party >= 2:
        bn = f"আপনারা {qty} জন — সবার জন্য {qty}টা {d} দেব? ({total})"
        en = f"There are {qty} of you — {qty} × {d} for the table? ({total})"
    elif spicy:
        one = "একটা" if qty == 1 else f"{qty}টা"
        bn = f"{dish} বেশ ঝাল — সাথে {one} ঠান্ডা {d} ভালো যাবে ({total})। দেব?"
        en = (f"The {dish} is quite spicy — a cold {d} goes well with it ({total}). Shall I add one?" if qty == 1
              else f"The {dish} is quite spicy — {qty} cold {d}s go well with it ({total}). Shall I add them?")
    elif qty > 1:
        bn = f"{_of(dish)} সাথে {qty}টা {d} দেব? ({total})"
        en = f"{qty} × {d} with the {dish}? ({total})"
    elif dish:
        bn = f"{_of(dish)} সাথে একটা {d} নেবেন? ({total})"
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
