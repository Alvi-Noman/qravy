"""ভর্তা and ভাজি at a Bengali rice house, said the way its waiter says them.

A guest's "ভাজি" is every bhaji, not the one dish called "ভাজি"; "ভর্তার মধ্যে কি কি আছে?" is the bhortas only, never
the ইলিশ কচু and the ঢ্যাঁড়স ভাজি that share their menu section. A waiter rattles them off by what they're made of:

    "ভর্তা আছে আলু, টমেটো, বেগুন, ডিম, মাছ, ইলিশ, চিংড়ি আর চিকেন ভর্তা, আর আট আনা ভর্তা মিক্স — ৳30 থেকে ৳100।
     কোনটা দেব?"

…and with a fish or meat curry asks "সাথে ভর্তা বা ভাজি কিছু নেবেন?" (offers.py).
"""
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

import bangla_meal

BHORTA = re.compile(r"ভর্তা|ভর্ত্তা|ভরতা|\b(bhorta|bharta|vorta|borta)s?\b", re.I)
BHAJI = re.compile(r"ভাজি|ভাজা|\b(bhaji|bhaja|vaji|vaja)s?\b", re.I)
_SOBJI = re.compile(r"সবজি|\b(sobji|sabji|shobji)\b", re.I)
_SPICY = re.compile(r"🌶|ঝাল")
# "আর কি কি ভর্তা আছে?" / "আরও ভাজি?" / "অন্য কোন ভর্তা?" — more of the same kind than what was just said
_MORE = re.compile(r"(?<![ঀ-৿])(আর|আরো|আরও|অন্য|অন্যান্য|বাকি)(?![ঀ-৿])|\b(more|other|else)\b", re.I)
_MARKS = re.compile(r"[🌶✓✔️⭐]+")
# words around "ভাজি" that say nothing about which one ("ভর্তা বা ভাজির মধ্যে কি কিছু আছে?")
_FILLER = {"কি", "কী", "কি কি", "বা", "আর", "ও", "কোন", "কোনো", "কোনটা", "কিছু", "মধ্যে", "মধ্য", "এর", "তোমাদের",
           "আপনাদের", "তোদের", "আছে", "আছেন", "নাই", "নেই", "দেন", "দিন", "দাও", "একটা", "একটু", "দুইটা", "দুটো",
           "ভাই", "মামা", "আপা", "এখন", "আজকে", "আজ", "তো", "তাহলে", "সাথে", "ভাতের", "আচ্ছা", "হ্যাঁ", "জি", "ঠিক"}
# speech-to-text cuts: "বাঁধা ভাজি" is a বাঁধাকপি ভাজি
# a fish / meat "ভাজা" is a fish or meat fry ("ইলিশ ভাজা", "মুরগি ভাজা"), not a bhaji
_PROTEIN = re.compile(r"মাছ|ইলিশ|রুই|চিংড়ি|চিংড়ি|পাবদা|কই|টেংরা|বোয়াল|বোয়াল|চিকেন|মুরগি|মুরগী|গরু|বিফ|খাসি|মাটন|হাঁস|"
                      r"\b(fish|chicken|beef|mutton|prawn)\b", re.I)
# an order of other dishes too ("ইলিশ ভাজা আর ভাত দেন"): the usual order flow, not a list of bhajis
_ORDER_VERB = re.compile(r"(?<![ঀ-৿])(দেন|দিন|দাও|দিবেন|দেবেন|চাই|নেব|নিব|নেবো|নিবো|লাগবে|অর্ডার)(?![ঀ-৿])|\b(give|want|order)\b", re.I)
_SAID_AS = {"বাঁধা": "বাঁধাকপি", "বাধা": "বাঁধাকপি", "বাঁধাকপির": "বাঁধাকপি", "ফুলকপির": "ফুলকপি", "পেঁপের": "পেঁপে",
            "আলুর": "আলু", "শাকের": "শাক", "বেগুনের": "বেগুন", "করলার": "করলা", "পটলের": "পটল", "লাউয়ের": "লাউ"}


def group(it: Dict[str, Any]) -> str:
    """"bhorta" / "bhaji" / "" — by the dish's own name (a মাছ ভাজা is a fish dish, a শুটকি ভুনা a curry)."""
    name = str(it.get("name") or "")
    if BHORTA.search(name):
        return "bhorta"
    if bangla_meal.role(it) in ("fish", "chicken", "meat"):
        return ""
    if BHAJI.search(name) or (_SOBJI.search(name) and bangla_meal.role(it) == "side"):
        return "bhaji"
    return ""


