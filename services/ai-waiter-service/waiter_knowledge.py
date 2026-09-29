"""
Grounding knowledge for the virtual waiter: turns the live menu, restaurant profile and
cart into compact prompt text, plus the small deterministic helpers the brain relies on
(item refs, language choice, yes/no/confirm detection, mention matching).

Everything here is pure (no I/O) so it is cheap to unit-test.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from rapidfuzz import fuzz

from wait_time import clamp_prep

# ------------------------------------------------------------------ item refs


class MenuIndex:
    """Stable short refs (i1, i2, …) for menu items so the model never copies 24-hex ids.

    Items are ordered by (category, sortOrder, name) so the rendered catalog — the big,
    cacheable part of the prompt — is byte-identical between turns while the menu is unchanged.
    """

    def __init__(self, items: Iterable[Dict[str, Any]]):
        rows = [i for i in items if i and (i.get("id") or i.get("_id")) and i.get("name")]
        rows.sort(
            key=lambda i: (
                str(i.get("category") or "~"),
                i.get("sortOrder") if isinstance(i.get("sortOrder"), (int, float)) else 1e9,
                str(i.get("name")).lower(),
            )
        )
        self.items: List[Dict[str, Any]] = rows
        self.by_ref: Dict[str, Dict[str, Any]] = {}
        self.ref_by_id: Dict[str, str] = {}
        self.by_id: Dict[str, Dict[str, Any]] = {}
        self._names: Dict[str, str] = {}
        for n, it in enumerate(rows, start=1):
            ref = f"i{n}"
            iid = str(it.get("id") or it.get("_id"))
            self.by_ref[ref] = it
            self.ref_by_id[iid] = ref
            self.by_id[iid] = it
            for label in [it.get("name"), *(it.get("aliases") or [])]:
                key = _norm(label)
                if key and key not in self._names:
                    self._names[key] = iid

    def resolve(self, ref: Any = None, name: Any = None) -> Optional[Dict[str, Any]]:
        """Short ref, real id or (alias) name → menu item. Exact matches first, then fuzzy name."""
        r = str(ref or "").strip()
        if r:
            if r in self.by_ref:
                return self.by_ref[r]
            if r.lower() in self.by_ref:
                return self.by_ref[r.lower()]
            if r in self.by_id:
                return self.by_id[r]
        for label in (name, r):
            key = _norm(label)
            if key and key in self._names:
                return self.by_id[self._names[key]]
        key = _norm(name)
        if key and len(key) >= 4:
            best, score = None, 0.0
            for label, iid in self._names.items():
                s = fuzz.ratio(key, label)
                if s > score:
                    best, score = iid, s
            if best and score >= 90:
                return self.by_id[best]
        return None

    def item_id(self, it: Dict[str, Any]) -> str:
        return str(it.get("id") or it.get("_id"))

    def ref(self, it: Dict[str, Any]) -> str:
        return self.ref_by_id.get(self.item_id(it), "")


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s&/()-]", " ", str(s or "").lower())).strip()


# ------------------------------------------------------------------ content hints

# Keyword → label. Applied to name + description + category (never to add-on option names,
# which describe choices rather than contents).
_CONTAINS = [
    (r"\bchicken\b", "chicken"),
    (r"\bbeef\b", "beef"),
    (r"\b(mutton|lamb|goat)\b", "mutton"),
    (r"\bduck\b", "duck"),
    (r"\bpork\b|\bbacon\b|\bham\b", "pork"),
    (r"\b(prawn|shrimp)s?\b", "prawn/shrimp"),
    (r"\b(squid|calamari)\b", "squid"),
    (r"\b(crab|lobster)\b", "crab/lobster"),
    (r"\b(fish|snapper|salmon|tuna|hilsa|ilish|pomfret|bhetki)\b", "fish"),
    (r"\boyster sauce\b", "oyster sauce"),
    (r"\bfish sauce\b", "fish sauce"),
    (r"cashew|peanut|almond|walnut|pistachio|hazelnut|\bnuts?\b", "nuts"),
    (r"\beggs?\b", "egg"),
    (r"\b(cheese|cream|butter|milk|paneer|yogh?urt|lassi|shake|ghee)\b", "dairy"),
    (r"\bmushrooms?\b", "mushroom"),
    (r"\b(noodles?|chow ?mein|won ?thon|wonton|spring roll|chop ?suey|bread|bun|pasta|naan|paratha)\b", "wheat"),
    # house-style conventions (hints, not facts)
    (r"\bspecial\b.*\b(rice|chow ?mein|noodles?|soup|salad|chop ?suey|won ?thon)\b|\b(rice|chow ?mein|noodles?|soup|salad|chop ?suey)\b.*\bspecial\b",
     "usually mixed chicken/prawn/beef"),
    (r"\b(won ?thon|wonton|dumpling|momo)\b", "usually meat/prawn filling"),
    (r"\bset menu\b", "mixed dishes"),
]
_MEATY = {
    "chicken", "beef", "mutton", "duck", "pork", "prawn/shrimp", "squid", "crab/lobster", "fish", "oyster sauce",
    "fish sauce", "usually mixed chicken/prawn/beef", "usually meat/prawn filling", "mixed dishes",
}
# Positive evidence needed before calling an untagged dish "likely vegetarian".
_VEG_WORDS = re.compile(r"\b(vegetables?|veg|veggie|mushrooms?|paneer|tofu|potato|fries|fry|onion rings?|corn)\b")
_HEAT = re.compile(
    r"chil+i|hot sauce|hot\s*&\s*sour|szu-?chuan|sze?chuan|sichuan|masala|red curry|flaming|jalape|spicy|\bhot\b|bird'?s eye|naga"
)
_MILD = re.compile(r"\b(corn|lemon|sweet\s*&\s*sour|clear|cashew|oyster|mushroom|egg fried rice|finger|fry|fries)\b")


def item_hints(it: Dict[str, Any]) -> Dict[str, Any]:
    """Best-effort dietary/heat hints. Menu tags are facts; name-based hints are marked as likely."""
    tags = [str(t).strip().lower() for t in (it.get("tags") or []) if t]
    text = " ".join(str(x or "") for x in (it.get("name"), it.get("description"), it.get("category"))).lower()
    contains = []
    for pat, label in _CONTAINS:
        if re.search(pat, text) and label not in contains:
            contains.append(label)
    if "vegetarian" in tags or "vegan" in tags:
        contains = [c for c in contains if c not in _MEATY]

    # heat comes from the dish's own name/tags, or an explicit word in its description — not from a
    # set menu's component list ("…, Chicken Chili Onion, …" doesn't make the whole set spicy)
    own = " ".join(str(x or "") for x in (it.get("name"), it.get("category"))).lower()
    desc = str(it.get("description") or "").lower()
    if "spicy" in tags or "hot" in tags:
        heat = "spicy"
    elif _HEAT.search(own) or re.search(r"\b(spicy|fiery|very hot)\b", desc):
        heat = "likely spicy"
    elif _MILD.search(own):
        heat = "likely mild"
    else:
        heat = ""

    name = str(it.get("name") or "").lower()
    if "vegan" in tags:
        diet = "vegan"
    elif "vegetarian" in tags:
        diet = "vegetarian"
    elif not (set(contains) & _MEATY) and "egg" not in contains and _VEG_WORDS.search(name) and "soup" not in name:
        diet = "likely vegetarian"
    else:
        diet = ""
    return {"contains": contains, "heat": heat, "diet": diet, "tags": tags}


def _money(v: Any) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "?"
    return f"৳{int(f)}" if f == int(f) else f"৳{f:.2f}"


def _choices_text(it: Dict[str, Any]) -> str:
    parts = []
    for g in it.get("modifierGroups") or []:
        opts = [
            (o.get("name") or "") + (f" +{_money(o.get('price'))}" if (o.get("price") or 0) > 0 else "")
            for o in (g.get("options") or [])
            if o.get("name")
        ]
        if not opts:
            continue
        lo, hi = int(g.get("min") or 0), int(g.get("max") or 0)
        if lo and lo == hi:
            rule = f"must pick {lo}"
        elif lo:
            rule = f"pick {lo}-{hi or len(opts)}"
        else:
            rule = f"optional, up to {hi or len(opts)}"
        parts.append(f'"{g.get("name") or "Choices"}" ({rule}): ' + ", ".join(opts))
    variations = [
        (v.get("name") or "") + (f" {_money(v.get('price'))}" if v.get("price") is not None else "")
        for v in (it.get("variations") or [])
        if v.get("name")
    ]
    if variations:
        parts.append("variants: " + ", ".join(variations))
    return " | ".join(parts)


def _prep_text(it: Dict[str, Any]) -> str:
    """"prep ~12 min" / "prep 15-22 min" (by size) — only when the restaurant set a time for the dish."""
    base = clamp_prep(it.get("prepMinutes"))
    sizes = [clamp_prep(v.get("prepMinutes")) for v in it.get("variations") or []]
    if base is None and not any(sizes):
        return ""
    times = [s or base for s in sizes if (s or base)] or [base]
    lo, hi = min(times), max(times)
    return f"prep ~{lo} min" if lo == hi else f"prep {lo}-{hi} min"


def render_catalog(index: MenuIndex, desc_chars: int = 160) -> str:
    """One line per item, grouped by category. Stable across turns (prompt-cache friendly)."""
    out: List[str] = []
    current = None
    for it in index.items:
        cat = it.get("category") or "Other"
        if cat != current:
            out.append(f"[{cat}]")
            current = cat
        h = item_hints(it)
        bits = [f"{index.ref(it)} {it.get('name')} — {_money(it.get('price'))}"]
        if isinstance(it.get("compareAtPrice"), (int, float)) and it["compareAtPrice"] > (it.get("price") or 0):
            bits.append(f"was {_money(it['compareAtPrice'])}")
        flags = []
        if is_signature(it):
            flags.append("SIGNATURE")
        if h["tags"]:
            flags.append("tags: " + ", ".join(h["tags"]))
        if h["heat"] and "spicy" not in h["tags"]:
            flags.append(h["heat"])
        if h["contains"]:
            flags.append("has: " + ", ".join(h["contains"]))
        if h["diet"] == "likely vegetarian":
            flags.append("likely vegetarian")
        prep = _prep_text(it)
        if prep:
            flags.append(prep)
        if flags:
            bits.append("[" + "; ".join(flags) + "]")
        desc = re.sub(r"\s+", " ", str(it.get("description") or "")).strip()
        if desc:
            bits.append("desc: " + (desc if len(desc) <= desc_chars else desc[: desc_chars - 1] + "…"))
        choices = _choices_text(it)
        if choices:
            bits.append(choices)
        out.append(" · ".join(bits))
    return "\n".join(out)


# ------------------------------------------------------------------ time fit

_HEAVY = re.compile(r"sizzl|whole .*(fish|snapper)|\bsnapper\b|platter|set menu|choice of \d|biry?ani|kacchi|tehari|feast|family")
_DRINK = re.compile(r"beverage|drink|\bwater\b|juice|lassi|shake|\btea\b|coffee|soda|lemonade")
_LIGHT = re.compile(r"soup|salad|spring roll|appeti|starter|snack|\bfr(y|ies)\b|onion ring|won ?thon|finger|pakora|wings|dumpling|momo")
_MAIN = re.compile(r"selection|main|curry|sizzl|rice|noodle|chow ?mein|chop ?suey|set menu|fish|biry?ani|platter")
_RICE_NOODLE = re.compile(r"rice|noodle|chow ?mein|chop ?suey|set menu|curry|choice of")
_BREAKFAST = re.compile(r"breakfast|\beggs?\b|omelet|paratha|porota|toast|khichuri|halim|pancake|\btea\b|coffee|soup")

MEAL_KINDS = ("breakfast", "lunch", "afternoon", "dinner", "late")


def meal_kinds(period_names: Iterable[str], hour: Optional[int]) -> List[str]:
    """Active service-period names ('Lunch', 'Late night'…) → meal kinds; clock hour as fallback."""
    kinds: List[str] = []
    for n in period_names or []:
        n = str(n).lower()
        for kind, pat in (
            ("breakfast", r"breakfast|brunch|morning"),
            ("lunch", r"lunch|(?<!after)noon"),  # "Afternoon" is not lunch
            ("afternoon", r"afternoon|tea|snack"),
            ("dinner", r"dinner|supper|evening"),
            ("late", r"late|night|midnight"),
        ):
            if re.search(pat, n) and kind not in kinds:
                kinds.append(kind)
    if not kinds and hour is not None:
        h = int(hour)
        # after midnight is late night, not lunch (02:56 used to fall through to "lunch")
        kinds = (["late"] if h < 5 else ["breakfast"] if h < 11 else ["lunch"] if h < 15
                 else ["afternoon"] if h < 18 else ["dinner"] if h < 22 else ["late"])
    return kinds


def time_fit(it: Dict[str, Any], kinds: Iterable[str]) -> Tuple[bool, float]:
    """(suits this time?, preference score). Only clearly unsuitable dishes are excluded:
    heavy/sharing dishes at breakfast, a whole fish late at night."""
    text = " ".join(str(x or "") for x in (it.get("name"), it.get("category"))).lower()
    tags = [str(t).lower() for t in it.get("tags") or []]
    kinds = list(kinds) or ["lunch"]
    heavy, drink, light = bool(_HEAVY.search(text)), bool(_DRINK.search(text)), bool(_LIGHT.search(text))
    main, rice = bool(_MAIN.search(text)), bool(_RICE_NOODLE.search(text))

    fits_any, best = False, 0.0
    for k in kinds:
        if k == "breakfast":
            fits = not heavy
            score = 3.0 * bool(_BREAKFAST.search(text)) + 2.0 * light + 1.0 * drink
        elif k == "lunch":
            fits = True
            score = 3.0 * rice + 1.5 * main + 0.5 * light
        elif k == "afternoon":
            fits = True
            score = 3.0 * light + 1.5 * drink + 0.5 * main - 1.0 * heavy
        elif k == "dinner":
            fits = True
            score = 3.0 * heavy + 2.0 * main + 0.5 * light
        else:  # late
            fits = not re.search(r"whole .*(fish|snapper)|\bsnapper\b|platter|feast|family", text)
            score = 2.5 * light + 1.5 * rice + 0.5 * drink - 1.0 * heavy
        if fits:
            fits_any = True
            best = max(best, score)
    if drink and not any(k in ("breakfast", "afternoon") for k in kinds):
        best -= 2.0  # drinks are pairings, not recommendations, at main meals
    best += 2.0 * any(t in ("recommended", "popular", "bestseller", "chef's special") for t in tags)
    if is_signature(it):
        best += 4.0  # the owner's star: first among dishes that suit the time (never overrides fit/availability)
    return fits_any, best


def is_signature(it: Dict[str, Any]) -> bool:
    """Owner star-marked the dish (signature field; a 'signature' tag also counts)."""
    return bool(it.get("signature")) or any(str(t).strip().lower() == "signature" for t in it.get("tags") or [])


def recommendation_pool(
    index: MenuIndex, orderable: Dict[str, bool], kinds: Iterable[str], limit: int = 14
) -> Tuple[List[Dict[str, Any]], set, set]:
    """Dishes to recommend right now: orderable AND suited to the meal period, best first.
    Returns (ranked shortlist, ids suited now, ids orderable-but-unsuited now)."""
    scored, suited, unsuited = [], set(), set()
    for it in index.items:
        iid = index.item_id(it)
        if not orderable.get(iid, True):
            continue
        fits, score = time_fit(it, kinds)
        if fits:
            suited.add(iid)
            scored.append((score, str(it.get("name")), it))
        else:
            unsuited.add(iid)
    scored.sort(key=lambda x: (-x[0], x[1]))
    # keep the shortlist varied: at most 3 per category
    out, per_cat = [], {}
    for _, _, it in scored:
        c = it.get("category") or ""
        if per_cat.get(c, 0) >= 3 and not is_signature(it):
            continue
        per_cat[c] = per_cat.get(c, 0) + 1
        out.append(it)
        if len(out) >= limit:
            break
    return out, suited, unsuited


def explicitly_asked(it: Dict[str, Any], transcript: str) -> bool:
    """Guest named this dish or its kind ('recommend a sizzler', 'any fish?') → time rule doesn't apply."""
    t = _norm(transcript)
    if not t:
        return False
    name = _norm(it.get("name"))
    if name and name in t:
        return True
    words = set(re.findall(r"[a-z]{4,}", _norm(f"{it.get('category')} {it.get('name')}")))
    words -= {"with", "selection", "special", "choice", "sauce", "fried", "regular", "thai", "chinese"}
    stems = {w[:5] for w in words}
    return any(tok[:5] in stems for tok in re.findall(r"[a-z]{4,}", t))


