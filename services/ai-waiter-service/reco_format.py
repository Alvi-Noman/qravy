"""The waiter's two ways of recommending, as a real Bangladeshi waiter says them.

1. A KIND of dish (special, spicy, sour, sweet, a category — soups, juice, desserts…) or just "what's good?":
   "{ঝাল} আইটেমের মধ্যে A, B অথবা C খুবই জনপ্রিয়, এছাড়াও আপনি D কিংবা E-ও নিতে পারেন।"
2. WHO it's for (family, kids, girlfriend…):
   "আপনার {বাচ্চাদের} জন্য A, B অথবা C নিতে পারেন, এছাড়াও D কিংবা E-ও নিতে পারেন।"

The dishes are always this menu's ranked picks (fitted to the time of day, availability and the guest) — only the
sentence is fixed, and it shrinks to however many dishes there are. brain.py decides WHEN a turn is plain enough for
this (anything more specific — a budget, a head-count, an allergy — is still the model's, which gets these same
shapes as guidance).
"""

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

# tastes: (key, how the guest says it, Bangla label, English label)
TASTES: List[Tuple[str, str, str, str]] = [
    ("special", r"স্পেশাল|স্পেশাল|সিগনেচার|\bspecial\b|\bsignature\b|\bspecialit", "স্পেশাল", "special"),
    ("spicy", r"(?<!কম )(?<!না )ঝাল|\bspicy\b|\bjhal\b|\bhot (food|dish|item)", "ঝাল", "spicy"),
    ("sour", r"(?<![ঀ-৿])টক(?![ঀ-৿])|টকটক|\bsour\b|\btok\b|tangy", "টক", "sour"),
    ("sweet", r"মিষ্টি|মিস্টি|\bsweet\b(?! (and|&) sour)|\bmishti\b", "মিষ্টি", "sweet"),
]

# what makes a dish that taste (from its name / category / description)
_SOUR = re.compile(r"sour|lemon|lime|tamarind|tetul|tom ?yum|achar|pickle|borhani|\btok\b|vinegar|mojito", re.I)
_SWEET = re.compile(r"dessert|sweet|honey|caramel|chocolate|firni|payesh|halwa|ice ?cream|pudding|cake|brownie|kulfi|"
                    r"jorda|lassi|shake|falooda|roshogolla|rasmalai|mishti|jilapi|custard", re.I)

# who it's for: (how the guest says it, Bangla "…এর জন্য", English, a sharing table?)
AUDIENCES: List[Tuple[str, str, str, bool]] = [
    (r"বাচ্চা|শিশু|\bkids?\b|\bchild(ren)?\b|\bbaa?cc?ha", "বাচ্চাদের", "kids", False),
    (r"গার্লফ্রেন্ড|girl ?friend|\bgf\b", "গার্লফ্রেন্ডের", "girlfriend", False),
    (r"বয়ফ্রেন্ড|boy ?friend|\bbf\b", "বয়ফ্রেন্ডের", "boyfriend", False),
    (r"বান্ধবী", "বান্ধবীর", "friend", False),
    (r"ওয়াইফ|স্ত্রী|(?<![ঀ-৿])বউ|(?<![ঀ-৿])বৌ|\bwife\b", "স্ত্রীর", "wife", False),
    (r"হাজব্যান্ড|স্বামী|\bhusband\b", "স্বামীর", "husband", False),
    (r"বাবা.?মা|মা.?বাবা|আব্বু|আম্মু|\bparents\b", "বাবা-মায়ের", "parents", False),
    (r"ফ্যামিলি|পরিবার|\bfamily\b", "পরিবারের", "family", True),
    (r"বন্ধু|ফ্রেন্ড|\bfriends?\b", "বন্ধুদের", "friends", True),
    (r"মেহমান|অতিথি|\bguests\b", "মেহমানদের", "guests", True),
    (r"কলিগ|অফিস|\bcolleagues?\b|\bteam\b", "কলিগদের", "colleagues", True),
]
_FOR = re.compile(r"জন্য|জন্যে|\bjonno\b|\bfor\b", re.I)