def asked(text: str) -> List[str]:
    """The groups the guest's words name, in the order said ("ভর্তা বা ভাজি" → ["bhorta", "bhaji"]; "সবজি" asks for
    the bhajis and vegetables too: "ভর্তা / সবজি কি আছে?")."""
    hits = [(m.start(), g) for g, rx in (("bhorta", BHORTA), ("bhaji", BHAJI), ("bhaji", _SOBJI))
            for m in [rx.search(text or "")] if m]
    hits = [h for i, h in enumerate(sorted(hits)) if h[1] not in [x[1] for x in sorted(hits)[:i]]]
    return [g for _p, g in sorted(hits)]


def _plain(name: str) -> str:
    return re.sub(r"\s+", " ", _MARKS.sub("", name)).strip()


def _short(it: Dict[str, Any], g: str) -> Tuple[str, bool]:
    """("আলু", True) for আলু ভর্তা — said with the others before one "ভর্তা"; ("আট আনা ভর্তা মিক্স", False) whole."""
    name = _plain(bangla_meal.said_name(it))
    word = "ভর্তা" if g == "bhorta" else "ভাজি"
    if name == word:
        return "সবজি", True  # the dish called just "ভাজি" is a mixed vegetable bhaji
    if name.endswith(" " + word):
        head = name[: -len(word)].strip()
        return re.sub(r"(?<=[ঀ-৿]{2})(ের|র)$", "", head) if head.endswith(("ির", "ড়ির")) else head, True
    return name, False


def _say_name(it: Dict[str, Any]) -> str:
    name = _plain(bangla_meal.said_name(it))
    return "সবজি ভাজি" if name == "ভাজি" else name  # (the dish called just "ভাজি" is a mixed vegetable bhaji)


def say_group(items: List[Dict[str, Any]], g: str, bn: bool = True, more: bool = False) -> str:
    """"ভর্তার মধ্যে আলু ভর্তা, টমেটো ভর্তা আর বেগুন ভর্তা আছে" (no question, no price); `more` — there are others
    not said ("…, এছাড়া আরও আছে")."""
    names = [_say_name(it) for it in items]
    if not bn:
        return ("Bhortas: " if g == "bhorta" else "Bhajis: ") + ", ".join(names) + (" and more" if more else "")
    head = "ভর্তার মধ্যে" if g == "bhorta" else "ভাজির মধ্যে"
    return f"{head} {bangla_meal._join(names, 'আর')} আছে" + (", এছাড়া আরও আছে" if more else "")


def say(lists: List[Tuple[str, List[Dict[str, Any]]]], bn: bool = True, limit: Optional[int] = None) -> str:
    """Both kinds in one breath — "ভর্তার মধ্যে A, B আর C আছে, আর ভাজির মধ্যে D আর E আছে" — or one, with its price
    range. At most `limit` of each (the rest: "আরও আছে", for "আর কি কি ভর্তা আছে?")."""
    lists = [(g, items) for g, items in lists if items]
    lim = limit or (5 if len(lists) > 1 else 7)
    if len(lists) == 1:
        g, items = lists[0]
        return say_group(items[:lim], g, bn, more=len(items) > lim) + _prices(items, bn)
    # (both: "…আছে, আর ভাজির মধ্যে … আছে। এছাড়া আরও আছে" — the "more" once, at the end)
    more = any(len(items) > lim for _g, items in lists)
    return (", আর " if bn else "; ").join(say_group(items[:lim], g, bn) for g, items in lists) + (
        ("। এছাড়া আরও আছে" if bn else ", and more") if more else "")


def _prices(items: List[Dict[str, Any]], bn: bool) -> str:
    ps = sorted({float(it.get("price") or 0) for it in items if it.get("price") is not None})
    if not ps:
        return ""
    fmt = lambda p: f"৳{int(p) if p == int(p) else p}"  # noqa: E731
    if len(ps) == 1:
        return (f" — সবগুলো {fmt(ps[0])} করে" if bn else f" — all {fmt(ps[0])}") if len(items) > 1 else f" — {fmt(ps[0])}"
    return f" — {fmt(ps[0])} থেকে {fmt(ps[-1])}" if bn else f" — {fmt(ps[0])} to {fmt(ps[-1])}"