def render_price_guide(index: MenuIndex) -> str:
    """Per-category price range with the cheapest dishes — so 'cheapest main?' and budget
    questions don't depend on the model scanning ~100 lines."""
    cats: Dict[str, List[Dict[str, Any]]] = {}
    for it in index.items:
        if isinstance(it.get("price"), (int, float)) and it.get("available") is not False:
            cats.setdefault(it.get("category") or "Other", []).append(it)
    out = []
    for cat, rows in cats.items():
        rows = sorted(rows, key=lambda r: r["price"])
        lo, hi = rows[0]["price"], rows[-1]["price"]
        cheapest = ", ".join(f"{r['name']} {_money(r['price'])}" for r in rows[:3])
        out.append(f"{cat}: {_money(lo)}–{_money(hi)} (cheapest: {cheapest})")
    return "\n".join(out)


# ------------------------------------------------------------------ restaurant & cart


def render_restaurant(profile: Optional[Dict[str, Any]]) -> str:
    """Restaurant facts the waiter may state. Missing facts are listed so it won't guess."""
    p = profile or {}
    lines: List[str] = []
    name = p.get("name")
    if name:
        lines.append(f"Name: {name}" + (f" ({p['type']})" if p.get("type") else ""))
    if p.get("branch"):
        lines.append(f"Branch: {p['branch']}")
    if p.get("address"):
        lines.append(f"Address: {p['address']}")
    if p.get("phone"):
        lines.append(f"Phone: {p['phone']}")
    ch = []
    if p.get("dineIn") is not False:
        ch.append("dine-in")
    if p.get("online"):
        ch.append("online ordering (takeaway/delivery via the online menu)")
    if ch:
        lines.append("Service: " + ", ".join(ch))
    if p.get("hours"):
        lines.append(f"Opening hours: {p['hours']}")
    else:
        lines.append("Opening hours: not published")
    for note in p.get("menuNotes") or []:
        lines.append(f"Menu note: {note}")
    for fact in p.get("knowledge") or []:
        lines.append(f"House info: {fact}")
    lines.append(
        "Staff paging: "
        + (
            "AVAILABLE — service requests you record are sent to the staff screen."
            if p.get("staffAlerts")
            else "NOT available — you cannot notify staff; ask the guest to wave to a staff member or ask at the counter."
        )
    )
    return "\n".join(lines)


