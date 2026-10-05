"""
The virtual waiter's recommendation engine — deterministic, testable, explainable.

  GuestProfile      what we've learned about this table this visit (diet, allergies, dislikes,
                    spice, budget, party size, kids, mood, dishes they turned down)
  extract_prefs()   fast rule-based reading of the guest's words (the LLM adds its own reading)
  rank()            hard filters (allergy, diet, dislikes, declined, availability, time) → scored,
                    explained, diversified picks (signature, time fit, taste fit, popularity,
                    ordered-together, novelty)
  build_plan()      a whole-table meal within budget with checked arithmetic
  complements()     what completes the current order (rice for curries, a drink, a starter)
  decide_mode()     WHEN to recommend: full / complement / last-call / greet / answer / quiet

The LLM phrases things; this module decides what may be suggested.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

from wait_time import asks_quickest, asks_time, clamp_prep
from waiter_knowledge import MenuIndex, is_signature, item_hints, time_fit

# ------------------------------------------------------------------ guest profile

ALLERGENS = ("nuts", "shellfish", "fish", "egg", "dairy", "gluten", "mushroom", "sesame", "soy")
DIETS = ("vegetarian", "vegan", "no_beef", "no_pork", "pescatarian", "halal")
MOODS = ("light", "filling", "sharing", "quick")
SPICE = ("", "none", "mild", "medium", "hot")


@dataclass
class GuestProfile:
    diet: List[str] = field(default_factory=list)
    allergies: List[str] = field(default_factory=list)
    avoid: List[str] = field(default_factory=list)  # ingredient words: beef, mushroom…
    spice: str = ""
    budget: int = 0  # whole table, taka; 0 = unknown
    party_size: int = 0
    vegetarians_in_party: int = 0
    kids: bool = False
    mood: List[str] = field(default_factory=list)  # this request only
    max_price: int = 0  # this request only: "something cheaper" than what we just suggested
    declined: List[str] = field(default_factory=list)  # item ids the guest turned down
    liked: List[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> "GuestProfile":
        d = d or {}
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        return cls(**known)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def merge(self, other: "GuestProfile", *, replace_mood: bool = True) -> "GuestProfile":
        """Lasting facts accumulate; the latest non-empty value wins for spice/budget/party; mood is per request."""
        out = GuestProfile.from_dict(self.to_dict())
        for f in ("diet", "allergies", "avoid", "declined", "liked"):
            cur = getattr(out, f)
            for v in getattr(other, f):
                if v and v not in cur:
                    cur.append(v)
        if other.spice:
            out.spice = other.spice
        if other.budget:
            out.budget = other.budget
        if other.party_size:
            out.party_size = other.party_size
        if other.vegetarians_in_party:
            out.vegetarians_in_party = other.vegetarians_in_party
        out.kids = out.kids or other.kids
        if replace_mood:
            out.mood = list(other.mood)
            out.max_price = other.max_price
        # a liked dish is no longer "declined"
        out.declined = [x for x in out.declined if x not in out.liked]
        return out

    def summary(self) -> str:
        bits = []
        if self.diet:
            bits.append("diet: " + ", ".join(self.diet))
        if self.vegetarians_in_party:
            bits.append(f"{self.vegetarians_in_party} vegetarian in the party")
        if self.allergies:
            bits.append("ALLERGIES: " + ", ".join(self.allergies))
        if self.avoid:
            bits.append("avoids: " + ", ".join(self.avoid))
        if self.spice:
            bits.append(f"spice: {self.spice}")
        if self.party_size:
            bits.append(f"party of {self.party_size}")
        if self.kids:
            bits.append("with kids")
        if self.budget:
            bits.append(f"budget ৳{self.budget}")
        if self.mood:
            bits.append("wants: " + ", ".join(self.mood))
        if self.max_price:
            bits.append(f"wants cheaper: under ৳{self.max_price + 1}")
        return "; ".join(bits) or "nothing specific yet"


# ------------------------------------------------------------------ reading the guest's words

_NUM_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "ek": 1, "dui": 2, "tin": 3, "char": 4, "pach": 5, "pach": 5, "choy": 6,
    "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "সাত": 7, "আট": 8,
}
_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

_ALLERGEN_WORDS = [
    (r"\bnuts?\b|peanut|cashew|almond|walnut|বাদাম|kaju|কাজু", "nuts"),
    (r"shrimp|prawn|shellfish|crab|lobster|squid|চিংড়ি|chingri", "shellfish"),
    (r"\bfish\b|মাছ|\bmach\b|\bmaach\b", "fish"),
    (r"\beggs?\b|ডিম|\bdim\b", "egg"),
    (r"dairy|milk|lactose|cheese|দুধ|ডেইরি|ডেয়ারি|ল্যাক্টোজ", "dairy"),
    (r"gluten|wheat|celiac|coeliac|গম", "gluten"),
    (r"mushroom", "mushroom"),
    (r"sesame|তিল", "sesame"),
    (r"\bsoy", "soy"),
]
_AVOID_WORDS = [
    (r"beef|গরু|goru", "beef"),
    (r"\bpork\b|শুকর", "pork"),
    (r"mutton|lamb|খাসি|khashi", "mutton"),
    (r"chicken|মুরগি|murgi", "chicken"),
    (r"seafood|prawn|shrimp|চিংড়ি", "prawn/shrimp"),
    (r"\bfish\b|মাছ", "fish"),
    (r"mushroom", "mushroom"),
]
_ALLERGY_CUE = re.compile(r"allerg|এলার্জি|এলার্জী|অ্যালার্জি|intoleran|can'?t (have|eat|take)|cannot (have|eat)", re.I)
_AVOID_CUE = re.compile(
    r"(don'?t|do not|never|can'?t|cannot|won'?t|doesn'?t|does not) (eat|like|want|take)|\bno\b|without|except|"
    r"not (a fan of|into)|hate|খাই না|খায় না|চলবে না|লাগবে না|ছাড়া|khai na|khay na|chara|chai na",
    re.I,
)


def _num(tok: str) -> Optional[int]:
    tok = tok.translate(_BN_DIGITS).lower()
    if tok.isdigit():
        return int(tok)
    return _NUM_WORDS.get(tok)


def extract_prefs(text: str) -> GuestProfile:
    """Rule-based reading of one utterance (English, Bangla, Banglish). Conservative: questions
    like "is it spicy?" set nothing; "nothing spicy please" sets spice=mild."""
    p = GuestProfile()
    raw = (text or "").strip()
    t = raw.lower().translate(_BN_DIGITS)
    if not t:
        return p

    # allergies: only with an allergy cue ("allergic to nuts", "চিংড়িতে এলার্জি", "can't have gluten")
    if _ALLERGY_CUE.search(t):
        for pat, name in _ALLERGEN_WORDS:
            if re.search(pat, t):
                p.allergies.append(name)

    # dislikes / restrictions ("I don't eat beef", "no mushrooms", "গরু খাই না", "beef chara")
    if _AVOID_CUE.search(t) and not p.allergies:
        for pat, name in _AVOID_WORDS:
            m = re.search(pat, t)
            if not m:
                continue
            window = t[max(0, m.start() - 30): m.end() + 25]
            if _AVOID_CUE.search(window):
                if name == "beef":
                    p.diet.append("no_beef")
                elif name == "pork":
                    p.diet.append("no_pork")
                p.avoid.append(name)

    # diets — the whole table vs. one member
    member_veg = re.search(
        r"(\b(one|1|two|2|some|my \w+|he|she|friend|wife|husband|son|daughter)\b[^.?!]{0,20}\b(is|are)\b[^.?!]{0,6}\b(vegetarian|vegan|veg)\b)"
        r"|(একজন|এক জন)[^।?]{0,15}(নিরামিষ|ভেজ)",
        t,
    )
    if member_veg:
        n = _num((member_veg.group(2) or "one").split()[0]) if member_veg.group(2) else 1
        p.vegetarians_in_party = n or 1
    elif re.search(r"\bvegan\b", t):
        p.diet.append("vegan")
    elif re.search(r"\b(vegetarian|veggie|veg only|only veg|pure veg)\b|নিরামিষ|niramish|niramis", t):
        p.diet.append("vegetarian")
    if re.search(r"pescatarian|only (eat )?(fish|seafood)", t):
        p.diet.append("pescatarian")
    if re.search(r"\bhalal\b|হালাল", t) and not t.endswith("?"):
        p.diet.append("halal")

    # spice — preferences, not questions
    if re.search(
        r"not spicy|nothing spicy|no spic|non[- ]spicy|not too spicy|less spicy|mild|can'?t (handle|take|eat) (spice|spicy|heat)|"
        r"ঝাল ছাড়া|ঝাল কম|কম ঝাল|ঝাল খাই না|ঝাল ছাড়|jhal (chara|kom|khai na|chara)|kom jhal",
        t,
    ):
        p.spice = "mild"
    elif re.search(
        r"(love|like|want|prefer|craving|give me|something|extra|very|really) (\w+ )?(spicy|hot|fiery)|spicy (food|dish|one|please)|"
        r"ঝাল (চাই|ভালোবাসি|পছন্দ)|বেশি ঝাল|jhal (chai|pochondo|beshi)|beshi jhal",
        t,
    ):
        p.spice = "hot"

    # party size
    m = re.search(
        r"(we are|we're|there are|there'?re|table for|group of|party of|family of|us)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b"
        r"|\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(people|persons|person|of us|guests|adults|jon|জন)"
        r"|আমরা\s*(\d+|এক|দুই|তিন|চার|পাঁচ|ছয়)\s*জন|amra\s+(\d+|dui|tin|char|pach)\s+jon",
        t,
    )
    if m:
        tok = next(g for g in (m.group(2), m.group(3), m.group(5), m.group(6)) if g)
        n = _num(tok)
        if n and 1 <= n <= 30:
            p.party_size = n

    # budget: "800 taka", "৳800", "budget 1200", "under 500"
    m = re.search(
        r"(?:৳|tk\.?|taka|bdt)\s*(\d[\d,]{1,6})|(\d[\d,]{1,6})\s*(?:৳|taka|tk|bdt|টাকা)|budget\D{0,12}(\d[\d,]{1,6})|(?:under|below|within|less than)\s+(\d[\d,]{1,6})",
        t,
    )
    if m:
        v = next(g for g in m.groups() if g)
        try:
            n = int(v.replace(",", ""))
            if 50 <= n <= 1_000_000:
                p.budget = n
        except ValueError:
            pass

    if re.search(r"\b(kids?|child|children|son|daughter|baby|toddler)\b|বাচ্চা|bacha|baccha", t):
        p.kids = True

    for pat, mood in (
        (r"\blight\b|not (too )?heavy|হালকা|halka", "light"),
        (r"filling|hungry|starving|heavy|big meal|full meal|ক্ষুধা|খিদে|khida|pet bhore|পেট ভরে", "filling"),
        (r"\bshar(e|ing)\b|for the table|ভাগ করে", "sharing"),
        (r"\bquick\b|\bfast\b|hurry|in a rush|no time|তাড়া|tara", "quick"),
    ):
        if re.search(pat, t):
            p.mood.append(mood)
    return p


# ------------------------------------------------------------------ dish facts & hard filters

_BATTER = re.compile(r"pakora|finger|onion ring|spring roll|won ?thon|wonton|fried (chicken|prawn|squid|mushroom)|crispy|tempura")
_EGGY = re.compile(r"fried rice|set menu|egg")
_THAI = re.compile(r"\bthai\b")
_PROTEINS = ("chicken", "beef", "prawn/shrimp", "fish", "squid", "mutton")


def _required_choice_contents(it: Dict[str, Any]) -> Tuple[set, bool]:
    """For dishes with a required choice (e.g. 'pick 2 curries'): what EVERY option contains, and
    whether any option is meat/seafood-free — the dish is only as vegetarian as its choices."""
    common: Optional[set] = None
    any_veg = True
    for g in it.get("modifierGroups") or []:
        if int(g.get("min") or 0) < 1:
            continue
        opts = [o for o in g.get("options") or [] if o.get("name")]
        if not opts:
            continue
        group_contains = [set(item_hints({"name": o["name"]})["contains"]) for o in opts]
        group_all = set.intersection(*group_contains) if group_contains else set()
        common = group_all if common is None else common | group_all
        meaty = {"chicken", "beef", "mutton", "duck", "pork", "prawn/shrimp", "squid", "crab/lobster", "fish"}
        if not any(not (c & meaty) for c in group_contains):
            any_veg = False
    return (common or set()), any_veg


# Ready-made, bought-in things: the kitchen doesn't make them, so a waiter never praises or "recommends" them —
# they're only ever offered plainly ("সাথে কি একটা Coke নেবেন?"). Fresh juice, lassi, borhani, shakes, coffee are made here.
_PACKAGED = re.compile(
    r"\b(mineral )?water\b|\bcoke\b|coca[- ]?cola|\bpepsi\b|7 ?up|seven ?up|\bsprite\b|\bfanta\b|mountain dew|\bmirinda\b|"
    r"\bsoda\b|club soda|tonic|red ?bull|energy drink|\bspeed\b|\bmojo\b|\bclemon\b|\brc cola\b|frutika|shezan|"
    r"soft ?drinks?|canned|\bcan\b|bottled|\bbottle\b|diet coke|coke zero|pepsi max|\bdew\b",
    re.I,
)
_MADE_HERE = re.compile(r"fresh|lassi|borhani|shake|smoothie|mojito|lemonade|mocktail|coffee|latte|cappuccino|tea\b|"
                        r"falooda|juice", re.I)


def is_packaged(it: Dict[str, Any]) -> bool:
    """Mineral water, Coke, 7Up, Sprite, a canned soda… (a "Fresh Lime Soda" or "Mango Lassi" is made here)."""
    name = str(it.get("name") or "")
    text = f"{name} {it.get('category') or ''}"
    return bool(_PACKAGED.search(text)) and not _MADE_HERE.search(name)


def dish_facts(it: Dict[str, Any]) -> Dict[str, Any]:
    h = item_hints(it)
    text = " ".join(str(x or "") for x in (it.get("name"), it.get("category"), it.get("description"))).lower()
    contains = set(h["contains"])
    choice_all, choice_has_veg = _required_choice_contents(it)
    contains |= choice_all
    if not choice_has_veg:
        contains.add("meat/seafood choices")
        if h["diet"] == "likely vegetarian":
            h = {**h, "diet": ""}
    protein = next((p for p in _PROTEINS if p in contains), "")
    if not protein and h["diet"] in ("vegetarian", "vegan", "likely vegetarian"):
        protein = "veg"
    if "usually mixed chicken/prawn/beef" in contains or "mixed dishes" in contains:
        protein = protein or "mixed"
    # what KIND of dish it is comes from its own name + category; the description is an ingredient
    # list ("Set Menu A-02: Thai Soup, …") and would make a set menu look like a soup
    kind = " ".join(str(x or "") for x in (it.get("name"), it.get("category"))).lower()
    return {
        "contains": contains,
        "heat": h["heat"],
        "diet": h["diet"],
        "text": text,
        "protein": protein,
        "drink": bool(re.search(r"beverage|drink|\bwater\b|juice|\blassi|shake|\bsoda|\btea\b|coffee", kind)),
        "rice": bool(re.search(r"rice|noodle|chow ?mein|chop ?suey|biry?ani|polao|pulao|khichuri|naan|roti|kulcha|chapati", kind)) and "soup" not in kind,
        "starter": bool(re.search(r"appeti|starter|snack|soup|salad", kind)),
        "soup": "soup" in kind,
        "complete_meal": bool(re.search(r"set menu|choice of \d|with fried rice|sizzl|biry?ani|kacchi|tehari|platter|thali|combo", kind)),
        "heavy": bool(re.search(r"sizzl|whole .*(fish|snapper)|\bsnapper\b|platter|set menu|choice of \d|kacchi", kind)),
        "main": bool(re.search(r"selection|sizzl|set menu|choice of|curry|fish|biry?ani|kacchi|tehari|main|kebab|grill", kind))
        and not re.search(r"soup|salad|appeti", kind),
        "kid_friendly": bool(re.search(r"fry|fries|finger|nugget|corn soup|egg fried rice|sweet ?& ?sour|fried chicken|wings", kind)),
    }


def violations(it: Dict[str, Any], prof: GuestProfile, facts: Optional[Dict[str, Any]] = None) -> List[str]:
    """Why this dish must NOT be suggested to this guest (empty = fine). Allergy checks are
    deliberately conservative: 'likely contains' counts."""
    f = facts or dish_facts(it)
    c, text = f["contains"], f["text"]
    out: List[str] = []
    iid = str(it.get("id") or it.get("_id"))
    if iid in prof.declined:
        out.append("guest declined it")
    for a in prof.allergies:
        hit = (
            (a == "nuts" and "nuts" in c)
            or (a == "shellfish" and (c & {"prawn/shrimp", "crab/lobster", "squid", "oyster sauce", "usually mixed chicken/prawn/beef", "usually meat/prawn filling"}))
            or (a == "fish" and (c & {"fish", "fish sauce"} or _THAI.search(text)))
            or (a == "egg" and ("egg" in c or _EGGY.search(text)))
            or (a == "dairy" and "dairy" in c)
            or (a == "gluten" and ("wheat" in c or _BATTER.search(text)))
            or (a == "mushroom" and "mushroom" in c)
            or (a in ("sesame", "soy") and a in text)
        )
        if hit:
            out.append(f"allergy: {a}")
    meaty = c & {"chicken", "beef", "mutton", "duck", "pork", "prawn/shrimp", "squid", "crab/lobster", "fish", "oyster sauce",
                 "fish sauce", "usually mixed chicken/prawn/beef", "usually meat/prawn filling", "mixed dishes", "meat/seafood choices"}
    if ("vegetarian" in prof.diet or "vegan" in prof.diet) and (meaty or f["diet"] not in ("vegetarian", "vegan", "likely vegetarian")):
        out.append("not vegetarian")
    if "vegan" in prof.diet and (c & {"egg", "dairy"} or _EGGY.search(text)):
        out.append("not vegan")
    if "pescatarian" in prof.diet and c & {"chicken", "beef", "mutton", "duck", "pork", "usually mixed chicken/prawn/beef"}:
        out.append("has meat")
    if "no_beef" in prof.diet and ("beef" in c or "usually mixed chicken/prawn/beef" in c):
        out.append("has beef")
    if "no_pork" in prof.diet and "pork" in c:
        out.append("has pork")
    for word in prof.avoid:
        if word in c or re.search(rf"\b{re.escape(word.split('/')[0])}", text):
            out.append(f"guest avoids {word}")
    if prof.spice in ("none", "mild") and f["heat"] in ("spicy", "likely spicy"):
        out.append("too spicy")
    # kids at the table imply mild food unless the guest said they like it hot
    if prof.kids and prof.spice != "hot" and f["heat"] in ("spicy", "likely spicy"):
        out.append("spicy for kids")
    price = it.get("price")
    if prof.budget and isinstance(price, (int, float)) and price > prof.budget:
        out.append("over budget")
    if prof.max_price and isinstance(price, (int, float)) and price > prof.max_price:
        out.append("not cheaper than before")
    return out


def allergy_guide(index: MenuIndex, allergen: str, orderable: Dict[str, bool], max_names: int = 6) -> Dict[str, Any]:
    """A SHORT, spoken-friendly summary of what to avoid: whole categories when most of a section
    is affected ("all Prawn Selection dishes"), the 'Special' dishes as one group, then a few names.
    Reading 26 dish names out loud helps nobody."""
    prof = GuestProfile(allergies=[allergen])
    hit = [it for it in index.items if any(v.startswith("allergy") for v in violations(it, prof))]
    if not hit:
        return {"allergen": allergen, "groups": [], "count": 0}
    by_cat: Dict[str, List[Dict[str, Any]]] = {}
    for it in index.items:
        by_cat.setdefault(str(it.get("category") or "Other"), []).append(it)
    groups, covered = [], set()
    for cat, items in by_cat.items():
        bad = [i for i in items if i in hit]
        # only a WHOLE section is grouped — "most rice dishes" leaves the guest guessing which are fine
        if len(bad) >= 3 and len(bad) == len(items):
            groups.append(f"all {cat} dishes")
            covered |= {index.item_id(i) for i in bad}
    special = [i for i in hit if index.item_id(i) not in covered and re.search(r"\bspecial\b", str(i.get("name", "")).lower())]
    if len(special) >= 3:
        groups.append("the 'Special' dishes")
        covered |= {index.item_id(i) for i in special}
    rest = [i for i in hit if index.item_id(i) not in covered]
    names = [str(i.get("name")) for i in rest[:max_names]]
    if len(rest) > max_names:
        names.append(f"{len(rest) - max_names} more")
    return {"allergen": allergen, "groups": groups + names, "count": len(hit)}


# ------------------------------------------------------------------ order history signals


@dataclass
class OrderStats:
    """From real orders (per tenant). Empty until orders exist — then it switches on by itself."""
    popularity: Dict[str, float] = field(default_factory=dict)  # itemId → orders containing it
    pairs: Dict[str, Dict[str, float]] = field(default_factory=dict)  # itemId → {otherId: co-orders}

    @classmethod
    def from_orders(cls, orders: Iterable[Dict[str, Any]]) -> "OrderStats":
        pop: Dict[str, float] = {}
        pairs: Dict[str, Dict[str, float]] = {}
        for o in orders:
            ids = sorted({str(l.get("itemId")) for l in o.get("items") or [] if l.get("itemId")})
            for a in ids:
                pop[a] = pop.get(a, 0) + 1
                for b in ids:
                    if a != b:
                        pairs.setdefault(a, {})[b] = pairs.setdefault(a, {}).get(b, 0) + 1
        return cls(pop, pairs)

    def pop_score(self, iid: str) -> float:
        if not self.popularity:
            return 0.0
        top = max(self.popularity.values())
        return 2.0 * math.log1p(self.popularity.get(iid, 0)) / math.log1p(top) if top else 0.0

    def pair_score(self, iid: str, with_ids: Iterable[str]) -> float:
        """Lift-style: how often iid is ordered alongside the given items, normalised to 0..3."""
        best = 0.0
        for w in with_ids:
            row = self.pairs.get(w) or {}
            if row and iid in row:
                best = max(best, 3.0 * row[iid] / max(row.values()))
        return best


# ------------------------------------------------------------------ ranking


@dataclass
class Pick:
    item: Dict[str, Any]
    score: float
    reasons: List[str]


_KIND_LABEL = {"breakfast": "breakfast", "lunch": "lunch", "afternoon": "an afternoon bite", "dinner": "dinner", "late": "late night"}


def _score(it: Dict[str, Any], f: Dict[str, Any], prof: GuestProfile, kinds: List[str], stats: OrderStats,
           context_ids: List[str], recent: List[str]) -> Tuple[float, List[str]]:
    fits, s = time_fit(it, kinds)
    reasons: List[str] = []
    iid = str(it.get("id") or it.get("_id"))
    if is_signature(it):
        reasons.append("our signature")
    time_only = s - (4.0 if is_signature(it) else 0.0)  # time_fit's score includes the signature bonus
    if fits and kinds and time_only >= 2.5:
        reasons.append(f"great for {_KIND_LABEL.get(kinds[0], kinds[0])}")
    # taste & situation fit
    if prof.spice == "hot":
        if f["heat"] in ("spicy", "likely spicy"):
            s += 4.5; reasons.append("properly spicy" if f["heat"] == "spicy" else "has a good kick")
        elif not f["drink"]:
            s -= 3.0  # a spice lover asked — don't lead with mild dishes
    if prof.spice in ("mild", "none") and f["heat"] == "likely mild":
        s += 1.5; reasons.append("mild")
    if "light" in prof.mood:
        s += 2.5 if (f["starter"] or f["soup"]) and not f["heavy"] else (-2.5 if f["heavy"] else 0)
        if f["soup"] or f["starter"]:
            reasons.append("light")
    if "filling" in prof.mood:
        s += 2.5 if (f["heavy"] or f["complete_meal"] or f["main"]) else -1.5
        if f["complete_meal"] or f["heavy"]:
            reasons.append("filling")
    if "sharing" in prof.mood or prof.party_size >= 3:
        if f["heavy"] or f["starter"]:
            s += 1.5
            reasons.append("good to share")
    if "light" in prof.mood and f["main"] and not (f["soup"] or f["starter"]):
        s -= 1.5  # a curry isn't "something light"
    if "quick" in prof.mood:
        prep = clamp_prep(it.get("prepMinutes"))
        if prep is not None:  # the restaurant's own kitchen time beats guessing from the dish type
            s += 3.0 if prep <= 8 else 2.0 if prep <= 12 else 0.5 if prep <= 18 else -2.5
            if prep <= 12:
                reasons.append(f"ready in about {prep} min")
        else:
            s += 1.5 if (f["starter"] or f["soup"] or f["rice"]) else (-2 if "whole" in f["text"] else 0)
    # a whole fish is a sharing dish: don't pitch it to one person who didn't ask to share
    if re.search(r"whole .*(fish|snapper)", f["text"]) and prof.party_size < 3 and "sharing" not in prof.mood:
        s -= 3.0
    if prof.kids:
        if f["kid_friendly"]:
            s += 4.0; reasons.append("kid-friendly")
        elif f["heavy"] and prof.party_size < 3:
            s -= 1.5
    if prof.vegetarians_in_party and f["protein"] == "veg":
        s += 1.0
    if f["drink"]:
        s -= 1.5  # drinks are pairings, not answers to "what should I eat?"
    if f["rice"] and not f["complete_meal"] and not f["main"]:
        s -= 2.5  # plain rice / naan are sides — offered as a pairing, not as a recommendation
    elif f["rice"] and not f["complete_meal"] and re.search(r"\b(plain|steamed|polao|pulao|naan|roti)\b", f["text"]):
        s -= 2.5
    # budget fit
    price = it.get("price")
    if prof.budget and isinstance(price, (int, float)):
        per_head = prof.budget / max(1, prof.party_size or 1)
        if price <= per_head:
            s += 1.0; reasons.append("fits your budget")
        elif price > per_head * 1.4 and not f["heavy"]:
            s -= 2.0
    # learned from real orders
    pop = stats.pop_score(iid)
    if pop >= 1.2:
        reasons.append("a guest favourite")
    s += pop
    pair = stats.pair_score(iid, context_ids)
    if pair >= 1.0:
        reasons.append("often ordered together")
    s += pair
    # novelty: don't repeat the same pitch
    if iid in recent:
        s -= 3.0
    if iid in prof.liked:
        s += 1.0
    return s, reasons[:3]


def rank(
    index: MenuIndex,
    orderable: Dict[str, bool],
    kinds: List[str],
    prof: GuestProfile,
    *,
    stats: Optional[OrderStats] = None,
    context_ids: Optional[List[str]] = None,
    recent: Optional[List[str]] = None,
    asked_for: Optional[set] = None,
    limit: int = 8,
    only: Optional[set] = None,
    exclude: Optional[set] = None,
) -> Tuple[List[Pick], Dict[str, List[str]]]:
    """Filtered, scored, diversified picks + {itemId: reasons excluded} for every blocked dish.
    `only`: the guest named a kind ("soups") — pick from those dishes alone.
    `exclude`: already in the guest's tray — they chose it, so it's never "recommended" back to them (unless
    nothing else is left to suggest: then the tray's dishes may still be named)."""
    if exclude:
        picks, blocked = rank(index, orderable, kinds, prof, stats=stats, context_ids=context_ids, recent=recent,
                              asked_for=asked_for, limit=limit + len(exclude), only=only)
        rest = [p for p in picks if index.item_id(p.item) not in exclude][:limit]
        if rest:
            for iid in exclude:
                blocked.setdefault(iid, []).append("already in the guest's tray")
            return rest, blocked
        return picks[:limit], blocked
    stats = stats or OrderStats()
    context_ids, recent, asked_for = context_ids or [], recent or [], asked_for or set()
    blocked: Dict[str, List[str]] = {}
    scored: List[Tuple[Pick, Dict[str, Any]]] = []
    for it in index.items:
        iid = index.item_id(it)
        if only is not None and iid not in only:
            continue
        if not orderable.get(iid, True):
            blocked[iid] = ["not orderable now"]
            continue
        if is_packaged(it) and iid not in asked_for and only is None:
            continue  # water / Coke is never a "recommendation" (still offered plainly as a drink with the order)
        f = dish_facts(it)
        v = violations(it, prof, f)
        fits, _ = time_fit(it, kinds)
        if not fits and iid not in asked_for:
            v.append("doesn't suit this time")
        if v:
            blocked[iid] = v
            continue
        s, why = _score(it, f, prof, kinds, stats, context_ids, recent)
        if iid in asked_for:
            s += 6.0
        scored.append((Pick(it, s, why), f))

    # Maximal-marginal-relevance style diversification: vary category and protein
    picks: List[Pick] = []
    pool = sorted(scored, key=lambda x: (-x[0].score, str(x[0].item.get("name"))))
    used_cat: Dict[str, int] = {}
    used_protein: Dict[str, int] = {}
    while pool and len(picks) < limit:
        best_i, best_val = 0, -1e9
        for i, (p, f) in enumerate(pool):
            val = p.score - 2.0 * used_cat.get(str(p.item.get("category")), 0) - 1.2 * used_protein.get(f["protein"] or "-", 0)
            if val > best_val:
                best_i, best_val = i, val
        p, f = pool.pop(best_i)
        picks.append(p)
        used_cat[str(p.item.get("category"))] = used_cat.get(str(p.item.get("category")), 0) + 1
        used_protein[f["protein"] or "-"] = used_protein.get(f["protein"] or "-", 0) + 1

    # someone at the table is vegetarian → make sure a vegetarian dish is on the shortlist
    if prof.vegetarians_in_party and not any(dish_facts(p.item)["protein"] == "veg" for p in picks[:3]):
        veg = [p for p, f in scored if f["protein"] == "veg" and p not in picks[:3]]
        if veg:
            v = max(veg, key=lambda p: p.score)
            v.reasons = (["for your vegetarian guest"] + v.reasons)[:3]
            picks = [x for x in picks if x is not v]
            picks.insert(min(2, len(picks)), v)
    return picks[:limit], blocked


# ------------------------------------------------------------------ meal plans & complements


_SHARING = re.compile(r"whole .*(fish|snapper)|\bsnapper\b|platter|family|feast|for (2|3|4|two|three|four)")


def build_plan(
    picks: List[Pick],
    prof: GuestProfile,
    index: Optional[MenuIndex] = None,
    blocked: Optional[Dict[str, List[str]]] = None,
) -> Optional[Dict[str, Any]]:
    """A sensible whole-table order for party/budget questions — arithmetic done here, not by the LLM.

    Heads, not items: a regular main feeds 1, a complete meal (set menu, curry combo, sizzler) feeds 1
    and needs no rice, a sharing dish (whole fish, platter) feeds up to 3 — and is only used when it's
    not a splurge (or the budget covers it). Rice/noodles are sides, never mains: one per two people
    eating plain mains. 3+ people get a starter (fries when kids are along). Varied, within budget."""
    n = max(1, prof.party_size or 1)
    if not (prof.party_size or prof.budget):
        return None
    budget = prof.budget or 10**9
    blocked = blocked or {}
    facts = {id(p): dish_facts(p.item) for p in picks}

    def is_side_rice(f: Dict[str, Any]) -> bool:
        return f["rice"] and not f["complete_meal"]

    mains = [p for p in picks if facts[id(p)]["main"] and not facts[id(p)]["drink"] and not is_side_rice(facts[id(p)])]
    if not mains:
        return None
    prices = sorted(float(p.item.get("price") or 0) for p in mains if not _SHARING.search(facts[id(p)]["text"]))
    median = prices[len(prices) // 2] if prices else 0

    def feeds(p: Pick) -> int:
        if not _SHARING.search(facts[id(p)]["text"]):
            return 1
        m = re.search(r"\bfor (\d+|two|three|four|five|six)\b", str(p.item.get("name") or "").lower())
        stated = int(m.group(1)) if m and m.group(1).isdigit() else {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6}.get(m.group(1) if m else "", 0)
        return min(n, stated or 3)  # "Kacchi Platter for 4" feeds 4; a whole fish ~3

    def sharing_ok(p: Pick) -> bool:
        if not _SHARING.search(facts[id(p)]["text"]):
            return True
        if n < 3:
            return False
        per_head = float(p.item.get("price") or 0) / feeds(p)
        return bool(prof.budget) or "sharing" in prof.mood or (median and per_head <= 1.6 * median)

    def key_of(it: Dict[str, Any]) -> str:
        return str(it.get("id") or it.get("_id"))

    pool_items = [p.item for p in picks] + [
        i for i in (index.items if index else []) if key_of(i) not in blocked and i not in [p.item for p in picks]
    ]

    def compose(candidates: List[Pick]) -> Tuple[Dict[str, Dict[str, Any]], float, bool]:
        """One attempt → (lines, total, complete). 'complete' = every plain main has rice to go with it."""
        lines: Dict[str, Dict[str, Any]] = {}
        total = 0.0

        def add(it: Dict[str, Any], qty: int = 1, why: str = "") -> bool:
            nonlocal total
            sizes = sorted(
                (v for v in it.get("variations") or [] if v.get("name") and isinstance(v.get("price"), (int, float))),
                key=lambda v: v["price"],
            )
            size = sizes[0] if sizes else None  # plans use the standard (smallest) size and say so
            price = float(size["price"] if size else it.get("price") or 0)
            if total + price * qty > budget:
                return False
            row = lines.setdefault(key_of(it), {"item": it, "qty": 0, "why": why, "variant": size["name"] if size else "", "price": price})
            row["qty"] += qty
            total += price * qty
            return True

        heads, plain = 0, 0

        def took(p: Pick, count: int) -> None:
            nonlocal heads, plain
            heads += count
            plain += 0 if facts[id(p)]["complete_meal"] else count

        for p in candidates:  # vegetarians first so they're never forgotten
            if heads >= prof.vegetarians_in_party:
                break
            if facts[id(p)]["protein"] == "veg" and add(p.item, why="for your vegetarian guest"):
                took(p, 1)
        if n >= 3:  # groups: a dish made for sharing covers several people at once — consider it first
            for p in sorted(candidates, key=lambda p: -p.score):
                if feeds(p) >= 2 and sharing_ok(p) and heads + feeds(p) <= n and key_of(p.item) not in lines:
                    if add(p.item, why="made for sharing"):
                        took(p, feeds(p))
                    break
        for p in sorted(candidates, key=lambda p: -p.score):  # best first, one each
            if heads >= n:
                break
            if key_of(p.item) not in lines and sharing_ok(p) and add(p.item, why=(p.reasons[:1] or [""])[0]):
                took(p, feeds(p))
        # still short (tight budget / few options): cheapest DISTINCT dishes first, repeats only after that
        cheap = [p for p in sorted(candidates, key=lambda q: float(q.item.get("price") or 0))
                 if sharing_ok(p) and not _SHARING.search(facts[id(p)]["text"])]
        for repeat in (False, True):
            for p in cheap:
                if heads >= n:
                    break
                if (key_of(p.item) in lines) == repeat and add(p.item):
                    took(p, 1)
        complete = True
        if plain:  # rice/noodles for the plain mains: one per two people
            rice = [i for i in pool_items if is_side_rice(dish_facts(i)) and key_of(i) not in lines]
            rice.sort(key=lambda i: (
                -("rice" in str(i.get("name", "")).lower()),
                bool(re.search(r"special|prawn", str(i.get("name", "")).lower())),
                -("egg" in str(i.get("name", "")).lower() and prof.kids),
                float(i.get("price") or 0),
            ))
            complete = bool(rice) and add(rice[0], max(1, math.ceil(plain / 2)), "to share with the curries")
        if n >= 3:  # a starter for 3+ (fries if kids are along), only if the budget allows
            starters = [i for i in pool_items if dish_facts(i)["starter"] and not dish_facts(i)["main"] and key_of(i) not in lines]
            starters.sort(key=lambda i: (-(prof.kids and dish_facts(i)["kid_friendly"]), float(i.get("price") or 0)))
            if starters:
                add(starters[0], why="to start" if not prof.kids else "for the kids")
        return lines, total, complete and heads >= n

    # try the best-tasting plan; if it can't be a complete meal (e.g. no room for rice in the budget),
    # fall back to complete meals only (set menus, curry combos, sizzlers)
    attempts = [compose(mains)]
    if not attempts[0][2]:
        whole = [p for p in mains if facts[id(p)]["complete_meal"]]
        if whole:
            attempts.append(compose(whole))
    lines, total, complete = next((a for a in attempts if a[2]), attempts[0])
    if not lines:
        return None
    return {
        "lines": [{"name": r["item"].get("name"), "itemId": k, "qty": r["qty"], "price": r["price"], "why": r["why"],
                   "variant": r["variant"]}
                  for k, r in lines.items()],
        "total": int(total) if total == int(total) else round(total, 2),
        "fits": total <= budget,
        "complete": complete,
        "party": n,
        "budget": prof.budget,
    }


def complements(
    index: MenuIndex,
    picks: List[Pick],
    order_ids: List[str],
    stats: Optional[OrderStats] = None,
    limit: int = 3,
    blocked: Optional[Dict[str, List[str]]] = None,
) -> List[Tuple[Dict[str, Any], str]]:
    """What completes the order in `order_ids` (cart + dishes being ordered now): rice/noodles for
    curries, a drink, a starter for bigger orders — ranked by ordered-together data when available."""
    stats = stats or OrderStats()
    items = [index.by_id[i] for i in order_ids if i in index.by_id]
    if not items:
        return []
    have = [dish_facts(i) for i in items]
    has_main = any(f["main"] for f in have)
    has_rice = any(f["rice"] or f["complete_meal"] for f in have)
    has_drink = any(f["drink"] for f in have)
    has_starter = any(f["starter"] for f in have)
    wanted: List[Tuple[str, str]] = []
    if has_main and not has_rice:
        wanted.append(("rice", "goes with your curry"))
    if not has_drink:
        wanted.append(("drink", "something to drink"))
    if has_main and not has_starter and len(items) >= 2:
        wanted.append(("starter", "to start"))
    out: List[Tuple[Dict[str, Any], str]] = []
    candidates = [p.item for p in picks] + [i for i in index.items if i not in [p.item for p in picks]]
    for kind, why in wanted:
        best, best_s = None, -1e9
        for it in candidates:
            iid = index.item_id(it)
            if iid in order_ids:
                continue
            f = dish_facts(it)
            if not f[kind] or (kind == "rice" and f["complete_meal"]):
                continue
            allowed = iid not in (blocked or {}) if blocked is not None else (any(p.item is it for p in picks) or kind == "drink")
            if not allowed:
                continue
            s = stats.pair_score(iid, order_ids) + (1.0 if any(p.item is it for p in picks) else 0)
            if kind == "drink" and "water" in f["text"]:
                s -= 0.5
            if kind == "rice":
                s += 1.5 if "rice" in str(it.get("name") or "").lower() else 0  # fried rice: the classic partner for a curry
                s += 0.5 if not re.search(r"special|prawn", str(it.get("name") or "").lower()) else 0  # plain, affordable
            if s > best_s:
                best, best_s = it, s
        if best is not None:
            out.append((best, why))
        if len(out) >= limit:
            break
    return out


# ------------------------------------------------------------------ WHEN to recommend

_ASKS = re.compile(
    r"recommend|suggest|what'?s good|what is good|what should (i|we)|what (do|would|can) you (recommend|suggest)|"
    r"any (good|recommendation|suggestion)|surprise me|popular|best(seller| seller| dish| thing|\b)|signature|"
    r"(today'?s|house|chef'?s) special|specials\b|don'?t know what|can'?t decide|help me (choose|decide|pick)|"
    r"what to (eat|order|get|have)|what can (i|we) (eat|have|get)|something (light|spicy|mild|filling|to eat|for|good|nice|different)|"
    r"anything good|what (goes|pairs) (well )?with|what else|(i'?m|we'?re) (hungry|starving)|"
    r"কি খা|কী খা|সাজেস্ট|রেকমেন্ড|ভালো (কি|কী)|(কি|কী) ভালো|কোনটা ভালো|কী নেব|কি নেব|কি অর্ডার|কী অর্ডার|কি নেওয়া|কী নেওয়া|"
    r"ভালো (কিছু|খাবার|খাওয়া)|ভালো\s+\S{1,6}\s+(আছে|হবে)|স্পেশাল (কি|কী)|মজার (কি|কী|কিছু)|বেস্ট|সেরা|"
    r"ki khabo|ki khai|ki khawa|suggest koro|kon ?ta (valo|bhalo)|ki nibo|ki order|(valo|bhalo) (ki|kichu)|ki (valo|bhalo)|"
    # a craving is a request too: "হালকা কিছু খেতে যাচ্ছি", "ঝাল কিছু দিন", "কিছু খেতে চাই", "halka kichu"
    r"(হালকা|হাল্কা|ঝাল|ঝালঝাল|কম ঝাল|মিষ্টি|মিস্টি|ঠান্ডা|ঠাণ্ডা|গরম|ভারী|ভারি|মুখরোচক|মজার|নতুন|অন্য) কিছু|"
    r"কিছু খেতে (চাই|যাচ্ছি|ইচ্ছে|ইচ্ছা|মন চাইছে)|খিদে (পেয়েছে|লেগেছে)|ক্ষুধা লেগেছে|"
    r"\b(halka|jhal|misti|mishti|thanda|gorom|vari|bhari|moja|notun) kichu\b|\bkichu khete (chai|jacchi)\b",
    re.I,
)
_DECLINE = re.compile(
    r"^(no|nope|nah|no thanks?|no thank you|not now|maybe later|i'?m good|i'?m fine|not really|something else|anything else\?)\b|"
    r"^না(?![\w\u0980-\u09FF])|^না লাগবে না|^লাগবে না|^থাক|^না থাক|^না ধন্যবাদ|^lagbe na|^na\b",
    re.I,
)
_ALTERNATIVE = re.compile(
    r"something else|anything else\?|other (options?|dishes|suggestions|ideas)|different|another (one|option|dish)|"
    r"not (that|those|these)|cheaper|less expensive|more filling|less spicy|spicier|milder|lighter|অন্য কিছু|অন্য কোন|onno kichu|arekta",
    re.I,
)
_SERVICE = re.compile(
    r"\bbill\b|check please|the check|pay\b|payment|call (a |the )?(waiter|staff|manager)|napkin|tissue|cutlery|spoon|fork|clean|"
    r"complain|too long|taking (so )?long|cold|wrong order|not good|bad|disappointed|refund|"
    r"বিল|ওয়েটার|টিস্যু|দেরি|ঠান্ডা",
    re.I,
)
# "what do you have?" — a tour of the menu, shown as cards to pick from
# "What do you have?" in any wording — the restaurant's food in general, not a kind or a dish:
# "কি আছে তোমাদের মেনুতে?", "তোমাদের কি কি আছে?", "মেনুতে কি আছে?", "ki ache tomader", "what can I get?"
_WHO = r"(আপনাদের|আপনার|তোমাদের|তোমার|তোদের|তোর|আপনাগো|এখানে|আজকে|আজ|মেনুতে|মেনুর মধ্যে|মেনুর ভিতরে|রেস্টুরেন্টে)"
_HAVE = r"(আছে|আছো|আছেন|আসে|পাওয়া যায়|পাওয়া যায়|পাওয়া|পাওয়া|পাব|পাবো|পাবো|পাই|খাওয়া যাবে|খাওয়া যায়)"
_WHAT = r"(কি|কী)"
_OVERVIEW = re.compile(
    rf"{_WHAT} {_WHAT} ({_HAVE}|খাবার)|{_WHAT}\s+({_WHAT}\s+)?{_HAVE}(\s+\S+)?\s+{_WHO}|"
    rf"{_WHO}(\s+(এখানে|আজকে|আজ|মেনুতে))?\s+{_WHAT}\s+({_WHAT}\s+)?(খাবার\s+)?{_HAVE}|"
    r"মেনুতে (আর )?(কি|কী)|মেনু(তে)? (কি|কী) (কি|কী)|মেনুটা (কি|কী)|মেনুতে কী কী|"
    r"খাবারের (তালিকা|লিস্ট|মেনু)|কী কী খাবার|কি কি খাবার|(কি|কী) (কি |কী )?(খাবার )?পাওয়া যায়|"
    r"\bki\s+(ki\s+)?(ache|ase|ase|pawa jay|paoa jay|pabo|khabar)\s+(apnader|apnar|tomader|tomar|tor|toder|ekhane|menu\s*te)\b|"
    r"\b(apnader|apnar|tomader|tomar|toder|ekhane|menu\s*te|menu\s*r\s*moddhe)\s+(ki\s+)?ki\s+(ache|ase|pawa|pabo|khabar)\b|"
    r"\bki ki (ache|ase|pawa|khabar)\b|\bmenu ?te ki\b|"
    r"\bwhat have you got\b|\bwhat (do|have) you( guys)? (have|got|serve|offer)\b|\bwhat'?s (on )?(the|your) menu\b|"
    r"\bwhat (food|dishes|items) (do you have|are there|have you got)\b|\bwhat can i (get|order|eat|have)\b|"
    r"\bwhat'?s (available|good to eat|there to eat)\b|\bwhat are (your|the) (options|dishes|items)\b|\bwhat do you sell\b",
    re.I,
)

_MINE = re.compile(r"আমার|ট্রে|কার্ট|\b(my|tray|cart)\b", re.I)


def asks_overview(text: str) -> bool:
    """"What do you have?" — about the restaurant, not "what's in MY tray"."""
    t = text or ""
    return bool(_OVERVIEW.search(t)) and not _MINE.search(t)


_GREET = re.compile(r"^(hi|hello|hey|salam|assalam|as-salamu|good (morning|afternoon|evening)|আসসালামু|হ্যালো|নমস্কার)(?![\w\u0980-\u09FF])", re.I)


@dataclass
class RecoState:
    """What the recommender remembers between turns."""
    turn: int = 0
    last_offered: List[str] = field(default_factory=list)
    last_offer_turn: int = -99
    last_upsell_turn: int = -99
    declined_turn: int = -99
    drink_offered: bool = False
    gaps_offered: List[str] = field(default_factory=list)  # the offer types made this visit (offers.py — never twice)
    upsell_asked: bool = False  # "সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?" — asked once per visit, never again
    offers_made: int = 0  # the offer engine's offers this visit (offers.MAX_OFFERS)
    offer_declines: int = 0  # "no"s to them (offers.MAX_DECLINES → no more this visit)
    recent: List[str] = field(default_factory=list)  # item ids pitched recently (novelty)
    profile: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> "RecoState":
        d = d or {}
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def is_decline(text: str) -> bool:
    return bool(_DECLINE.search((text or "").strip().lower()))


def asks_for_recommendation(text: str) -> bool:
    return bool(_ASKS.search(text or ""))


def decide_mode(
    text: str,
    *,
    state: RecoState,
    cart_ids: List[str],
    mentioned_ids: List[str],
    has_drinks: bool,
    has_signature: bool,
    cart_has_drink: bool,
    done_ordering: bool,
    confirming: bool,
) -> Tuple[str, str]:
    """(mode, why). Modes:
      full        recommend 2–3 (asked, undecided, or hungry)
      complement  if food gets added this turn, offer ONE thing that completes the order
      last_call   guest is wrapping up with no drink: offer one drink, then ask to confirm
      greet       warm welcome; may mention one signature dish
      answer      answer the question; at most one alternative when genuinely useful
      overview    "what do you have?": the sections of the menu + a few highlights, as cards
      quiet       no suggestions at all (service/complaint, confirming, or they just said no)"""
    t = (text or "").strip()
    turns_since_decline = state.turn - state.declined_turn
    if confirming:
        return "quiet", "confirming the order"
    if _SERVICE.search(t):
        return "quiet", "service request or complaint"
    # "how long will it take?" is about time — never a moment to pitch another dish
    if asks_time(t) and not asks_quickest(t):
        return "quiet", "a wait-time question"
    if asks_for_recommendation(t):
        return "full", "guest asked for a recommendation"
    if asks_overview(t):
        return "overview", "guest wants to know what's on the menu"
    if _ALTERNATIVE.search(t) and state.last_offered and state.turn - state.last_offer_turn <= 2:
        return "full", "guest wants different suggestions"
    if state.last_offered and is_decline(t) and state.turn - state.last_offer_turn <= 1:
        return "quiet", "guest just declined a suggestion"
    if done_ordering and cart_ids:
        if has_drinks and not cart_has_drink and not state.drink_offered and turns_since_decline > 2:
            return "last_call", "wrapping up without a drink"
        return "quiet", "guest is done ordering"
    if _GREET.search(t) and not cart_ids and state.turn <= 1:
        return ("greet", "first hello") if has_signature else ("answer", "first hello")
    looks_like_order = bool(mentioned_ids) and not t.endswith("?")
    if looks_like_order and turns_since_decline > 2 and state.turn - state.last_upsell_turn >= 2:
        return "complement", "guest is ordering; one pairing is welcome"
    return "answer", "a question or small talk"
