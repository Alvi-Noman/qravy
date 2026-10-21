"""The second (third…) suggestion: after "এখন খাওয়ার মত কি আছে?" is answered, the guest asks again —

    more     "আর কি আছে?", "অন্য কিছু দেখান", "আর কোনটা?", "এগুলো না, অন্য কিছু"  → the same ask, nothing already said
    refine   "ঝাল কিছু?", "ঝাল কম", "একটু হালকা কিছু", "আরেকটু বেশি খাবার", "মুরগির কিছু?"  → within what was asked
    pick     "আপনি কোনটা বলবেন?", "এর মধ্যে কোনটা সবচেয়ে ভালো?", "একটা বলেন"            → ONE of the dishes just said

The thread is what started it (the guest's first ask: a kind, a time of day, kids…) and every dish said since, so
"আর কি আছে?" after the soups is more soups, and "ঝাল কোনটা?" after the noodles is the spicy noodles."""
import re
from typing import Any, Dict, List, Optional, Tuple

import bangla_meal
from recommender import dish_facts

# ---------------------------------------------------------------- what the guest asks

_NOT_MORE = re.compile(r"(আর|আরো|আরও)\s*(কিছু|কিছুই)\s*(না|নাই|নেই না|লাগবে না|চাই না|দরকার নেই)|কিছু লাগবে না|"
                       r"\bnothing (else|more)\b|\bthat'?s (all|it)\b", re.I)
_ORDER_VERB = re.compile(r"(?<![ঀ-৿])(দিন|দেন|দাও|দিবেন|দেবেন|দিয়েন|দিও)(?![ঀ-৿])|\b(give me|i'?ll (have|take)|add)\b", re.I)
_MORE = re.compile(
    r"(?<![ঀ-৿])(আর|আরো|আরও|অন্য|অন্যান্য)\s*(কি|কী|কিছু|কোনটা|কোন|কোনো|কোনগুলো|গুলো|গুলা|আইটেম|অপশন|খাবার)|"
    r"(?<![ঀ-৿])(অন্য|অন্যগুলো|অন্যগুলা|আর)\s*(?:কিছু\s*)?(দেখান|দেখাও|দেখাবেন|বলেন|বলুন|বলো|সাজেস্ট)|"
    r"(এগুলো|এগুলা|এইগুলো|এগুলি|এসব)\s*(ছাড়া|ছাড়া|বাদে|না|ভালো লাগছে না)|ভালো লাগছে না|পছন্দ হচ্ছে না|"
    r"\b(what else|anything else|something else|other options?|others|more options?|show me more|any more|"
    r"what other|apart from (these|those))\b|\b(ar ki|onno kichu|aro)\b",
    re.I,
)
_PICK = re.compile(
    r"(আপনি|তুমি|আপনার)\s*(হলে\s*)?(কোনটা|কোনটি)\s*(বলবেন|বলেন|সাজেস্ট|নিতেন|নেবেন|খেতেন|খাবেন|পছন্দ)|"
    r"(কোনটা|কোনটি)\s*(নেব|নিব|নেবো|নিবো|খাব|খাবো|নেওয়া উচিত|নেয়া উচিত|ট্রাই করব|অর্ডার করব)|"
    r"(একটা|একটি)\s*(বলেন|বলুন|বলো|সাজেস্ট করেন|সিলেক্ট করে দেন|বেছে দেন)|বেছে দিন|বেছে দেন|"
    r"(এর|এগুলোর|এগুলার|এদের|এইগুলোর)\s*মধ্যে\s*(কোনটা|কোনটি)|"
    r"(কোনটা|কোনটি)\s*(সবচেয়ে|সব থেকে|বেশি)?\s*(ভালো|বেস্ট|মজা)\s*(হবে|হয়|হয়)?\s*\??$|"
    r"\b(which one (should|would|do|is best)|your (pick|favou?rite)|pick (one|for me)|best one|which is (the )?best|"
    r"what would you (get|have|pick))\b",
    re.I,
)
# "বার্গার ছাড়া কিছু?", "বিরিয়ানি ছাড়া?" — the same ask without that kind (the profile's declined / avoid leave it out)
WITHOUT = re.compile(r"^(.{2,30}?)\s+(ছাড়া|ছাড়া|বাদে|বাদ দিয়ে)\s*(আর\s*)?(কিছু|কি|কী|অন্য কিছু)?\s*(আছে)?\s*\??$", re.I)
_SPICY = re.compile(r"(?<!কম )(?<!না )(?<![ঀ-৿])ঝাল(?! কম)(?! ছাড়া)(?! ছাড়া)(?! নাই)(?! নেই)|\bspicy\b|\bjhal\b", re.I)
_MILD = re.compile(r"ঝাল কম|কম ঝাল|ঝাল ছাড়া|ঝাল ছাড়া|ঝাল নাই|ঝাল নেই|ঝাল ছাড়া|\b(mild|less spicy|not spicy|no spice)\b",
                   re.I)