def cart_lines(index: MenuIndex, cart: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float]:
    """Cart rows enriched from the menu: [{ref,itemId,name,quantity,price,notes,choices}], subtotal."""
    rows: List[Dict[str, Any]] = []
    total = 0.0
    for c in cart or []:
        iid = str(c.get("itemId") or c.get("id") or "")
        q = int(c.get("quantity") or c.get("qty") or 0)
        if q <= 0:
            continue
        it = index.by_id.get(iid) or index.resolve(iid, c.get("name"))
        name = (it or {}).get("name") or c.get("name") or iid
        price = c.get("price") if isinstance(c.get("price"), (int, float)) else (it or {}).get("price") or 0
        rows.append(
            {
                "ref": index.ref(it) if it else "",
                "itemId": index.item_id(it) if it else iid,
                "name": name,
                "quantity": q,
                "price": price,
                "notes": c.get("notes") or "",
                "variation": c.get("variation") or "",
                "modifiers": [m for m in c.get("modifiers") or [] if isinstance(m, dict)],
            }
        )
        total += float(price or 0) * q
    return rows, total


def render_cart(rows: List[Dict[str, Any]], subtotal: float) -> str:
    if not rows:
        return "(empty)"
    out = [
        (f"{r['line']}: " if r.get("line") else "")
        + f"{r['quantity']} × {r['name']} ({r['ref'] or r['itemId']}) @ {_money(r['price'])} = {_money(float(r['price'] or 0) * r['quantity'])}"
        + (f" — {r['variation']}" if r.get("variation") else "")
        + (f" — with {', '.join(str(m.get('name')) for m in r['modifiers'])}" if r.get("modifiers") else "")
        + (f" — note: {r['notes']}" if r.get("notes") else "")
        for r in rows
    ]
    out.append(f"Subtotal: {_money(subtotal)}")
    return "\n".join(out)


