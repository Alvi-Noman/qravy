"""The upsell — ONE question per visit, about kinds, not dishes: after food is added, if the tray has no drink
(and/or no dessert after a real meal), the waiter asks "সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?" and lets the guest
lead. dish_roles() says what part of a meal a dish plays (drink, dessert, main…)."""
import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from recommender import dish_facts


def _kind_text(it: Dict[str, Any]) -> str:
    return " ".join(str(x or "") for x in (it.get("name"), it.get("category"))).lower()


# (the dish's NAME — "Sweet & Sour Chicken" is not a dessert)
_DESSERT = re.compile(
    r"dessert|\bsweets\b|ice ?cream|pudding|firni|phirni|kulfi|cake|brownie|pastry|halwa|jilapi|jalebi|rasmalai|"
    r"rosh?omalai|roshogolla|rasgulla|gulab|chom ?chom|kalojam|sandesh|laddu|ladoo|kacha golla|mishti|misti ?doi|\bdoi\b|"
    r"payesh|kheer|sundae|falooda|custard|mousse|cheesecake|waffle|donut|doughnut|tiramisu|panna ?cotta|souffle|"
    r"cookie|muffin|kunafa|kunafeh|baklava|umm ?ali|ডেজার্ট|মিষ্টি|দই|পায়েস|ফিরনি|কুলফি|আইসক্রিম|ফালুদা"
)
_DESSERT_CATEGORY = re.compile(r"^\s*(desserts?|sweets?|sweet dish(es)?|মিষ্টি|ডেজার্ট)\s*$|dessert", re.I)
_DRINK = re.compile(r"\b(shakes?|milkshake|lassi|juice|smoothie|mojito|lemonade|soda|cola|coke|pepsi|sprite|fanta|7 ?up|"
                    r"coffee|tea|cha|latte|cappuccino|espresso|americano|mocha|frappe|mocktail|borhani|matha)\b")
# held in the hand — a burger, a pizza, a kathi roll (not a spring roll / sushi roll)
_HANDHELD = re.compile(r"burger|pizza|sandwich|\bsub\b|\bwrap\b|shawarma|(kathi|chicken|beef|egg|paratha|kebab|kabab|shawarma) roll|"
                       r"hot ?dog|fried chicken|\bwings\b|broast|taco|burrito")
_SIDE = re.compile(r"fries|\bfry\b|wedges|\bchips\b|nugget|onion ring|coleslaw|mashed|potato|garlic bread")
_BREAD = re.compile(r"\bnaan\b|\bnan\b|paratha|porota|roti|ruti|chapati|kulcha|puri|luchi|pita|\bbread\b|\bbun\b")
# light bites / snacks: they don't make a meal, but nobody pushes a main dish on them either
_SNACK = re.compile(r"patt(y|ies)|puff|samosa|singara|\bchop\b|cutlet|pakora|piyaju|beguni|fuchka|phuchka|chotpoti|"
                    r"jhalmuri|momo|dumpling|dim ?sum|sushi|\broll\b|maki|nigiri|spring roll|toast|croissant|bun\b|"
                    r"hummus|\bsauce\b|dip\b")
# served with rice / bread: a curry, a gravy, a kebab — not a biryani, a mandi, a burger
_WITH_RICE = re.compile(r"curry|masala|korma|bhuna|kalia|rezala|jhol|\bdal\b|daal|kosha|dopiaza|jalfrezi|butter chicken|"
                        r"chili|chilli|manchurian|szechuan|szu|sweet ?& ?sour|oyster|cashew|gravy|kebab|kabab|tikka|"
                        r"shashlik|grill|tandoori|bhorta|vorta|bhaji|vaji|fish|snapper|prawn|shrimp|lobster|crab|\bdry\b|onion")
_WHOLE_MEAL = re.compile(r"mandi|kabsa|khichuri|khichdi|polao|pulao|tehari|thali|platter|combo|\bmeal\b|set menu|ramen|"
                         r"\bpho\b|bibimbap|pad thai|pad see|chow ?mein|chowmein|noodles?|pasta|spaghetti|lasagna")
_WATER = re.compile(r"\bwater\b")