_LIGHT = re.compile(r"হালকা|লাইট|\blight\b|\bsomething light\b", re.I)
_FILLING = re.compile(r"বেশি খাবার|ভারী|ভারি|পেট ভরে|পেট ভরার|বড় কিছু|বড় কিছু|বেশি পরিমাণ|\b(filling|heavy|bigger|more food)\b",
                      re.I)
PROTEINS: List[Tuple[str, str, str]] = [  # (fact, words, Bangla label "…র মধ্যে")
    ("chicken", r"মুরগি|মুরগী|চিকেন|\bchicken\b|\bmurgi\b", "মুরগির"),
    ("fish", r"(?<![ঀ-৿])মাছ|\bfish\b|\bmach\b", "মাছের"),
    ("prawn/shrimp", r"চিংড়ি|চিংড়ি|প্রন|\b(prawn|shrimp)\b", "চিংড়ির"),
    ("beef", r"(?<![ঀ-৿])গরু|বিফ|\bbeef\b", "গরুর"),
    ("mutton", r"খাসি|মাটন|\bmutton\b|\bgoat\b", "খাসির"),
    ("duck", r"হাঁস|\bduck\b", "হাঁসের"),
    ("veg", r"সবজি|নিরামিষ|ভেজ|\bveg(gie|etable|etarian)?\b", "সবজির"),
]
_HEAVY = re.compile(r"fried|\bfry\b|fries|crispy|cheese|butter|bacon|cream|tempura|biry?ani|kacchi|tehari|khichuri|"
                    r"set menu|platter|combo|sizzl|burger|pizza|ফ্রাই|ভাজা|ক্রিস্পি|চিজ|বাটার|ক্রিম|কালা ভুনা|রেজালা|কোরমা|"
                    r"নেহারি|পায়া|হালিম|বিরিয়ানি|বিরিয়ানি|কাচ্চি|তেহারি|খিচুড়ি|খিচুড়ি|পোলাও|সিজলিং", re.I)
_LIGHT_DISH = re.compile(r"grill|steam|soup|salad|vegetable|\bveg\b|\bdal\b|lentil|tandoori|tikka|kebab|kabab|boiled|"
                         r"jhol|clear|গ্রিল|স্যুপ|সুপ|সালাদ|সবজি|ডাল|ভাপা|ভাপে|সেদ্ধ|তন্দুরি|টিক্কা|কাবাব|ঝোল|মাছ", re.I)


_POINTING = re.compile(r"\b(it|this|that|these|those|they|them)\b|ওইটা|ওটা|এটা|এটি|এইটা|সেটা|ওগুলো|ওগুলা", re.I)
# "অন্য কিছু" is something DIFFERENT (out of the kind just listed); "আর কি আছে?" is more of the same
OTHER = re.compile(r"অন্য|ভিন্ন|আলাদা|\b(else|other|different|instead)\b|ভালো লাগছে না|পছন্দ হচ্ছে না|এগুলো ছাড়া|এগুলো বাদে",
                   re.I)


def ask_kind(t: str) -> Optional[str]:
    """"more" / "pick" / "refine" — or None when this is a new ask (or no suggestion ask at all)."""
    t = (t or "").strip()
    if not t or len(t.split()) > 9 or _NOT_MORE.search(t) or _ORDER_VERB.search(t):
        return None
    if _POINTING.search(t) and not _PICK.search(t):
        return None  # "ওইটা ঝাল?" / "Is it spicy?" — about the dishes just said, not a new narrowing
    if _PICK.search(t):
        # "জন্মদিনের জন্য কোনটা ভালো?" — a purpose: what suits it (a whole cake, not a pastry) — the model weighs that
        if re.search(r"জন্য|জন্যে|উপলক্ষ|অনুষ্ঠান|পার্টি|\b(for (a|the|my|our)|party|birthday|occasion)\b", t, re.I) and not re.search(
                r"(এর|এগুলোর|এগুলার|এদের|এইগুলোর)\s*মধ্যে|\bof (these|them)\b", t, re.I):
            return None
        return "pick"
    if len(t.split()) > 6 and not re.search(r"ভালো লাগছে না|পছন্দ হচ্ছে না", t):
        return None  # a longer line ("না, প্লেটার খাবো না, অন্য কিছু দিয়ে পেট ভরবো") carries more than a follow-up: the model
    if WITHOUT.search(t) or CHEAPER.search(t):
        return "refine"
    if _MILD.search(t) or _SPICY.search(t) or _LIGHT.search(t) or _FILLING.search(t) or protein_asked(t):
        return "refine"
    if _MORE.search(t):
        return "more"
    return None