# ------------------------------------------------------------------ mentions


def find_mentions(text: str, index: MenuIndex, limit: int = 4) -> List[Dict[str, Any]]:
    """Menu items named in a (latin-script) utterance — longest/most specific names first."""
    t = _norm(text)
    if not t or not index.items:
        return []
    scored: List[Tuple[float, int, Dict[str, Any]]] = []
    for it in index.items:
        best = 0.0
        for label in [it.get("name"), *(it.get("aliases") or [])]:
            key = _norm(label)
            if len(key) < 3:
                continue
            if re.search(rf"(?<!\w){re.escape(key)}(?!\w)", t):
                best = max(best, 100.0)
            elif len(key) >= 6:
                best = max(best, float(fuzz.partial_ratio(key, t)))
        if best >= 90:
            scored.append((best, len(_norm(it.get("name"))), it))
    # a fuzzy hit that's just a near-twin of an exact hit ("Set Menu A-02" vs the "Set Menu A-01" actually
    # said) is noise — drop it
    exact = [_norm(it.get("name")) for s, _, it in scored if s >= 100]
    scored = [
        x for x in scored
        if x[0] >= 100 or not any(fuzz.ratio(_norm(x[2].get("name")), e) >= 85 for e in exact)
    ]
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out: List[Dict[str, Any]] = []
    names: List[str] = []
    for _, _, it in scored:
        n = _norm(it.get("name"))
        if any(n in m for m in names):  # "Spring Roll" hidden by an already-picked longer name containing it
            continue
        out.append(it)
        names.append(n)
        if len(out) >= limit:
            break
    return out