def dish_roles(it: Dict[str, Any]) -> Dict[str, bool]:
    """What part of a meal this dish plays."""
    f = dish_facts(it)
    name = str(it.get("name") or "").lower()
    k = _kind_text(it)
    drink = f["drink"] or bool(_DRINK.search(name))
    dessert = not drink and (bool(_DESSERT.search(name)) or bool(_DESSERT_CATEGORY.search(str(it.get("category") or ""))))
    # ("Sides & Sweets": hummus and pita are not sweets)
    if dessert and (_BREAD.search(name) or _SNACK.search(name)) and not _DESSERT.search(name):
        dessert = False
    side = bool(_SIDE.search(name)) and not f["main"] and not drink
    handheld = bool(_HANDHELD.search(name)) and not side
    snack = bool(_SNACK.search(name)) and not handheld and not dessert and not drink
    whole = (bool(_WHOLE_MEAL.search(k)) or f["complete_meal"] or handheld
             or bool(re.search(r"\bwith\b", name) and (_BREAD.search(name) or f["rice"]))  # "Porota with Dal"
             ) and not re.search(r"soup|salad", name)
    combo = bool(re.search(r"\bwith\b|salad|soup", name))  # "Porota with Dal", "Glass Noodle Salad" — dishes of their own
    bread = bool(_BREAD.search(name)) and not handheld and not whole and not combo
    rice = (f["rice"] or bread) and not whole and not dessert and not combo
    course = (f["starter"] or f["soup"]) and not whole  # an appetizer / soup / salad on the menu
    main = not (course or drink or dessert or side or rice or snack) and (
        f["main"] or whole or bool(_WITH_RICE.search(k)) or bool(re.search(r"chicken|beef|mutton|lamb|duck|fish|prawn", name)))
    needs_rice = main and not whole and bool(_WITH_RICE.search(k))
    return {"dessert": dessert, "drink": drink, "side": side, "handheld": handheld, "rice": rice, "main": main,
            "needs_rice": needs_rice, "starter": course or side, "snack": snack}



def _name(it: Dict[str, Any]) -> str:
    return str(it.get("name") or "").strip()


# ---------------------------------------------------------------- ONE question, once per visit
# A real waiter asks once, about KINDS — "সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?" — and lets the guest lead
# ("ড্রিংকসের মধ্যে কী আছে?"). Never a chain of pitches, never two dishes pushed by name.

KIND_BN = {"drink": "ড্রিংকস", "dessert": "ডেজার্ট"}
KIND_EN = {"drink": "drinks", "dessert": "dessert"}


def missing_kinds(order: List[Dict[str, Any]], menu: List[Dict[str, Any]], orderable: Dict[str, bool],
                  item_id: Callable[[Dict[str, Any]], str], meal_kinds: Iterable[str] = ()) -> List[str]:
    """What to ask about: a drink if the tray has none, a dessert after real food — only kinds this menu can serve
    now. [] when nothing is missing (or the order is just a coffee / a dessert)."""
    if not order:
        return []
    have = [dish_roles(it) for it in order]
    if all(r["drink"] or r["dessert"] for r in have):
        return []
    served = [dish_roles(it) for it in menu if orderable.get(item_id(it), True)]
    out = []
    if not any(r["drink"] for r in have) and any(r["drink"] for r in served):
        out.append("drink")
    real_food = any(r["main"] or r["rice"] or r["handheld"] for r in have)
    if (real_food and not any(r["dessert"] for r in have) and any(r["dessert"] for r in served)
            and "breakfast" not in {str(k).lower() for k in meal_kinds}):
        out.append("dessert")
    return out


def question(kinds: List[str], lang: str) -> str:
    """"সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?" / "Would you like any drinks or dessert with that?"."""
    if not kinds:
        return ""
    if lang == "bn":
        return f"সাথে কি কোনো {' অথবা '.join(KIND_BN[k] for k in kinds)} নিবেন?"
    return f"Would you like any {' or '.join(KIND_EN[k] for k in kinds)} with that?"


_CLOSING_BN = re.compile(r"\s*আর কিছু (লাগবে|নেবেন)[^?।]*(নাকি|না কি)[^?।]*কনফার্ম[^?।]*\?\s*$")
_CLOSING_EN = re.compile(r"\s*Anything else,? or shall I confirm (your|the) order\?\s*$", re.I)


def ends_with_closing(reply: str) -> bool:
    return bool(_CLOSING_BN.search(reply or "") or _CLOSING_EN.search(reply or ""))


def swap_closing(reply: str, kinds: List[str], lang: str) -> str:
    """"…যোগ করলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" → "…যোগ করলাম। সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?"."""
    q = question(kinds, lang)
    if not q:
        return reply
    pat = _CLOSING_BN if _CLOSING_BN.search(reply or "") else _CLOSING_EN
    return (pat.sub("", reply or "").rstrip() + " " + q).strip()