# the meal period, as a waiter says it
_WHEN_BN = {"breakfast": "সকালের নাস্তায়", "lunch": "দুপুরের খাবারে", "afternoon": "বিকেলের নাস্তায়",
            "dinner": "রাতের খাবারে", "late": "এত রাতে"}
_WHEN_EN = {"breakfast": "For breakfast", "lunch": "For lunch", "afternoon": "This afternoon", "dinner": "For dinner",
            "late": "This late"}


def taste_asked(text: str) -> Optional[Tuple[str, str, str]]:
    """("spicy", "ঝাল", "spicy") when the guest asks for a taste — never for "less spicy" (that's the model's)."""
    for key, pat, bn, en in TASTES:
        if re.search(pat, text or "", re.I):
            return key, bn, en
    return None


def audience_asked(text: str) -> Optional[Tuple[str, str, bool]]:
    """("বাচ্চাদের", "kids", False) for "বাচ্চাদের জন্য কী ভালো?" — only with "জন্য / for"."""
    t = text or ""
    if not _FOR.search(t):
        return None
    for pat, bn, en, sharing in AUDIENCES:
        if re.search(pat, t, re.I):
            return bn, en, sharing
    return None


def has_taste(key: str, it: Dict[str, Any], facts: Dict[str, Any], is_signature: Callable[[Dict[str, Any]], bool]) -> bool:
    if key == "special":
        return is_signature(it)
    if key == "spicy":
        return facts.get("heat") in ("spicy", "likely spicy")
    if key == "sour":
        return bool(_SOUR.search(facts.get("text") or ""))
    if key == "sweet":
        return bool(_SWEET.search(facts.get("text") or ""))
    return False


def _join(names: List[str], last: str) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {last} " + names[-1]


def kind_text(label: str, top: List[str], more: List[str], lang: str, *, when: str = "", popular: bool = True) -> str:
    """Format 1. `label` = "ঝাল" / "spicy"; empty label with `when` = the meal period ("রাতের খাবারে…").
    `popular` only when the data says so (orders / a "popular" tag) — otherwise "খুবই ভালো", never an invented claim."""
    if lang == "bn":
        lead = f"{label} আইটেমের মধ্যে" if label else (_WHEN_BN.get(when) or "এখন")
        s = f"{lead} {_join(top, 'অথবা')} {'খুবই জনপ্রিয়' if popular else 'খুবই ভালো'}"
        return s + (f", এছাড়াও আপনি {_join(more, 'কিংবা')}-ও নিতে পারেন।" if more else "।")
    lead = f"Among our {label} items," if label else (_WHEN_EN.get(when) or "Right now") + ","
    verb = "is" if len(top) == 1 else "are"
    s = f"{lead} {_join(top, 'or')} {verb} {'very popular' if popular else 'great choices' if len(top) > 1 else 'a great choice'}"
    return s + (f" — you could also try {_join(more, 'or')}." if more else ".")


def audience_text(who: str, top: List[str], more: List[str], lang: str) -> str:
    """Format 2. `who` = "বাচ্চাদের" / "kids"."""
    if lang == "bn":
        s = f"আপনার {who} জন্য {_join(top, 'অথবা')} নিতে পারেন"
        return s + (f", এছাড়াও {_join(more, 'কিংবা')}-ও নিতে পারেন।" if more else "।")
    s = f"For your {who}, you could get {_join(top, 'or')}"
    return s + (f" — or {_join(more, 'or')} as well." if more else ".")


def split(dishes: List[Any], first: int = 3, total: int = 5) -> Tuple[List[Any], List[Any]]:
    """Up to three to lead with, up to two more — fewer when the menu has fewer."""
    dishes = dishes[:total]
    return dishes[:first], dishes[first:]