# ------------------------------------------------------------------ things the menu doesn't have

# kind of food/drink a guest may ask for → how to recognise it (in the guest's words and on the menu)
_KINDS = {
    "desserts": r"dessert|sweet dish|something sweet|ice ?cream|\bcake|pudding|brownie|kulfi|firni|payesh|halwa|rasmalai|"
                r"gulab|mishti|মিষ্টি|ডেজার্ট|পায়েস|ফিরনি|আইসক্রিম|কেক",
    "coffee": r"coffee|espresso|latte|cappuccino|কফি",
    # Bangla needs its own boundary: \b treats the vowel sign in "চা" as an edge, so "চারজন" (four people) looked like tea
    "tea": r"\btea\b|\bchai\b|\bcha\b|(?<![ঀ-৿])চা(?![ঀ-৿])",
    "juice": r"juice|smoothie|lassi|milkshake|\bshake\b|জুস|লাচ্ছি",
    # (how guests ask, how the menu lists it) — in Bangladesh "ঠান্ডা" (thanda) means a cold/soft drink
    "drinks": (
        r"\bdrinks?\b|beverages?|cold ?drinks?|soft ?drinks?|\bthanda\b|\btanda\b|ঠান্ডা|ঠাণ্ডা|কোল্ড ?ড্রিংক|সফট ?ড্রিংক|"
        r"ড্রিংক|পানীয়|কোমল পানীয়|\bcoke\b|pepsi|sprite|7 ?up|কোক|পেপসি|স্প্রাইট|সেভেন ?আপ",
        r"drink|beverage|soda|coke|pepsi|sprite|7 ?up|fanta|mojito|lemonade|juice|lassi|shake|borhani|\bcola\b",
    ),
    "pizza": r"pizza|পিজা|পিজ্জা",
    "burgers": r"burger|বার্গার",
    "biryani": r"biry?ani|kacchi|tehari|বিরিয়ানি|কাচ্চি|তেহারি",
    "breakfast items": r"breakfast|paratha|porota|omelet|omelette|toast|পরোটা|নাস্তা|ডিম ভাজি",
    "alcohol": r"\bbeer\b|\bwine\b|alcohol|whisk(e)?y|vodka|cocktail",
    "kebabs": r"kebab|kabab|tikka|কাবাব",
}


