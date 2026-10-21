"""
The menu questions a waiter answers from the menu itself — exactly, never guessed:

  what's instead      a dish that's off / not on the menu → dishes of the SAME kind (a biryani for a biryani, a burger
                      for a burger, a fish curry for a fish curry — never a bhorta for a সরষে ইলিশ, never Hot Wings
                      for a burger, never Fried Chicken for "chicken fried rice")
  price               "রুই মাছের দাম কত?", "কাচ্চির দাম কত?", "সবচেয়ে দামি কোনটা?", a dish we don't have
  not on the menu     "বিফ তেহারি দেন" → "বিফ তেহারি আমাদের মেনুতে নেই — কাছাকাছি হিসেবে বিফ পোলাও আছে" (it said
                      "আজকে পাওয়া যাচ্ছে না", as if it were sold out)
  categories          "কি কি ক্যাটাগরি আছে?" → the sections, the ones on later said so

Pure (no I/O): brain wires it in.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import bangla_meal
from recommender import dish_facts, is_packaged
from upsell import dish_roles
from waiter_knowledge import MenuIndex, _money, is_side, kind_text

# ------------------------------------------------------------------ what KIND of dish it is

FAMILIES: Sequence[Tuple[str, str]] = (
    ("rice_dish", r"biry?ani|kacchi|tehari|polao|pulao|khichuri|বিরিয়ানি|বিরিয়ানি|কাচ্চি|তেহারি|পোলাও|খিচুড়ি|খিচুড়ি"),
    ("fried_rice", r"fried rice|chow ?mein|noodle|pad thai|ফ্রাইড রাইস|চাওমিন|চাউমিন|নুডল"),
    ("kebab", r"kebab|kabab|tikka|\bshik\b|seekh|\bboti\b|chaap|\bchap\b|\bgrill|shashlik|reshmi|tandoori|"
              r"কাবাব|টিক্কা|গ্রিল|চাপ|শিক|বটি|রেশমি|তন্দুরি"),
    ("curry", r"curry|bhuna|masala|korma|rezala|jhol|kalia|dopiaza|do ?piaz|roast|vindaloo|malaikari|"
              r"ভুনা|মাসালা|কোরমা|রেজালা|ঝোল|কালিয়া|দোপেয়াজা|রোস্ট|কারি|মালাইকারি|ঝাল ফ্রাই"),
    ("fish", r"\bfish|ilish|hilsa|\brui\b|pomfret|rupchanda|snapper|prawn|shrimp|chingri|bhetki|koral|"
             r"মাছ|ইলিশ|রুই|চিংড়ি|চিংড়ি|রূপচাঁদা|বোয়াল|বোয়াল|পাবদা|কোরাল"),
    ("burger", r"burger|slider|বার্গার"),
    ("pizza", r"pizza|পিজ্জা|পিজা"),
    ("pasta", r"pasta|lasagna|spaghetti|alfredo|penne|পাস্তা"),
    ("handheld", r"shawarma|shwarma|\bwrap|\broll\b|sandwich|\bsub\b|hot ?dog|শর্মা|শাওয়ার্মা|র‍্যাপ|রোল|স্যান্ডউইচ"),
    ("fried_chicken", r"fried chicken|wings|nugget|tender|strips|broast|ফ্রাইড চিকেন|উইংস"),
    ("sizzling", r"sizzl|সিজলিং"),
    ("soup", r"soup|স্যুপ|সুপ"),
    ("salad", r"salad|সালাদ"),
    ("bread", r"\bnaan|\bnan\b|paratha|porota|\broti\b|luchi|kulcha|নান|পরোটা|রুটি|লুচি"),
    ("set", r"set menu|platter|combo|thali|সেট মেনু|প্লেটার|কম্বো|থালি"),
    ("dal", r"\bdal\b|\bdaal|\bdhal\b|ডাল"),
    ("breakfast", r"nehari|paya|haleem|halim|নেহারি|পায়া|হালিম"),
    ("snack", r"fries|wedges|onion ring|pakora|samosa|singara|chop\b|fuchka|chotpoti|ফুচকা|চটপটি|সিঙ্গারা|সমুচা|চপ"),
    ("dessert", r"dessert|firni|jorda|zarda|\bdoi\b|yogurt|pudding|brownie|cake|pastry|ice ?cream|sundae|kheer|payesh|"
                r"rasmalai|rosogolla|rasgulla|mishti|ফিরনি|জর্দা|দই|পুডিং|কেক|পায়েস|পায়েস|রসমালাই|রসগোল্লা|মিষ্টি"),
    # (word-bounded: "Classic" has "lassi" in it, "Chocolate" has "cola" — a Classic Smash Burger is no drink)
    ("yogurt_drink", r"\blassi|\bborhani|\bmatha\b|লাচ্ছি|লাস্সি|বোরহানি|মাঠা"),
    ("hot_drink", r"\btea\b|coffee|espresso|latte|cappuccino|americano|mocha|(?<![ঀ-৿])চা(?![ঀ-৿])|কফি"),
    ("drink", r"\bdrinks?\b|\bjuice|\blassi|\bborhani|lemonade|\blime\b|\bsoda\b|\bcola\b|coca|\bcoke\b|sprite|fanta|"
              r"7 ?up|\bshakes?\b|milkshake|smoothie|mojito|\bwater\b|জুস|লাচ্ছি|বোরহানি|লেবু|কোক|স্প্রাইট|শেক|পানি"),
)
_FAM_RE = [(name, re.compile(pat, re.I)) for name, pat in FAMILIES]
_GENERIC = {"chicken", "beef", "mutton", "fish", "prawn", "special", "spicy", "regular", "large", "small", "full", "half",
            "with", "and", "plain", "classic", "mixed", "mix", "house", "deshi", "দেশি", "স্পেশাল"}


def families_of_text(text: str) -> set:
    return {name for name, rx in _FAM_RE if rx.search(text or "")}


def families(it: Dict[str, Any]) -> set:
    """What kind of dish this is, by its own name (+ its Bangla words' meaning), and its category only when the name
    says nothing ("Set Menu 1" under "Set Menu")."""
    own = families_of_text(f"{it.get('name') or ''} {kind_text({'name': it.get('name')})}")
    return own or families_of_text(f"{it.get('category') or ''} {kind_text(it)}")

_DRINK_SECTION = re.compile(r"ঠাণ্ডা|ঠান্ডা|পানীয়|পানীয়|শরবত|জুস|ড্রিংক|drink|beverage|juice|shake|smoothie|mocktail|cooler", re.I)


def course(it: Dict[str, Any]) -> str:
    """The part of a meal it is — an alternative is always of the same course."""
    r = dish_roles(it)
    fam = families(it)
    if r["drink"] or fam & {"drink", "hot_drink", "yogurt_drink"} or is_packaged(it):
        return "drink"
    # a name that says nothing ("প্রকৃত আনারস") in a drinks section ("কলিজা ঠাণ্ডা", "Juices") is a drink
    if not fam and _DRINK_SECTION.search(str(it.get("category") or "")):
        return "drink"
    if r["dessert"] or "dessert" in fam:
        return "dessert"
    if "bread" in fam and not fam & {"curry", "kebab"}:
        return "bread"
    if bangla_meal.is_plain_rice(it) or bangla_meal.role(it) == "side" or is_side(it):
        return "side"
    if fam & {"soup", "salad", "snack"} and not fam & {"rice_dish", "curry", "kebab", "burger", "pizza"}:
        return "starter"
    return "main"


_PROTEINS = ("chicken", "beef", "mutton", "fish", "prawn/shrimp", "duck", "egg", "veg")


def _protein(it: Dict[str, Any]) -> str:
    return str(dish_facts(it).get("protein") or "")


# ------------------------------------------------------------------ what's instead

def alternatives(it: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool], skip: Iterable[str] = (),
                 ok: Callable[[Dict[str, Any]], bool] = lambda _x: True, limit: int = 2) -> List[Dict[str, Any]]:
    """Dishes that can stand in for `it`: the same course, and the same kind (family / category / protein) — scored,
    best first. [] when nothing is genuinely close (better "no" than a stupid substitute)."""
    skip = set(skip)
    want_course, fam, prot = course(it), families(it), _protein(it)
    cat = str(it.get("category") or "")
    price = float(it.get("price") or 0)
    name_toks = _words(bangla_meal.said_name(it))
    scored = []
    seen = {bangla_meal.said_name(it)}
    for d in index.items:
        did = index.item_id(d)
        if d is it or did in skip or not orderable.get(did, True) or d.get("hidden") or not ok(d):
            continue
        dfam = families(d)
        # a dal sold out: another dal, else a nehari — what goes on the same paratha (never a tea or a bhaji first)
        bread_curry = "dal" in fam and dfam & {"dal", "breakfast"}
        if course(d) != want_course and not bread_curry:
            continue
        s = 2.0 if bread_curry and "dal" not in dfam else 0.0
        if fam and dfam & fam:
            s += 3.0 + len(dfam & fam)
        elif fam and dfam and not dfam & fam:
            # a different kind of dish entirely (Fried Chicken for a fried rice): only the category can rescue it
            s -= 3.0
        if str(d.get("category") or "") == cat:
            s += 2.5
        if prot and prot == _protein(d):
            s += 1.5
        if bangla_meal.role(it) and bangla_meal.role(it) == bangla_meal.role(d):
            s += 1.0
        s += 0.5 * len(name_toks & _words(bangla_meal.said_name(d)))
        dp = float(d.get("price") or 0)
        if price and dp:
            s -= min(1.5, abs(dp - price) / max(price, 1.0) * 1.5)
        said = bangla_meal.said_name(d)
        if s >= 3.0 and said not in seen:
            seen.add(said)
            scored.append((s, index.position.get(did, 1 << 20), d))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [d for _s, _p, d in scored[:limit]]


def alternatives_for_words(text: str, index: MenuIndex, orderable: Dict[str, bool], ok: Callable[[Dict[str, Any]], bool],
                           limit: int = 2) -> List[Dict[str, Any]]:
    """For something the menu doesn't have, by what the guest's words say it is ("বিফ তেহারি" → a beef rice dish)."""
    fam = families_of_text(text)
    words = _words(text)
    prot = next((p for p in ("chicken", "beef", "mutton", "fish", "prawn") if re.search(
        {"chicken": r"chicken|চিকেন|মুরগি|মুরগী", "beef": r"beef|বিফ|গরু", "mutton": r"mutton|মাটন|খাসি",
         "fish": r"fish|মাছ", "prawn": r"prawn|shrimp|চিংড়ি|চিংড়ি|প্রন"}[p], text, re.I)), "")
    if not fam:
        return []  # no idea what kind of dish it is — never a guess
    scored = []
    seen = set()
    for d in index.items:
        did = index.item_id(d)
        if not orderable.get(did, True) or d.get("hidden") or not ok(d) or course(d) in ("side", "drink") and not fam & {"drink", "hot_drink", "yogurt_drink"}:
            continue
        dfam = families(d)
        if not dfam & fam:
            continue
        s = 3.0 + len(dfam & fam)
        if prot and (_protein(d).startswith(prot) or prot in str(d.get("name") or "").lower()):
            s += 2.0
        s += 0.5 * len(words & _words(bangla_meal.said_name(d)))
        said = bangla_meal.said_name(d)
        if said not in seen:
            seen.add(said)
            scored.append((s, index.position.get(did, 1 << 20), d))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [d for _s, _p, d in scored[:limit]]


def _words(text: str) -> set:
    return {w for w in re.findall(r"[a-z]+|[ঀ-৿]+", str(text or "").lower()) if w not in _GENERIC and len(w) > 1}


# ------------------------------------------------------------------ saying it

def join(names: List[str], word: str) -> str:
    names = [n for n in dict.fromkeys(names) if n]
    if not names:
        return ""
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {word} " + names[-1]


def price_of(it: Dict[str, Any]) -> str:
    """"৳220", or the sizes: "Full ৳380, Half ৳280"."""
    sizes = [v for v in it.get("variations") or [] if v.get("name") and v.get("price") is not None]
    if len(sizes) > 1:
        return ", ".join(f"{v['name']} {_money(v['price'])}" for v in sizes[:4])
    p = sizes[0]["price"] if sizes else it.get("price")
    return _money(p) if p is not None else ""


def lowest_price(it: Dict[str, Any]) -> float:
    ps = [float(v.get("price")) for v in it.get("variations") or [] if v.get("price") is not None]
    return min(ps) if ps else float(it.get("price") or 0)


def why_off(it: Dict[str, Any], lang: str) -> str:
    """The guest-facing reason a dish can't be ordered now, short ("আজ শেষ হয়ে গেছে", "সন্ধ্যা ৫টা থেকে পাওয়া যায়")."""
    r = str(it.get("unavailableReason") or "").strip().rstrip("।.")
    if lang == "bn":
        if not r or not re.search(r"[ঀ-৿]", r):
            return "এখন পাওয়া যাচ্ছে না"
        name = bangla_meal.said_name(it)
        r = r.replace(str(it.get("name") or ""), "").replace(name, "").strip(" ,—-")
        # ("ছ্যাঁকাখোর পাওয়া যায় বিকাল ৫টা–রাত ১০টা" is its section's hours: for the dish, just the hours)
        cat = str(it.get("category") or "").strip()
        if cat and r.startswith(cat + " ") and re.search(r"পাওয়া যায়|পাওয়া যায়", r):
            r = r[len(cat):].strip()
        return r if r else "এখন পাওয়া যাচ্ছে না"
    return r or "not available right now"


def off_line(it: Dict[str, Any], lang: str) -> str:
    """"সরষে ইলিশ আজ শেষ হয়ে গেছে" / "চিকেন শর্মা সন্ধ্যা থেকে পাওয়া যায়"."""
    name, why = bangla_meal.said_name(it), why_off(it, lang)
    if lang == "bn":
        if re.search(r"শেষ হয়ে গেছে|পাওয়া যায়|পাওয়া যাচ্ছে না|পাওয়া যাচ্ছে না|হয়, আজ নয়|বন্ধ", why):
            return f"{name} {why}"
        return f"{name} এখন পাওয়া যাচ্ছে না ({why})"
    return f"the {name} — {why}"


def instead_line(alts: List[Dict[str, Any]], lang: str, with_price: bool = False) -> str:
    """"তবে রূপসী রূপচাঁদা বা রুই মাছ আছে — দেব?" ("" when there's nothing close)."""
    if not alts:
        return ""
    names = [bangla_meal.said_name(a) + (f" ({price_of(a)})" if with_price else "") for a in alts]
    if lang == "bn":
        return f"তবে {join(names, 'বা')} আছে — {'দেব' if len(alts) == 1 else 'কোনটা দেব'}?"
    return f"We do have {join(names, 'or')} — {'shall I add it' if len(alts) == 1 else 'which one shall I add'}?"


def what_we_have(index: MenuIndex, orderable: Dict[str, bool], lang: str, limit: int = 4) -> str:
    """"আমাদের আছে বার্গার, ফ্রাইড চিকেন, সাইডস আর শেক" — the sections with something on now (menu order)."""
    cats: List[str] = []
    for it in sorted(index.items, key=lambda x: index.position.get(index.item_id(x), 1 << 20)):
        c = str(it.get("category") or "").strip()
        if c and c not in cats and orderable.get(index.item_id(it), True) and not it.get("hidden"):
            cats.append(c)
    cats = cats[:limit]
    if not cats:
        return ""
    return (f"আমাদের আছে {join(cats, 'আর')}" if lang == "bn" else f"We have {join(cats, 'and')}")


# ------------------------------------------------------------------ price

PRICE_Q = re.compile(
    r"দাম|কত টাকা|কতো টাকা|টাকা কত|কত দাম|price|cost|how much|\bdam\b|\bkoto taka\b|\btaka koto\b|"
    r"(?<![ঀ-৿])কত(?![ঀ-৿ক্ষ])\s*\??\s*$|(?<![ঀ-৿])কতো\s*\??\s*$|\bkoto\s*\??\s*$",
    re.I,
)
TOTAL_Q = re.compile(r"সব মিলিয়ে|সব মিলে|মোট|টোটাল|total|altogether|in all|বিল|bill|এর মধ্যে|within|budget|বাজেট", re.I)
CHEAPEST = re.compile(r"সবচেয়ে (কম দাম|কমদামি|কম দামি|সস্তা)|সবচেয়ে কম কত|কমদামি কোনটা|সস্তা কোনটা|cheapest|lowest price|"
                      r"least expensive|sobcheye kom dam", re.I)
DEAREST = re.compile(r"সবচেয়ে (বেশি দাম|বেশী দাম|দামি|দামী)|দামি কোনটা|দামী কোনটা|most expensive|priciest|highest price|"
                     r"sobcheye dami", re.I)
SUPERLATIVE_PRICE = re.compile(CHEAPEST.pattern + "|" + DEAREST.pattern, re.I)


def price_lines(items: List[Dict[str, Any]], lang: str) -> List[str]:
    out = []
    seen = set()
    for it in items:
        name = bangla_meal.said_name(it)
        if name in seen:
            continue
        seen.add(name)
        if len([v for v in it.get("variations") or [] if v.get("name")]) <= 1:
            # "Basmati Kacchi Biryani (Full)" / "(Half)" listed as two dishes: say them as sizes
            twins = [o for o in items if bangla_meal.said_name(o) == name]
            if len({price_of(o) for o in twins}) > 1:
                bits = []
                for o in twins:
                    size = re.search(r"\((.*?)\)", str(o.get("name") or ""))
                    bits.append(f"{size.group(1) if size else ''} {price_of(o)}".strip())
                out.append(f"{name} — {', '.join(bits)}")
                continue
        out.append(f"{name} {price_of(it)}")
    return out


def superlative(transcript: str, index: MenuIndex, orderable: Dict[str, bool], scope: Optional[set], lang: str
                ) -> Optional[Tuple[str, List[Dict[str, Any]]]]:
    """"সবচেয়ে দামি কোনটা?" / "সবচেয়ে কমদামি কি?" — over the dishes on now (a kind they named: within it; food only,
    never a bottle of water or a sauce, unless they asked about drinks)."""
    cheap = bool(CHEAPEST.search(transcript))
    pool = [it for it in index.items if orderable.get(index.item_id(it), True) and not it.get("hidden")
            and (not scope or index.item_id(it) in scope)]
    if not scope:
        pool = [it for it in pool if course(it) in ("main", "starter")]
    else:  # (within the dishes shown, still a dish — not the সাদা ভাত card beside them)
        pool = [it for it in pool if course(it) in ("main", "starter")] or pool
    pool = [it for it in pool if lowest_price(it) > 0]
    if not pool:
        return None
    pool.sort(key=lowest_price, reverse=not cheap)
    top = pool[:2] if len(pool) > 1 and lowest_price(pool[0]) == lowest_price(pool[1]) else pool[:1]
    names = [f"{bangla_meal.said_name(t)} ({price_of(t)})" for t in top]
    if lang == "bn":
        what = "সবচেয়ে কম দামের" if cheap else "সবচেয়ে দামি"
        return f"{what} হলো {join(names, 'আর')}। দেব?", top
    what = "The most affordable" if cheap else "The most expensive"
    return f"{what} is {join(names, 'and')}. Shall I add it?", top


# ------------------------------------------------------------------ categories

CATEGORY_Q = re.compile(
    r"ক্যাটাগরি|ক্যাটেগরি|ক্যাটাগরী|সেকশন|সেক্শন|বিভাগ|কি কি (ধরনের|ধরণের|রকমের|টাইপের) (খাবার|আইটেম)|"
    r"(কী|কি) (ধরনের|ধরণের|রকমের) খাবার|\bcategor|\bsections?\b|what kinds? of (food|dishes)|what types? of food",
    re.I,
)


def categories_reply(index: MenuIndex, orderable: Dict[str, bool], lang: str) -> Optional[Tuple[str, List[Dict[str, Any]]]]:
    """"আমাদের মেনুতে আছে: কলিজা ঠাণ্ডা, …। ছ্যাঁকাখোর পাওয়া যায় সন্ধ্যা থেকে। কোনটা দেখবেন?" — the sections in menu
    order: the ones with something on now, and the ones on later said apart (never called "unavailable")."""
    bn = lang == "bn"
    order: List[str] = []
    on: Dict[str, bool] = {}
    later_why: Dict[str, str] = {}
    for it in sorted(index.items, key=lambda x: index.position.get(index.item_id(x), 1 << 20)):
        c = str(it.get("category") or "").strip()
        if not c or it.get("hidden"):
            continue
        if c not in order:
            order.append(c)
        if orderable.get(index.item_id(it), True):
            on[c] = True
        elif c not in later_why and not re.search(r"শেষ হয়ে গেছে|sold out", str(it.get("unavailableReason") or ""), re.I):
            later_why[c] = why_off(it, lang)
    now = [c for c in order if on.get(c)]
    later = [c for c in order if not on.get(c) and c in later_why]
    if not now and not later:
        return None
    if bn:
        text = f"আমাদের মেনুতে আছে {join(now, 'আর')}।" if now else ""
        if later:
            text += " " + " ".join(f"{c} {later_why[c]}।" if re.search(r"পাওয়া যায়|পাওয়া যায়", later_why[c])
                                   else f"{c} পরে পাওয়া যাবে।" for c in later[:3])
        return (text + " কোন সেকশনটা দেখবেন?").strip(), []
    text = f"Our menu has {join(now, 'and')}." if now else ""
    if later:
        text += " " + " ".join(f"{c}: {later_why[c]}." for c in later[:3])
    return (text + " Which section would you like?").strip(), []