def of_group(items: List[Dict[str, Any]], g: str, item_id: Callable[[Dict[str, Any]], str],
             orderable: Dict[str, bool]) -> List[Dict[str, Any]]:
    """This group's dishes that can be ordered now, in the menu's order, the plain ones first (আলু ভর্তা, শাক ভাজি)."""
    seen, out = set(), []
    for it in items:
        if group(it) != g or not orderable.get(item_id(it), True) or it.get("hidden"):
            continue
        key = _plain(bangla_meal.said_name(it))
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out


def answer(transcript: str, items: List[Dict[str, Any]], item_id: Callable[[Dict[str, Any]], str],
           orderable: Dict[str, bool], named: List[Dict[str, Any]], lang: str,
           row: Callable[[Dict[str, Any]], Dict[str, Any]], seen: Any = ((), ()), said_before: str = ""
           ) -> Optional[Tuple[str, List[Dict[str, Any]], str, List[str]]]:
    """A question about the ভর্তা / ভাজি as a kind → (text, cards, note, ids offered). None: not that, or a dish named
    ("আলু ভর্তা আছে?" is the usual have-answer), or nothing of the kind on the menu at all."""
    t = transcript or ""
    # (the ids said earlier in this thread, and the last turn's — those only if the waiter named them)
    older, last = (set(x) for x in (seen if isinstance(seen, tuple) else ((), seen)))
    groups = asked(t)
    if not groups or not bangla_meal.is_bhaat_house(items):
        return None
    # a particular bhorta / bhaji named ("আলু ভর্তা দেন", "করলা ভাজি কেমন?") is that dish — except the one called just
    # "ভাজি": the guest's "ভাজি" is all of them
    if any(group(it) and _plain(str(it.get("name") or "")) not in ("ভাজি", "ভর্তা") for it in named):
        return None
    if any(not group(it) for it in named) and _ORDER_VERB.search(t):
        return None
    if re.search(r"কি দিয়ে|কী দিয়ে|কিভাবে|কীভাবে|বানা|উপাদান|\b(made|ingredient|recipe)", t, re.I):
        return None  # how it's made: the model, with the dish's description
    bn = lang == "bn"
    lists = {g: of_group(items, g, item_id, orderable) for g in groups}
    if not any(lists.values()):
        return None  # none on now: the usual answers say why (the hours, sold out)

    # "ঝাল কোনটা?" / "ঝাল ছাড়া কোনটা?" within them
    if re.search(r"ঝাল|spicy|\bhot\b", t, re.I):
        pool = [it for g in groups for it in lists[g]]
        mild = bool(re.search(r"ঝাল\s*(ছাড়া|ছাড়া|কম|নাই|নেই|না|ছাড়)|কম\s*ঝাল|\b(not|less|mild|no)\b", t, re.I))
        hot = [it for it in pool if _SPICY.search(str(it.get("name") or ""))]
        if not hot:
            return None
        pick = [it for it in pool if it not in hot] if mild else hot
        if not pick:
            return None
        names = bangla_meal._join([_plain(bangla_meal.said_name(it)) for it in pick[:6]], "আর")
        if bn:
            these = "এগুলো" if len(pick) > 1 else "এটা"
            text = (f"ঝাল কম চাইলে {names} নিতে পারেন — {these} ঝাল না।" if mild
                    else f"ঝাল চাইলে {names} — {'এগুলোতে' if len(pick) > 1 else 'এটাতে'} ঝাল আছে, বাকিগুলো হালকা।") +                    (" কোনটা নেবেন?" if len(pick) > 1 else " দেব?")
        else:
            text = (f"For something mild: {names}." if mild else f"The spicy ones: {names}; the rest are mild.") + \
                   " Which would you like?"
        return text, [row(it) for it in pick[:6]], "side_kind_taste", [item_id(it) for it in pick[:6]]

    # the word before "ভাজি" says which: "বাঁধা ভাজি আছে?" — the menu has none → say so, then what there is;
    # "আলু ভাজি আছে?" — the menu's ঝুরি ভাজা আলু is that
    words = re.findall(r"[ঀ-৿]+|[A-Za-z]+", t)
    missing = ""
    for g in groups:
        rx = BHORTA if g == "bhorta" else BHAJI
        for i, w in enumerate(words):
            if not rx.fullmatch(w) and not (rx.match(w) and len(w) <= len(rx.match(w).group(0)) + 2):
                continue
            if i == 0 or words[i - 1] in _FILLER or BHORTA.search(words[i - 1]) or BHAJI.search(words[i - 1]):
                continue
            q = _SAID_AS.get(words[i - 1], words[i - 1])
            if g == "bhaji" and _PROTEIN.search(q):
                return None  # "ইলিশ ভাজা আছে?" — a fish fry: the usual answers (on the menu or not)
            fits = [it for it in lists[g] if q in str(it.get("name") or "")]
            if len(fits) == 1:
                it = fits[0]
                p = _prices([it], bn)
                text = (f"জি, {q} {'ভর্তা' if g == 'bhorta' else 'ভাজি'} বলতে {_plain(bangla_meal.said_name(it))} আছে{p}। দেব?"
                        if bn else f"Yes — we have {_plain(str(it.get('name')))}{p}. Shall I add it?")
                return text, [row(it)], "side_kind_one", [item_id(it)]
            if not fits and lists[g]:
                # (the guest's own word: "বাঁধাকপি ভাজি", "লাউ ভাজা")
                said_word = w if rx.fullmatch(w) else re.sub(r"র$", "", w)
                missing = f"{q} {said_word}"
            break

    # "আর কি কি ভর্তা আছে?" — the ones not said yet (the guest didn't like those): never the same list again
    if _MORE.search(t) and (older or last):
        # (seen = on the screen AND said: the cards can show more than the waiter named)
        rest = {g: [it for it in lists[g] if not (item_id(it) in older or (
            item_id(it) in last and (not said_before or _say_name(it) in said_before)))] for g in groups}
        if not any(rest.values()):
            word = " বা ".join("ভর্তা" if g == "bhorta" else "ভাজি" for g in groups)
            # every bhaji said and still looking → the bhortas (the closest kind), if they weren't said yet
            other = [g for g in ("bhorta", "bhaji") if g not in groups]
            alt = of_group(items, other[0], item_id, orderable) if other else []
            alt = [it for it in alt if item_id(it) not in older | last]
            if alt:
                text = (f"{word} বলতে এগুলোই আছে — চাইলে {say([(other[0], alt)], bn, limit=6)}। কোনটা নেবেন?" if bn
                        else f"That's all of them — or try these: {say([(other[0], alt)], bn, limit=6)}. Which would you like?")
                return text, [row(it) for it in alt[:6]], "side_kind_other", [item_id(it) for it in alt[:6]]
            text = (f"{word} বলতে এগুলোই আছে — যা বললাম। এর মধ্যে কোনটা নেবেন?" if bn
                    else "That's all of them — the ones I said. Which would you like?")
            pool = [it for g in groups for it in lists[g]]
            return text, [row(it) for it in pool[:12]], "side_kind_all_said", [item_id(it) for it in pool[:12]]
        lists = rest
        head = "আরও আছে — " if bn else "We also have — "
        body = say([(g, lists[g]) for g in groups], bn, limit=8)
        shown = [it for g in groups for it in lists[g][:8]]
        text = head + body + ("। কোনটা নেবেন?" if bn else ". Which would you like?")
        return text, [row(it) for it in shown[:12]], "side_kind_more", [item_id(it) for it in shown[:12]]

    lim = 5 if sum(1 for g in groups if lists[g]) > 1 else 7
    shown = [it for g in groups for it in lists[g][:lim]]
    said = say([(g, lists[g]) for g in groups], bn)
    gone = [("ভর্তা" if g == "bhorta" else "ভাজি") for g in groups if not lists[g]]
    if bn:
        text = (f"দুঃখিত, {missing} নেই। " if missing else "") + said + \
               (f"; {' আর '.join(gone)} এখন নেই" if gone else "") + "। কোনটা নেবেন?"
    else:
        text = (f"Sorry, no {missing}. " if missing else "") + said + ". Which would you like?"
    note = "side_kind_missing" if missing else "side_kind_list"
    return text, [row(it) for it in shown[:12]], note, [item_id(it) for it in shown[:12]]