def kind_items(kind: str, menu: List[Dict[str, Any]], orderable: Dict[str, bool],
               item_id: Callable[[Dict[str, Any]], str], blocked: Optional[Dict[str, Any]] = None,
               in_tray: Iterable[str] = (), limit: int = 6) -> List[Dict[str, Any]]:
    """The drinks / desserts to name: made here first (lassi, borhani, juice…), then the ready-made ones (water,
    Coke…), star-marked first within each, one of each name."""
    from recommender import is_packaged

    skip = set(in_tray) | set(blocked or {})
    items = [it for it in menu if orderable.get(item_id(it), True) and item_id(it) not in skip and dish_roles(it)[kind]]
    items.sort(key=lambda it: (is_packaged(it), not it.get("signature"), bool(re.search(r"\bwater\b", _name(it), re.I)),
                               float(it.get("price") or 0)))
    seen, out = set(), []
    for it in items:
        if _name(it).lower() not in seen:
            seen.add(_name(it).lower())
            out.append(it)
    return out[:limit]


def of_bn(word: str) -> str:
    """Bangla "of": "ড্রিংকস" → "ড্রিংকসের", "ঠান্ডা" → "ঠান্ডার" (after a vowel just "র")."""
    w = (word or "").strip()
    return w + ("র" if re.search(r"[aeiouািীুূৃেৈোৌঅআইঈউঊএঐওঔ]$", w) else "ের")


def listing(groups: List[Tuple[str, List[Dict[str, Any]]]], lang: str) -> str:
    """"ড্রিংকসের মধ্যে আছে Borhani, Mango Lassi অথবা Coca-Cola — কোনটা দেব?" — plain (no praise: some are
    ready-made), and the cards show them all."""
    bn = lang == "bn"
    parts = []
    for kind, items in groups:
        names = [_name(i) for i in items[:4]]
        if not names:
            continue
        joined = (", ".join(names[:-1]) + (" অথবা " if bn else " or ") + names[-1]) if len(names) > 1 else names[0]
        parts.append(f"{of_bn(KIND_BN[kind])} মধ্যে আছে {joined}" if bn else f"for {KIND_EN[kind]} we have {joined}")
    if not parts:
        return ""
    if bn:
        return "; ".join(parts) + " — কোনটা দেব?"
    text = "; ".join(parts)
    return text[0].upper() + text[1:] + " — which one would you like?"


# ---- the guest's answer to "সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?"
_ASKED = re.compile(r"সাথে কি কোনো .+ নিবেন\?|Would you like any .+ with that\?", re.I)
_DRINK_WORD = re.compile(r"ড্রিংক|ড্রিঙ্ক|পানীয়|পানীয়|ঠান্ডা|ঠাণ্ডা|কোল্ড|জুস|\b(drinks?|beverages?|cold|juice)\b", re.I)
_DESSERT_WORD = re.compile(r"ডেজার্ট|ডেসার্ট|মিষ্টি|মিস্টি|\b(desserts?|sweets?)\b", re.I)
_CONFIRM = re.compile(r"কনফার্ম|confirm|অর্ডার (দিয়ে|প্লেস)|place (it|the order|my order)|\bthat'?s (all|it)\b|আর কিছু (লাগবে )?না", re.I)
_NO = re.compile(r"^\s*(না|নাহ|না না|লাগবে না|না,? লাগবে না|না থাক|থাক|না ধন্যবাদ|দরকার নেই|no|nope|nah|no thanks?|"
                 r"no thank you|not now|i'?m good)\s*[.!।]*\s*$", re.I)


def asked_upsell(last_waiter_line: str) -> bool:
    return bool(_ASKED.search(last_waiter_line or ""))


def read_answer(text: str, asked: List[str], affirmative: bool, names_a_dish: bool) -> Tuple[str, List[str]]:
    """→ ("list", kinds) — show those (yes / "ড্রিংকস" / "ডেজার্টের মধ্যে কী আছে?"), ("no", []) — then "shall I confirm?",
    or ("", []) — not about the question (a dish named, a confirm, anything else: the usual flow)."""
    t = (text or "").strip()
    if not t or names_a_dish or _CONFIRM.search(t):
        return "", []
    said = [k for k, pat in (("drink", _DRINK_WORD), ("dessert", _DESSERT_WORD)) if pat.search(t)]
    if said and not re.search(r"^\s*(না|no)\b", t, re.I):
        return "list", said
    if _NO.search(t):
        return "no", []
    if affirmative:
        return "list", list(asked)
    return "", []
