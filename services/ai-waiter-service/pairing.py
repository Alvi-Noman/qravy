"""
"What goes with it?" — answered the way a waiter there would, from what the dish IS (not the menu's order):

  a curry / bhuna / fish at a ভাত restaurant → সাদা ভাত, and a ভর্তা or ডাল on the side
  a curry anywhere else (Indian, Chinese)      → its rice / naan / fried rice
  a kebab / grill                              → পরোটা or নান, and a cold drink
  a kacchi / biryani / polao / tehari          → borhani (or a cold drink), a roast or kebab beside it, then firni / doi
  a burger / sandwich / wrap                   → fries and a drink
  a soup / starter                             → a main course

It once answered "What goes well with it?" about a chicken biryani with a whole rice-and-fish meal, and a curry's partner
was পাঁচ পরোটা for being first on the menu. Pure (no I/O).
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import bangla_meal
from recommender import dish_facts, is_packaged
from upsell import dish_roles, of_bn
from waiter_knowledge import MenuIndex, kind_text

# the guest asks what to have WITH something
ASKS = re.compile(
    r"(?<!ওর )(?<!তার )(?<!ওনার )(?<!ওদের )(?<!আমার )(?<!তোমার )(?<!আপনার )সাথে (কি|কী) (নেওয়া|নেয়া|নিব|নেব|নিবো|নেবো|খাওয়া|খাওয়া|খাব|খাবো|ভালো|দিব|দেব|যায়|যাবে|চলে|নিতে)|"
    r"(কি|কী) দিয়ে খা|কিসের সাথে|সাথে (ভালো|মানাবে|জমবে) (কি|কী)|"
    r"\bwhat (goes|pairs) (well |best |nicely )?with\b|\bwhat (should|can|could|do) (i|we) (have|get|order|eat) with\b|"
    r"\b(goes|go) (well )?with (it|this|that)\b|\bshkathe ki\b|\bsathe ki\b",
    re.I,
)

_KEBAB = re.compile(r"kebab|kabab|tikka|shashlik|\bgrill\b|tandoori|\bboti\b|chaap|reshmi|seekh|\bshik\b|"
                    r"কাবাব|টিক্কা|গ্রিল|চাপ|শিক|বটি", re.I)
_RICE_DISH = re.compile(r"biry?ani|kacchi|tehari|polao|pulao|khichuri|বিরিয়ানি|বিরিয়ানি|কাচ্চি|তেহারি|পোলাও|খিচুড়ি|খিচুড়ি", re.I)
_HANDHELD = re.compile(r"burger|sandwich|wrap|roll|shawarma|sub\b|hot ?dog|বার্গার|স্যান্ডউইচ|র‍্যাপ|শর্মা|রোল", re.I)
_BORHANI = re.compile(r"borhani|বোরহানি", re.I)
_LASSI = re.compile(r"lassi|লাচ্ছি|লাস্সি", re.I)
_COLD = re.compile(r"lassi|borhani|juice|lemonade|lime|soda|cola|coke|sprite|fanta|7 ?up|shake|mojito|iced|"
                   r"লাচ্ছি|বোরহানি|জুস|লেবু|লাইম|কোলা|কোক|স্প্রাইট|ফান্টা|সেভেন আপ|রস|আনারস|শরবত", re.I)
_HOT = re.compile(r"\btea\b|coffee|espresso|latte|cappuccino|americano|\bhot\b|(?<![ঀ-৿])চা(?![ঀ-৿])|কফি", re.I)
_SIDE_MEAT = re.compile(r"roast|rezala|korma|jali|kabab|kebab|রোস্ট|রেজালা|কোরমা|জালি|কাবাব", re.I)
_SWEET_AFTER = re.compile(r"firni|jorda|zarda|doi|yogurt|payesh|kheer|ফিরনি|জর্দা|দই|পায়েস|পায়েস|ক্ষীর", re.I)
_FRIES = re.compile(r"\bfries\b|french fry|ফ্রাই(জ|স)?(?![ঀ-৿])|ফ্রেঞ্চ", re.I)
_PLAIN_FIRST = re.compile(r"special|prawn|mixed|স্পেশাল|মিক্স|চিংড়ি|প্রন", re.I)


def _SIDE_RANK(name: str) -> int:
    if re.search(r"(?<![ঀ-৿])ডাল(?![ঀ-৿])|\bdh?aa?l\b", name, re.I):
        return 0
    if re.search(r"আলু ভর্তা|বেগুন ভর্তা|alu bhorta|begun bhorta", name, re.I):
        return 1
    if re.search(r"ভর্তা|bhorta", name, re.I):
        return 2
    if re.search(r"ভাজি|ভাজা|bhaji|vaji", name, re.I):
        return 3
    return 4


def _said(it: Dict[str, Any]) -> str:
    return bangla_meal.said_name(it)


def _join(names: List[str], word: str) -> str:
    names = list(dict.fromkeys(n for n in names if n))
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {word} " + names[-1] if names else ""


def anchor(index: MenuIndex, tray_ids: List[str], named: List[Dict[str, Any]], focus: List[Dict[str, Any]]
           ) -> Optional[Dict[str, Any]]:
    """The dish "it" means: one named now, else the last FOOD added to the tray, else the one being talked about."""
    def food(it: Dict[str, Any]) -> bool:
        r = dish_roles(it)
        return not (r["drink"] or r["dessert"] or is_packaged(it))

    for it in named:
        if food(it):
            return it
    for iid in reversed(tray_ids):
        it = index.by_id.get(iid)
        if it and food(it) and not dish_roles(it)["rice"]:
            return it
    for it in focus:
        if food(it):
            return it
    return None


def partners(it: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool], tray_ids: Iterable[str],
             ok: Callable[[Dict[str, Any]], bool]) -> Tuple[str, List[Tuple[str, List[Dict[str, Any]]]]]:
    """(what the anchor is, [(role, [dishes])]) — the partners in the order a waiter names them."""
    have = set(tray_ids)
    pool = [x for x in index.items
            if x is not it and orderable.get(index.item_id(x), True) and index.item_id(x) not in have and ok(x)]
    in_tray = [index.by_id[i] for i in have if i in index.by_id]

    def pick(test: Callable[[Dict[str, Any]], bool], n: int = 2) -> List[Dict[str, Any]]:
        got = [x for x in pool if test(x)]
        # the plain, everyday one first ("সাদা ভাত" before "সুগন্ধি ভাত", "পরোটা" before "পাঁচ পরোটা")
        got.sort(key=lambda x: (bool(_PLAIN_FIRST.search(str(x.get("name") or ""))), len(_said(x)),
                                float(x.get("price") or 0)))
        out, seen = [], set()
        for x in got:
            if _said(x) not in seen:
                seen.add(_said(x))
                out.append(x)
        return out[:n]

    def has(test: Callable[[Dict[str, Any]], bool]) -> bool:
        return any(test(x) for x in in_tray)

    name = kind_text({"name": it.get("name")}) + " " + str(it.get("name") or "")
    f = dish_facts(it)
    bhaat = bangla_meal.is_bhaat_house(index.items)
    cold = lambda x: dish_roles(x)["drink"] and bool(_COLD.search(kind_text(x) + " " + str(x.get("name") or ""))) \
        and not _HOT.search(str(x.get("name") or ""))  # noqa: E731
    drink_had = has(lambda x: dish_roles(x)["drink"])
    groups: List[Tuple[str, List[Dict[str, Any]]]] = []

    if _RICE_DISH.search(name) or (f["complete_meal"] and f["rice"]):
        borhani = pick(lambda x: bool(_BORHANI.search(str(x.get("name") or ""))), 1)
        if not drink_had:
            groups.append(("drink", borhani or pick(lambda x: cold(x) and bool(_LASSI.search(str(x.get("name") or ""))), 1)
                           or pick(lambda x: cold(x) and not is_packaged(x), 1) or pick(cold, 1)))
        groups.append(("beside", pick(lambda x: bool(_SIDE_MEAT.search(str(x.get("name") or "")))
                                      and not _RICE_DISH.search(str(x.get("name") or "")), 2)))
        groups.append(("after", pick(lambda x: dish_roles(x)["dessert"] and bool(_SWEET_AFTER.search(
            kind_text(x) + " " + str(x.get("name") or ""))), 2) or pick(lambda x: dish_roles(x)["dessert"], 1)))
        return "rice_dish", [g for g in groups if g[1]]

    if _KEBAB.search(name) and not f["rice"]:
        if not has(lambda x: dish_roles(x)["rice"]):
            groups.append(("bread", pick(lambda x: dish_roles(x)["rice"] and not bangla_meal.is_plain_rice(x)
                                         and not _RICE_DISH.search(str(x.get("name") or "")), 2)))
        if not drink_had:
            groups.append(("drink", pick(lambda x: cold(x) and not is_packaged(x), 1) or pick(cold, 1)))
        return "kebab", [g for g in groups if g[1]]

    if _HANDHELD.search(name) or dish_roles(it)["handheld"]:
        if not has(lambda x: bool(_FRIES.search(str(x.get("name") or "")))):
            groups.append(("fries", pick(lambda x: bool(_FRIES.search(str(x.get("name") or ""))), 1)))
        if not drink_had:
            groups.append(("drink", pick(lambda x: cold(x) and not is_packaged(x), 1) or pick(cold, 1)))
        return "handheld", [g for g in groups if g[1]]

    role = bangla_meal.role(it)
    if bhaat and role in ("fish", "chicken", "meat"):
        if not has(bangla_meal.is_plain_rice):
            groups.append(("rice", pick(bangla_meal.is_plain_rice, 1)))
        # what a Bengali waiter names first: ডাল, then আলু / বেগুন ভর্তা, then a ভাজি (the menu's order within each)
        sides = [x for x in pool if bangla_meal.role(x) == "side"]
        sides.sort(key=lambda x: (_SIDE_RANK(str(x.get("name") or "")), index.position.get(index.item_id(x), 1 << 20)))
        groups.append(("side", list({_said(x): x for x in reversed(sides[:4])}.values())[::-1][:2]))
        return "curry_bhaat", [g for g in groups if g[1]]

    r = dish_roles(it)
    if r["needs_rice"] or (r["main"] and not f["complete_meal"]):
        if not has(lambda x: dish_roles(x)["rice"]):
            groups.append(("rice", pick(lambda x: dish_roles(x)["rice"], 2)))
        if not drink_had:
            groups.append(("drink", pick(lambda x: cold(x) and not is_packaged(x), 1)))
        return "main", [g for g in groups if g[1]]

    # (a soup, fries, a starter: what comes after it is the model's to say, with the conversation in view)
    return "", []


def reply(it: Dict[str, Any], shape: str, groups: List[Tuple[str, List[Dict[str, Any]]]], lang: str) -> str:
    """"চিকেন বিরিয়ানির সাথে বোরহানি ভালো যায়, পাশে মুরগির রোস্ট নিতে পারেন — শেষে ফিরনি।" """
    bn = lang == "bn"
    d = _said(it)
    g = {k: [_said(x) for x in v] for k, v in groups}
    n_items = sum(len(v) for v in g.values())
    ask = (" দেব?" if n_items == 1 else " কোনটা দেব?") if bn else (" Shall I add it?" if n_items == 1 else " Which would you like?")
    if bn:
        poss = of_bn(d) if re.search(r"[ঀ-৿]$", d) else f"{d}-এর"
        if shape == "curry_bhaat":
            s = f"{poss} সাথে {g['rice'][0]} সবচেয়ে ভালো যায়" if g.get("rice") else f"{poss} সাথে"
            if g.get("side"):
                s += (" — পাশে " if g.get("rice") else " ") + f"{_join(g['side'], 'বা')} নিতে পারেন"
            return s + "।" + ask
        if shape == "rice_dish":
            bits = []
            if g.get("drink"):
                bits.append(f"{_join(g['drink'], 'বা')} ভালো যায়")
            if g.get("beside"):
                bits.append(f"পাশে {_join(g['beside'], 'বা')} নিতে পারেন")
            if g.get("after"):
                bits.append(f"শেষে {_join(g['after'], 'বা')}")
            return f"{poss} সাথে " + ", ".join(bits) + "।" + ask
        if shape == "kebab":
            bits = []
            if g.get("bread"):
                bits.append(f"{_join(g['bread'], 'বা')} দিয়ে খেতে পারেন")
            if g.get("drink"):
                bits.append(f"সাথে একটা {g['drink'][0]} ভালো লাগবে")
            return f"{d} " + ", ".join(bits) + "।" + ask
        if shape == "handheld":
            bits = [x for x in (g.get("fries") or []) + (g.get("drink") or [])]
            return f"{poss} সাথে {_join(bits, 'আর')} ভালো যায়।" + ask
        if shape == "main":
            bits = []
            if g.get("rice"):
                bits.append(f"{_join(g['rice'], 'বা')}")
            if g.get("drink"):
                bits.append(f"একটা {g['drink'][0]}")
            return f"{poss} সাথে {_join(bits, 'আর')} ভালো যায়।" + ask
        if shape == "starter":
            return f"{poss} পর মেইন কোর্সে {_join(g['main'], 'বা')} নিতে পারেন।" + ask
        return ""
    if shape == "curry_bhaat":
        s = f"{g['rice'][0]} goes best with the {d}" if g.get("rice") else f"With the {d}"
        if g.get("side"):
            s += f", with {_join(g['side'], 'or')} on the side"
        return s + "." + ask
    if shape == "rice_dish":
        bits = []
        if g.get("drink"):
            bits.append(f"{_join(g['drink'], 'or')} to drink")
        if g.get("beside"):
            bits.append(f"{_join(g['beside'], 'or')} on the side")
        if g.get("after"):
            bits.append(f"{_join(g['after'], 'or')} after")
        return f"With the {d}: " + ", ".join(bits) + "." + ask
    if shape == "kebab":
        bits = []
        if g.get("bread"):
            bits.append(f"{_join(g['bread'], 'or')} to eat it with")
        if g.get("drink"):
            bits.append(f"a {g['drink'][0]} to drink")
        return f"With the {d}: " + " and ".join(bits) + "." + ask
    if shape in ("handheld", "main"):
        bits = (g.get("fries") or []) + (g.get("rice") or []) + (g.get("drink") or [])
        return f"{_join(bits, 'and')} go well with the {d}." + ask
    if shape == "starter":
        return f"After the {d}, for the main: {_join(g['main'], 'or')}." + ask
    return ""