def _kind_patterns(pat: Any) -> Tuple[str, str]:
    """A kind is one pattern for both the guest's words and the menu, or (guest words, menu words)."""
    return (pat[0], pat[1]) if isinstance(pat, tuple) else (pat, pat)


def _item_text(it: Dict[str, Any]) -> str:
    return " ".join(str(x or "") for x in (it.get("name"), it.get("category"), " ".join(it.get("tags") or []))).lower()


def kind_items(text: str, index: MenuIndex) -> List[Tuple[str, List[Dict[str, Any]]]]:
    """Kinds the guest asked about that ARE on the menu, with their dishes ("desserts?" → Firni, Kulfi…)."""
    t = (text or "").lower()
    out = []
    for kind, pat in _KINDS.items():
        asked, listed = _kind_patterns(pat)
        if not re.search(asked, t):
            continue
        hits = [it for it in index.items if re.search(listed, _item_text(it))]
        if hits:
            out.append((kind, hits))
    return out


def missing_kinds(text: str, index: MenuIndex) -> List[str]:
    """Kinds of food the guest asked about that this menu doesn't have at all ("desserts?")."""
    t = (text or "").lower()
    out = []
    for kind, pat in _KINDS.items():
        asked, listed = _kind_patterns(pat)
        if not re.search(asked, t):
            continue
        on_menu = any(re.search(listed, _item_text(it)) for it in index.items)
        if not on_menu:
            out.append(kind)
    return out