def protein_asked(t: str) -> Optional[Tuple[str, str]]:
    """("chicken", "মুরগির") for "মুরগির কিছু আছে?" — not for "মাছ ছাড়া" (that's an avoid, the profile's)."""
    for fact, words, label in PROTEINS:
        m = re.search(words, t or "", re.I)
        if m and not re.search(r"^\s*(ছাড়া|ছাড়া|বাদে|বাদ|না|খাই না|খাবো না)", (t or "")[m.end():]):
            return fact, label
    return None


def refine_label(t: str, bn: bool) -> str:
    """How the waiter names what was asked for: "ঝাল", "ঝাল কম", "মুরগির", "বার্গার ছাড়া"…"""
    w = WITHOUT.search(t or "")
    if w:
        return f"{w.group(1).strip()} ছাড়া" if bn else f"other than {w.group(1).strip()}"
    if CHEAPER.search(t or ""):
        return "একটু কম দামের" if bn else "cheaper"
    if _MILD.search(t):
        return "ঝাল কম" if bn else "milder"
    if _SPICY.search(t):
        return "ঝাল" if bn else "spicy"
    if _LIGHT.search(t):
        return "হালকা" if bn else "lighter"
    if _FILLING.search(t):
        return "পেট ভরে খাওয়ার মতো" if bn else "more filling"
    p = protein_asked(t)
    if p:
        if p[0] == "veg":
            return "নিরামিষ" if bn else "vegetarian"
        return p[1] if bn else p[0].split("/")[0]
    return ""


CHEAPER = re.compile(r"কম দাম|কমদাম|দাম কম|সস্তা|সাশ্রয়ী|সাশ্রয়ী|\b(cheaper|less expensive|more affordable|budget)\b", re.I)


def stack(lines: List[str]) -> List[str]:
    """The refinements said since the thread began, the way they add up: the last protein and the last taste win
    ("মুরগির?" then "মাছের?" is fish, not chicken AND fish), every "X ছাড়া" stays, cheaper stays."""
    protein = taste = body = None
    keep: List[str] = []
    for t in lines:
        if WITHOUT.search(t) or CHEAPER.search(t):
            keep.append(t)
            continue
        if protein_asked(t):
            protein = t
        if _MILD.search(t) or _SPICY.search(t):
            taste = t
        if _LIGHT.search(t) or _FILLING.search(t):
            body = t
    return keep + [x for x in (protein, taste, body) if x]


def fits(it: Dict[str, Any], t: str, ceiling: float = 0) -> bool:
    """Does this dish fit the refinement said? (ceiling: "একটু কম দামের" — below it)"""
    f = dish_facts(it)
    name = f"{it.get('name') or ''} {it.get('category') or ''}"
    hot = f.get("heat") in ("spicy", "likely spicy")
    if CHEAPER.search(t or "") and ceiling and _lowest(it) >= ceiling:
        return False
    if _MILD.search(t) and hot:
        return False
    if _SPICY.search(t) and not _MILD.search(t) and not hot:
        return False
    if _LIGHT.search(t) and (_HEAVY.search(name) or not _LIGHT_DISH.search(name)):
        return False
    if _FILLING.search(t) and not (f.get("complete_meal") or _HEAVY.search(name)):
        return False
    p = None if WITHOUT.search(t or "") else protein_asked(t)
    if p:
        mine = str(f.get("protein") or "")
        if p[0] == "fish" and mine == "prawn/shrimp":
            return True  # (চিংড়ি is মাছ to a Bengali guest)
        if p[0] == "veg":
            return mine == "veg" or f.get("diet") in ("vegetarian", "vegan", "likely vegetarian")
        if mine != p[0]:
            return False
    return True