# ------------------------------------------------------------------ language

_BN_SCRIPT = re.compile(r"[অ-হ়-ৌৎড়-য়]")
# Romanised Bangla (Banglish) — words that are rare in English sentences.
_BANGLISH_STRONG = {
    "ekta", "ekti", "duita", "duto", "duta", "tinta", "charta", "den", "dao", "daw", "diben", "deben", "dan",
    "lagbe", "chai", "cai", "ache", "ase", "achhe", "koto", "kemon", "khabo", "khete", "jhal", "kichu",
    "hobe", "korun", "koren", "korben", "bhai", "vai", "apu", "amake", "amader", "apnader", "valo", "bhalo",
    "dorkar", "niye", "nibo", "debo", "shob", "sob", "kon", "konta", "ektu", "arekta", "aro",
}
_BANGLISH_WEAK = {"ar", "na", "ki", "ta", "to", "e", "o", "r", "din", "dam", "taka", "plz"}


# words that only appear in real English sentences, never in a list of dish names
_EN_SENTENCE = {
    "i", "im", "i'd", "id", "you", "your", "we", "us", "our", "my", "me", "want", "would", "like", "please", "can",
    "could", "what", "which", "how", "is", "are", "was", "do", "does", "did", "have", "has", "give", "get", "will",
    "need", "much", "any", "there", "it", "this", "that", "should", "recommend", "bring", "may", "let", "let's",
}


def reply_language(text: str, locale: Optional[str] = None) -> str:
    """Mirror the guest: Bangla script or Banglish → 'bn', otherwise 'en'.
    The client's locale (an STT hint, usually 'bn') only breaks ties for script-less turns."""
    t = (text or "").strip()
    if _BN_SCRIPT.search(t):
        return "bn"
    words = re.findall(r"[a-z]+", t.lower())
    if words:
        strong = sum(w in _BANGLISH_STRONG for w in words)
        weak = sum(w in _BANGLISH_WEAK for w in words)
        if strong >= 1 and (strong + weak) >= 2 or strong >= 2:
            return "bn"
        # A Bangla speaker ordering by dish names ("Crispy rice soup, lemon doita, choice of two curry…"):
        # the transcriber writes English dish names in English letters, but it isn't English speech.
        if (locale or "").strip().lower() == "bn" and len(words) >= 3 and not any(w in _EN_SENTENCE for w in words):
            from bn_translit import WORDS as _FOOD  # local: keeps import order simple

            if sum(w in _FOOD for w in words) / len(words) >= 0.5:
                return "bn"
        if len(words) >= 2 or len(words[0]) >= 3:
            return "en"
    loc = (locale or "").strip().lower()
    return loc if loc in ("bn", "en") else "en"


# ------------------------------------------------------------------ yes / no / confirm

_PUNCT = re.compile(r"[^\w\sঀ-৿']+")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", _PUNCT.sub(" ", (text or "").lower())).strip()


_YES = {
    "yes", "yeah", "yep", "yup", "ya", "yah", "sure", "ok", "okay", "okey", "okk", "k", "alright", "right",
    "correct", "absolutely", "definitely", "please", "go ahead", "do it", "sounds good", "perfect",
    "জি", "জী", "জ্বি", "জ্বী", "হ্যাঁ", "হ্যা", "হা", "হুম", "আচ্ছা", "ঠিক আছে", "অবশ্যই", "হ্যাঁ দিন",
    "ji", "jee", "hae", "ha", "haa", "hmm", "acha", "accha", "thik ache", "thik ase",
    # "give it" = yes to "এটা দেব?" / "অর্ডারটা দিয়ে দেব?"
    "দিন", "দেন", "দ্যান", "দাও", "দিয়ে দিন", "দিয়ে দেন", "দিয়ে দাও", "ওকে", "ওকে দেন", "হ্যাঁ দেন", "জি দেন",
    "din", "den", "dao", "diye din", "diye den", "ok den", "ha den",
}
_CONFIRM_WORDS = re.compile(
    r"\b(confirm\w*|konfirm|konfarm|confam|konfam|place (the |my )?order|go ahead|proceed|finali[sz]e|submit)\b"
    r"|কনফার্ম|কনফাম|কন্ফাম|কন্ফার্ম|অর্ডার দিয়ে দিন|অর্ডার করে দিন|অর্ডার প্লেস"
)
# Bangla vowel signs aren't \w, so Bangla words are delimited by whitespace instead of \b
# (otherwise "না" would match inside "নাগেটস").
_NEGATION = re.compile(
    r"\b(no|not|don'?t|do not|dont|never|wait|hold on|later|cancel|stop)\b"
    r"|(?:^|\s)(না|নাহ|নয়|পরে|দাঁড়ান|ওয়েট|ক্যানসেল|বাতিল)(?=\s|$)"
)
_FILLER = {"please", "plz", "pls", "the", "my", "order", "it", "now", "that", "thanks", "thank", "you", "all", "good",
           "দিন", "করুন", "করেন", "করে", "দেন", "প্লিজ", "অর্ডার", "অর্ডারটা", "টা", "টি", "এটা", "ভাই", "আপু", "sir", "bhai", "vai"}


def is_affirmative(text: str) -> bool:
    """Whole-utterance 'yes' (optionally + confirm/filler words) — never a question or a new request."""
    raw = (text or "").strip()
    if not raw or "?" in raw or len(raw) > 60:
        return False
    t = _clean(raw)
    if not t or _NEGATION.search(t):
        return False
    if t in _YES:
        return True
    words = t.split()
    i = 0
    while i < len(words):  # consume leading yes-phrases (up to 3 words)
        for n in (3, 2, 1):
            if " ".join(words[i : i + n]) in _YES:
                i += n
                break
        else:
            break
    if i == 0:
        return False
    rest = [w for w in words[i:] if w not in _FILLER]
    return not rest or bool(_CONFIRM_WORDS.search(" ".join(rest))) and len(rest) <= 3


def is_explicit_confirm(text: str) -> bool:
    """'confirm the order', 'place my order', 'অর্ডার কনফার্ম করুন' — imperative, not a question/negation."""
    raw = (text or "").strip()
    if not raw or "?" in raw or len(raw) > 200:  # "OK, 1 veg curry and 3 full kacchi — confirm the order" is long
        return False
    t = _clean(raw)
    m = _CONFIRM_WORDS.search(t)
    if not m:
        return False
    # negation only counts when it's about confirming ("don't confirm", "কনফার্ম করব না") —
    # not "No, that's all. Please confirm my order."
    before, after = t[max(0, m.start() - 16): m.start()], t[m.end(): m.end() + 14]
    if re.search(r"\b(don'?t|do not|dont|not|never|no need to|wait|later)\b", before) or re.search(r"(^|\s)(না|নয়)(\s|$)", after):
        return False
    if re.search(r"\b(not yet|later|hold on|wait)\b", after):
        return False
    if re.search(r"\b(can you|could you|would you|what|which|how|is|does|do you|are)\b", t) and not re.search(
        r"\b(please|plz)\b", t
    ):
        return False
    return True


def is_done_ordering(text: str) -> bool:
    """'no that's all', 'nothing else', 'আর কিছু লাগবে না' → guest declines more items."""
    t = _clean(text)
    if not t or len(t) > 60:
        return False
    return bool(
        re.search(
            r"^(no|nope|nah|no thanks?|no thank you)( that'?s (all|it)| nothing else| i'?m good| thanks?)?$"
            r"|that'?s (all|it)|nothing (else|more)|i'?m (good|done)|all good|আর কিছু (লাগবে|চাই) না|আর না|এতটুকুই|এটুকুই|এই (যথেষ্ট|হবে)|^না$|^না লাগবে না$|^লাগবে না$|^না থাক$",
            t,
        )
    )


def last_assistant_asked_to_confirm(history: Optional[List[Dict[str, str]]]) -> bool:
    for m in reversed(history or []):
        if m.get("role") != "assistant":
            continue
        t = (m.get("content") or "").lower()
        return bool(
            re.search(r"\b(confirm|place|finali[sz]e|go ahead)\b[^?]*\?", t)
            or re.search(r"কনফার্ম কর(ব|বো|ে দেব|ে দিই)|অর্ডার(টা|টি)? (কি )?(দিয়ে|প্লেস করে) দে(ব|বো)|প্লেস কর(ব|বো)", t)
        )
    return False