def wants_sides(lines: List[str]) -> bool:
    """A vegetarian ask may be answered with a dal or a vegetable dish (they're the answer there)."""
    return any((protein_asked(t) or ("",))[0] == "veg" for t in lines if not WITHOUT.search(t))


def compose(lines: List[str], bn: bool) -> str:
    """The stacked asks said the way a waiter says them, before "আছে …": "মুরগির মধ্যে ঝাল কম", "একটু কম দামে হালকা",
    "বার্গার ছাড়া ঝাল", "নিরামিষের মধ্যে"."""
    without = [refine_label(t, bn) for t in lines if WITHOUT.search(t)]
    cheap = any(CHEAPER.search(t) for t in lines)
    prot = next((protein_asked(t) for t in lines if protein_asked(t) and not WITHOUT.search(t)), None)
    rest = [refine_label(t, bn) for t in lines
            if not WITHOUT.search(t) and not CHEAPER.search(t) and not (protein_asked(t) and refine_label(t, bn) in
                                                                         (PROT_LABEL.get(protein_asked(t)[0], ""), "নিরামিষ"))]
    if not bn:
        bits = without + (["cheaper"] if cheap else []) + rest + ([prot[0].split("/")[0]] if prot else [])
        return " ".join(bits)
    bits = without + (["একটু কম দামে"] if cheap else [])
    if prot:
        bits.append(("নিরামিষের" if prot[0] == "veg" else prot[1]) + " মধ্যে")
    bits += rest
    return " ".join(b for b in bits if b)


PROT_LABEL = {fact: label for fact, _w, label in PROTEINS}


_KIDS_NOT = re.compile(r"triple|tower|stack|double|naga|extra hot|bacon|ghost|ট্রিপল|নাগা|ডাবল", re.I)


def kid_friendly(it: Dict[str, Any]) -> bool:
    """For a child: nothing spicy, no tower of three patties."""
    return (dish_facts(it).get("heat") not in ("spicy", "likely spicy")
            and not _KIDS_NOT.search(str(it.get("name") or "")))


def _lowest(it: Dict[str, Any]) -> float:
    ps = [float(v.get("price")) for v in it.get("variations") or [] if v.get("price") is not None]
    return min(ps) if ps else float(it.get("price") or 0)


# ---------------------------------------------------------------- how the waiter says it

_GROUPS = (("fish", "মাছের"), ("prawn/shrimp", "মাছের"), ("chicken", "মুরগির"), ("beef", "মাংসের"), ("mutton", "মাংসের"),
           ("duck", "মাংসের"), ("veg", "সবজি-ডালের"), ("egg", "ডিমের"))


def _join(names: List[str], word: str) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {word} " + names[-1]


def say_list(items: List[Dict[str, Any]], bn: bool, grouped: bool) -> str:
    """"মাছের মধ্যে রূপসী রূপচাঁদা আর চিংড়ি ষোল আনা, মাংসের মধ্যে দেশি হাঁস ভুনা" (a bhaat house: by what it is — a duck
    is never "among the fish"), else "A, B আর C"."""
    names = [bangla_meal.said_name(x) for x in items]
    if not bn:
        return _join(names, "and")
    if grouped:
        by: Dict[str, List[str]] = {}
        for it, n in zip(items, names):
            label = next((lb for fact, lb in _GROUPS if fact == str(dish_facts(it).get("protein") or "")), "")
            by.setdefault(label, []).append(n)
        if len(by) >= 2 and "" not in by:
            return ", ".join(f"{lb} মধ্যে {_join(ns, 'আর')}" for lb, ns in by.items())
    return _join(names, "আর")


def reason_for(it: Dict[str, Any], hot_ids: set, iid: str, t_thread: str, bn: bool, kids: bool) -> str:
    """Why this one — only what's true: the house special, the most ordered, the spicy one asked for, easy for kids."""
    if iid in hot_ids:
        return " — এখানে এটাই সবচেয়ে বেশি অর্ডার হয়" if bn else " — it's the most ordered here"
    if it.get("signature"):
        return " — এটা আমাদের স্পেশাল" if bn else " — it's our special"
    if _SPICY.search(t_thread) and dish_facts(it).get("heat") in ("spicy", "likely spicy"):
        return " — ঝাল যারা ভালোবাসেন তাদের জন্য" if bn else " — for those who like it hot"
    if kids:
        return " — বাচ্চারা সহজে খেতে পারে" if bn else " — easy for kids"
    return ""
