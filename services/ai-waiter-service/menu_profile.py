"""What KIND of restaurant this is, and what it mostly serves — worked out once per menu from the dish names.

"কি কি আছে আপনাদের?" → a real waiter says: "আমাদের চাইনিজ আইটেম সব আছে — স্যুপ, ফ্রাইড রাইস, চাওমিন,
চিকেন-বিফ-প্রনের আইটেম, সিজলিং।" That line is not the menu's category names ("Beef Selection", "Rice & Noodles
Selection"); it is the cuisine plus the KINDS of dishes, the way people say them. Both come from the dishes themselves.
Covers the restaurants of Bangladesh: Chinese-Thai, kacchi houses, bhat-mach hotels, fast food, pizza, cafés, Indian,
kabab houses, Thai, Japanese/Korean, Arabian (mandi/shawarma), street food, sweet shops, bakeries, nashta, seafood,
juice bars and multi-cuisine family restaurants (tests/bd_menus.py).
"""

import re
from typing import Any, Dict, List, Optional, Tuple

# cuisine (key, Bangla, English) → words in dish names that give it away. Order breaks ties (earlier wins).
_CUISINES: List[Tuple[str, str, str, str]] = [
    ("chinese", "চাইনিজ", "Chinese",
     r"chow ?mein|chop ?suey|szechuan|szu.?chuan|schezwan|won ?ton|won ?thon|manchurian|cashew nut|oyster sauce|"
     r"sweet (and|&) sour|hot (and|&) sour|chill?i (chicken|beef|onion|prawn|dry)|dim ?sum|spring roll|kung ?pao|"
     r"black bean|sizzl|corn soup|thai soup|chinese|egg fried rice|chicken fried rice|mixed fried rice|masala (chicken|beef|prawn)"),
    ("thai", "থাই", "Thai",
     r"tom ?yum|pad ?thai|som ?tam|tom ?kha|basil|lemongrass|green curry|massaman|pad (see|kra)|glass noodle|"
     r"pineapple fried rice|panang"),
    ("japanese", "জাপানিজ", "Japanese",
     r"sushi|nigiri|maki\b|sashimi|california roll|dragon roll|ramen|udon|gyoza|edamame|miso|teriyaki|katsu|bento"),
    ("korean", "কোরিয়ান", "Korean", r"bibimbap|tteok|kimchi|bulgogi|korean|gochujang|japchae|ramyeon|kimbap"),
    ("bangla", "বাংলা", "Bangladeshi",
     r"bhuna|bhorta|vorta|kacchi|tehari|khichuri|\bdal\b|daal|\brui\b|ilish|hilsa|rezala|korma|polao|pulao|"
     r"shorshe|sorshe|jhol|bhaji|bhaja|chingri|morog|murgi|mezban|kalia|malaikari|pabda|shutki|nehari|halim|"
     r"beef curry|chicken curry|plain rice|\bbhat\b|jorda|borhani|luchi|porota"),
    ("indian", "ইন্ডিয়ান", "Indian",
     r"naan|\bnan\b|paneer|tandoor|butter chicken|dal makhani|vindaloo|kofta|palak|rogan|hyderabadi|jeera|"
     r"tikka masala|kulcha|\broti\b|dosa|chaat"),
    ("kabab", "কাবাব-গ্রিল", "kebab & grill",
     r"kabab|kebab|shashlik|tikka|\bgrill|bbq|barbecue|chaap|\bboti\b|reshmi|\bshik\b|seekh|tandoori chicken"),
    ("arabian", "অ্যারাবিয়ান", "Arabian",
     r"mandi|kabsa|shawarma|kunafa|baklava|hummus|falafel|shish|adana|tawook|pita|arabian|turkish|mezze|madhbi"),
    ("fast food", "ফাস্ট ফুড", "fast food",
     r"burger|pizza|sandwich|hot ?dog|nugget|french fr|wedges|fried chicken|wings|pasta|lasagn|spaghetti|garlic bread|"
     r"\bsub\b|double decker|strips"),
    ("seafood", "সি-ফুড", "seafood",
     r"seafood|crab|lobster|squid|calamari|snapper|coral|rupchanda|pomfret|tiger prawn|oyster\b(?! sauce)|mussel"),
    ("street food", "স্ট্রিট ফুড", "street food",
     r"fuchka|phuchka|chotpoti|puri\b|velpuri|singara|shingara|samosa|somucha|beguni|piyaju|chop\b|jhalmuri|momo"),
    ("sweets", "মিষ্টি", "sweets",
     r"roshogolla|rasgulla|chomchom|kalojam|rasmalai|roshmalai|sandesh|shondesh|golla|laddu|jilapi|jalebi|mishti|"
     r"\bdoi\b|barfi|gulab jamun|chanar"),
    ("bakery", "বেকারি", "bakery",
     r"cake|pastry|bread|\bbun\b|patties|puff|cookie|biscuit|croissant|muffin|donut|doughnut|toast"),
    ("cafe", "ক্যাফে", "café",
     r"coffee|\blatte\b|cappuccino|espresso|americano|\bmocha\b|frappe|flat white|macchiato"),
    ("juice", "জুস-শেক", "juice & shakes", r"juice|shake|lassi|smoothie|lemonade|mojito|falooda"),
]

# kinds of dishes, as guests say them (bn, en) → words in the dish name
_DISH_KINDS: List[Tuple[str, str, str]] = [
    ("স্যুপ", "soups", r"soup|tom ?yum|tom ?kha"),
    ("ফ্রাইড রাইস", "fried rice", r"fried rice"),
    ("চাওমিন", "chowmein", r"chow ?mein"),
    ("নুডলস", "noodles", r"noodle|pad ?thai|pad see|japchae"),
    ("সিজলিং", "sizzlers", r"sizzl"),
    ("বিরিয়ানি", "biryani", r"biry|kacchi"),
    ("তেহারি", "tehari", r"tehari"),
    ("পোলাও", "polao", r"polao|pulao|pilaf"),
    ("মান্ডি", "mandi", r"mandi|kabsa"),
    ("খিচুড়ি", "khichuri", r"khichuri"),
    ("ভর্তা", "bhorta", r"bhorta|vorta"),
    ("ভাজি", "bhaji", r"bhaji|vaji"),
    ("হালিম-নেহারি", "halim & nehari", r"halim|haleem|nehari|nihari|paya"),
    ("কারি", "curries", r"curry|masala|korma|rogan|rezala|makhani|kalia|malaikari|butter chicken"),
    ("কাবাব", "kebabs", r"kebab|kabab|tikka|shashlik|\bboti\b|chaap|tawook|\bshik\b|seekh"),
    ("গ্রিল", "grills", r"\bgrill|bbq|barbecue|tandoori chicken"),
    ("নান-পরোটা", "naan & paratha", r"naan|\bnan\b|paratha|porota|parota|\broti\b|luchi|kulcha|pita"),
    ("শাওয়ারমা", "shawarma", r"shawarma"),
    ("বার্গার", "burgers", r"burger|double decker"),
    ("পিজ্জা", "pizza", r"pizza"),
    ("স্যান্ডউইচ", "sandwiches", r"sandwich|\bsub\b|\bwrap\b|hot ?dog"),
    ("পাস্তা", "pasta", r"pasta|spaghetti|penne|lasagn|alfredo|bolognese"),
    ("ফ্রাইড চিকেন", "fried chicken", r"fried chicken|wings|nugget|chicken strips|chicken fry|broast"),
    ("সুশি", "sushi", r"sushi|nigiri|maki\b|sashimi|california roll|dragon roll"),
    ("রামেন", "ramen", r"ramen|ramyeon|udon"),
    ("ফুচকা-চটপটি", "fuchka & chotpoti", r"fuchka|phuchka|chotpoti|puri\b|velpuri"),
    ("সিঙ্গারা-সমুচা", "singara & samosa", r"singara|shingara|samosa|somucha"),
    ("ভাজাপোড়া", "fried snacks", r"beguni|piyaju|chop\b|pakora|pakoda"),
    ("মিষ্টি", "sweets", r"roshogolla|rasgulla|chomchom|kalojam|rasmalai|roshmalai|sandesh|shondesh|golla|laddu|jilapi|"
                         r"jalebi|barfi|gulab jamun"),
    ("দই", "doi", r"\bdoi\b|yogh?urt"),
    ("কেক-পেস্ট্রি", "cakes & pastries", r"cake|pastry|croissant|muffin|donut|doughnut"),
    ("পেটিস", "patties", r"patties|puff"),
    ("ব্রেড-বান", "breads & buns", r"\bbun\b|bread\b"),
    ("কুকিজ", "cookies", r"cookie|biscuit"),
    ("সালাদ", "salads", r"salad|som ?tam"),
    ("সেট মেনু", "set menus", r"set menu|combo|thali"),
    ("কফি", "coffee", r"coffee|\blatte\b|cappuccino|espresso|americano|\bmocha\b|frappe|flat white"),
    ("চা", "tea", r"\btea\b|\bcha\b|chai"),
    ("জুস", "juices", r"juice|smoothie|lemonade"),
    ("শেক", "shakes", r"shake|falooda"),
    ("লাচ্ছি", "lassi", r"lassi"),
    ("ডেজার্ট", "desserts", r"dessert|brownie|ice ?cream|pudding|firni|kulfi|payesh|halwa|kunafa|baklava|jorda|sundae"),
]

# the chicken / beef / prawn / fish … dishes are said as one group: "চিকেন-বিফ-প্রনের আইটেম" (in a Bangla
# restaurant, deshi words: "মাছ-মাংসের আইটেম" style — "মুরগি-মাছের")
_PROTEINS: List[Tuple[str, str, str, str]] = [
    ("চিকেন", "মুরগি", "chicken", r"chicken|murgh|morog|murgi"),
    ("বিফ", "গরু", "beef", r"beef|gosht|gorur"),
    ("মাটন", "খাসি", "mutton", r"mutton|lamb|khashi|khasi"),
    ("ফিশ", "মাছ", "fish", r"fish|snapper|pomfret|rupchanda|coral|ilish|hilsa|\brui\b|pabda|macher|koi\b|tilapia"),
    ("প্রন", "চিংড়ি", "prawn", r"prawn|shrimp|chingri"),
    ("ক্র্যাব", "কাঁকড়া", "crab", r"crab|kakra"),
    ("স্কুইড", "স্কুইড", "squid", r"squid|calamari"),
]

# a waiter names the main food first; sides, sweets and drinks only when they're what the place is about
_SIDES = {"সালাদ", "ডেজার্ট", "কফি", "চা", "জুস", "শেক", "লাচ্ছি", "দই", "কুকিজ"}

_CACHE: Dict[Any, Dict[str, Any]] = {}


def _text(it: Dict[str, Any]) -> str:
    return f"{it.get('name') or ''} {it.get('category') or ''}".lower()


def menu_glance(items: List[Dict[str, Any]], available: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """{"cuisine": [("chinese", "চাইনিজ", "Chinese")…], "kinds_bn": [...], "kinds_en": [...]} — cached per menu, so it
    is worked out once and again only when the menu (or what can be ordered) changes.
    Nothing here is a fixed list: a kind is named only when THIS menu has dishes of it. `available` = the dishes that
    can be ordered right now — the kinds come from those alone (all soups sold out today → no "স্যুপ"), while the
    cuisine comes from the whole menu (a Chinese place is still Chinese at breakfast)."""
    avail = items if available is None else available
    key = (tuple(sorted(_text(it) for it in items)), tuple(sorted(_text(it) for it in avail)))
    if key in _CACHE:
        return _CACHE[key]
    all_texts = [_text(it) for it in items]
    texts = [_text(it) for it in avail]
    names = [str(it.get("name") or "").lower() for it in avail]
    n = max(1, len(all_texts))

    # cuisine: how many dishes sound like it. The top one, plus others that are a real part of the menu (at least
    # half as many dishes) — a family restaurant is "চাইনিজ, ইন্ডিয়ান ও ফাস্ট ফুড"; a kabab house with two naans
    # is just "কাবাব-গ্রিল"
    scores = sorted(((sum(1 for t in all_texts if re.search(c[3], t)), -i, c) for i, c in enumerate(_CUISINES)),
                    key=lambda x: (-x[0], -x[1]))
    floor = max(3, 0.2 * n)
    top = scores[0][0] if scores else 0
    cuisine = [c[:3] for s, _, c in scores if s >= floor and s >= 0.5 * top][:3]

    # kinds of dishes, from the dish NAMES ("Rice & Noodles Selection" as a category doesn't make fried rice
    # "noodles"). Each dish is ONE kind — the word it ends on, as English names put the dish last: "BBQ Chicken
    # Pizza" is a pizza (not a grill), "Chicken Tikka Masala" a curry, "Won Thon Noodle Soup" a soup.
    # "Chicken Masala" / "Beef with Red Curry" at a Chinese place is a chicken / beef dish, not "curry" — curry is
    # its own kind only where curries are the food (Bangla, Indian, Thai)
    main_c = cuisine[0][0] if cuisine else ""
    skip = {i for i, k in enumerate(_DISH_KINDS) if k[0] == "কারি"} if main_c not in ("bangla", "indian", "thai") else set()
    tally = [0] * len(_DISH_KINDS)
    first_dish: Dict[int, str] = {}
    unkinded: List[str] = []
    for t, full in zip(names, texts):
        best, where = -1, -1
        for i, (_, _, pat) in enumerate(_DISH_KINDS):
            if i in skip:
                continue
            for m in re.finditer(pat, t):
                if m.end() > where:
                    best, where = i, m.end()
        if best >= 0:
            tally[best] += 1
            first_dish.setdefault(best, full)
        else:
            unkinded.append(full)
    counts = [(tally[i], i, bn, en) for i, (bn, en, _) in enumerate(_DISH_KINDS)]
    kinds = [(k, i, bn, en) for k, i, bn, en in counts if k >= 2]
    mains = sum(1 for k in kinds if k[2] not in _SIDES)
    want = 5 if len(cuisine) > 1 else 3
    if mains < want:  # a small or very mixed menu: one dish of a kind still says what we have (main food first)
        singles = [(k, i, bn, en) for k, i, bn, en in counts if k == 1 and bn not in _SIDES]
        # a family restaurant: something from EACH of its cuisines ("ফ্রাইড রাইস, পোলাও, বার্গার…")
        def which_cuisine(i: int) -> int:
            return next((ci for ci, c in enumerate(cuisine) for full in [first_dish[i]]
                         if re.search(next(x[3] for x in _CUISINES if x[0] == c[0]), full)), len(cuisine))
        order = sorted(singles, key=lambda s: which_cuisine(s[1]))
        picked, seen_c = [], set()
        for s in order:  # round-robin: the first dish kind of each cuisine, then the rest
            ci = which_cuisine(s[1])
            if ci not in seen_c:
                picked.append(s)
                seen_c.add(ci)
        picked += [s for s in order if s not in picked]
        kinds += picked[: want - mains]
    # a protein counts when it has its own dishes (chicken curries, beef dishes…), not a word in "Chicken Soup";
    # a Bangla or seafood restaurant says it in Bangla words ("মাছ-চিংড়ি-কাঁকড়ার আইটেম"). The three biggest,
    # said in the usual order (চিকেন-বিফ-প্রন, মাছ-চিংড়ি).
    deshi = main_c in ("bangla", "seafood")
    prot = [(sum(1 for t in unkinded if re.search(pat, t)), o, bn_d if deshi else bn, en)
            for o, (bn, bn_d, en, pat) in enumerate(_PROTEINS)]
    prot = sorted(sorted([p for p in prot if p[0] >= 2], key=lambda x: -x[0])[:3], key=lambda x: x[1])
    if prot and sum(p[0] for p in prot) >= 3:
        group = "-".join(p[2] for p in prot)
        kinds.append((sum(p[0] for p in prot), -1, group + ("র" if group.endswith(("ি", "া", "ু")) else "ের") + " আইটেম",
                      ", ".join(p[3] for p in prot) + " dishes"))
    # sides, sweets and drinks go after the main food — unless they ARE what the place is about (coffee at a café)
    own = {"cafe": {"কফি", "চা"}, "juice": {"জুস", "শেক", "লাচ্ছি"}, "sweets": {"মিষ্টি", "দই"}}.get(main_c, set())
    has_main = any(k[2] not in _SIDES for k in kinds)  # (read before sorting: a list is empty while it's being sorted)
    kinds.sort(key=lambda x: (x[2] not in own, has_main and x[2] in _SIDES and x[2] not in own, -x[0], x[1]))
    out = {"cuisine": cuisine, "kinds_bn": [k[2] for k in kinds[:5]], "kinds_en": [k[3] for k in kinds[:5]]}
    if len(_CACHE) > 50:
        _CACHE.clear()
    _CACHE[key] = out
    return out


# ------------------------------------------------------------------ the AI's reading of the menu (preferred)
#
# The word lists above are the fallback. The better answer comes from reading the menu like a waiter would: an AI
# call once per menu, in the background (the guest never waits for it), remembered until the menu changes. It
# names the cuisine and the kinds of dishes the way a Bangladeshi waiter says them, and ties every kind to the
# dishes it covers — so a kind whose dishes are all sold out is still left out, exactly as with the word lists.

_AI: Dict[Any, Dict[str, Any]] = {}  # menu signature → {"cuisine_bn", "cuisine_en", "kinds": [{bn, en, dishes}]}
_AI_BUSY: set = set()
_AI_FAILED: Dict[Any, float] = {}
AI_RETRY_S = 600

_AI_PROMPT = """You are an experienced restaurant waiter in Bangladesh. Read this restaurant's menu and describe it the way you would when a guest asks "কি কি আছে আপনাদের?" / "what do you have?".

Return JSON:
{"cuisine_bn": "...", "cuisine_en": "...", "kinds": [{"bn": "...", "en": "...", "dishes": [numbers]}]}

- cuisine: what kind of food this place serves, as a waiter says it — e.g. "চাইনিজ" / "Chinese", "বাংলা" / "Bangladeshi", "চাইনিজ আর থাই" / "Chinese and Thai", "ফাস্ট ফুড" / "fast food", "কাবাব-গ্রিল", "মিষ্টি", "ক্যাফে". Empty strings if it is truly a mix of everything.
- kinds: the 4–6 KINDS OF DISHES a waiter would name, main food first, the way people say them in spoken Bangla and English — e.g. "স্যুপ", "ফ্রাইড রাইস", "চাওমিন", "সিজলিং", "চিকেন-বিফ-প্রনের আইটেম", "বিরিয়ানি", "ভর্তা", "মাছের আইটেম", "বার্গার", "কফি". These are NOT the menu's category names: never use words like "Selection", "Items", "Special", "Appetizer".
- Fried rice is "ফ্রাইড রাইস" (never "ভাত"); chowmein "চাওমিন" and noodles "নুডলস" are different.
- dishes: the numbers of EVERY dish on the menu that belongs to that kind. Only name a kind the menu really has.
- Sides, desserts and drinks only if they are what this place is about (coffee at a café)."""


def _sig(items: List[Dict[str, Any]]) -> Any:
    return tuple(sorted(_text(it) for it in items))


def ai_glance(items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return _AI.get(_sig(items))


def _clean_ai(raw: Dict[str, Any], n: int) -> Optional[Dict[str, Any]]:
    """Keep only what makes sense: real dish numbers, Bangla in Bangla script, no category filler."""
    kinds = []
    for k in raw.get("kinds") or []:
        bn, en = str(k.get("bn") or "").strip(), str(k.get("en") or "").strip()
        dishes = sorted({int(d) for d in (k.get("dishes") or []) if str(d).lstrip("-").isdigit() and 0 <= int(d) < n})
        if not bn or not dishes or not re.search(r"[ঀ-৿]", bn) or re.search(r"selection|সেলে|সিলে", f"{bn} {en}", re.I):
            continue
        kinds.append({"bn": bn, "en": en or bn, "dishes": dishes})
    if len(kinds) < 2:
        return None
    cbn = str(raw.get("cuisine_bn") or "").strip()
    return {"cuisine_bn": cbn if re.search(r"[ঀ-৿]", cbn) else "", "cuisine_en": str(raw.get("cuisine_en") or "").strip(),
            "kinds": kinds[:6]}


async def learn_menu(items: List[Dict[str, Any]], call) -> Optional[Dict[str, Any]]:
    """Ask the AI to read this menu (once). `call(messages) -> str` returns the model's JSON."""
    import json

    sig = _sig(items)
    if sig in _AI:
        return _AI[sig]
    lines = "\n".join(f"{i}. {it.get('name')} — {it.get('category') or ''}" for i, it in enumerate(items))
    raw = json.loads(await call([{"role": "system", "content": _AI_PROMPT}, {"role": "user", "content": "MENU:\n" + lines}]))
    got = _clean_ai(raw if isinstance(raw, dict) else {}, len(items))
    if got:
        if len(_AI) > 50:
            _AI.clear()
        _AI[sig] = got
    return got


def warm(items: List[Dict[str, Any]], call) -> None:
    """Start reading this menu in the background if we haven't yet (never blocks, never raises)."""
    import asyncio
    import time

    sig = _sig(items)
    if not items or sig in _AI or sig in _AI_BUSY or time.time() - _AI_FAILED.get(sig, 0) < AI_RETRY_S:
        return
    _AI_BUSY.add(sig)

    async def run() -> None:
        try:
            got = await learn_menu(items, call)
            print(f"[menu_profile] learned the menu: {got['cuisine_bn'] if got else None} · "
                  f"{[k['bn'] for k in got['kinds']] if got else 'no usable answer'}")
            if not got:
                _AI_FAILED[sig] = time.time()
        except Exception as e:  # the word lists keep working
            _AI_FAILED[sig] = time.time()
            print(f"[menu_profile] couldn't read the menu with AI ({e}); using the word lists")
        finally:
            _AI_BUSY.discard(sig)

    try:
        asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        _AI_BUSY.discard(sig)


def _from_ai(items: List[Dict[str, Any]], available: Optional[List[Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    got = ai_glance(items)
    if not got:
        return None
    can = {_text(it) for it in (items if available is None else available)}
    kinds = [k for k in got["kinds"] if any(_text(items[d]) in can for d in k["dishes"] if d < len(items))]
    if not kinds:
        return None
    return {"cuisine_bn": got["cuisine_bn"], "cuisine_en": got["cuisine_en"],
            "kinds_bn": [k["bn"] for k in kinds[:5]], "kinds_en": [k["en"] for k in kinds[:5]]}


def glance_parts(items: List[Dict[str, Any]], lang: str,
                 available: Optional[List[Dict[str, Any]]] = None) -> Tuple[str, List[str]]:
    """(cuisine, kinds of dishes) in the guest's language — "চাইনিজ", ["স্যুপ", "ফ্রাইড রাইস", …]. From the AI's
    reading of the menu when we have it, else from the word lists. Cuisine is "" for a mix of everything."""
    bn = lang == "bn"
    ai = _from_ai(items, available)
    if ai:
        return (ai["cuisine_bn"] if bn else ai["cuisine_en"]), (ai["kinds_bn"] if bn else ai["kinds_en"])
    g = menu_glance(items, available)
    labels = [c[1] if bn else c[2] for c in g["cuisine"]]
    joiner = " ও " if bn else " and "
    cuisine = (", ".join(labels[:-1]) + joiner + labels[-1]) if len(labels) > 1 else "".join(labels)
    return cuisine, list(g["kinds_bn"] if bn else g["kinds_en"])


def glance_line(items: List[Dict[str, Any]], lang: str, available: Optional[List[Dict[str, Any]]] = None) -> str:
    """The prompt fact: 'MENU AT A GLANCE: cuisine চাইনিজ · the kinds of dishes, most first: স্যুপ, ফ্রাইড রাইস, …'"""
    cuisine, kinds = glance_parts(items, lang, available)
    if not kinds:
        return ""
    return (f"MENU AT A GLANCE: cuisine {cuisine or '(mixed — say we have many kinds of food)'} · the kinds of dishes, "
            f"most first: {', '.join(kinds)}")


def overview_text(cuisine: str, kinds: List[str], dishes: List[str], lang: str) -> str:
    """The fixed answer to "কি কি আছে আপনাদের?" / "what do you have?":
    "আমাদের চাইনিজ আইটেম সব আছে — স্যুপ, ফ্রাইড রাইস, …। স্পেশাল কিছু খেতে চাইলে A, B অথবা C ট্রাই করতে পারেন।"
    `dishes` are the three on the cards (star-marked first, fitting the time of day)."""
    bn = lang == "bn"
    if bn:
        head = (f"আমাদের {cuisine} আইটেম সব আছে" if cuisine else "আমাদের অনেক রকম খাবার আছে") + \
               (f" — {', '.join(kinds)}।" if kinds else "।")
        if not dishes:
            return head + " কী খেতে চান, বলুন?"
        names = dishes[0] if len(dishes) == 1 else ", ".join(dishes[:-1]) + " অথবা " + dishes[-1]
        return f"{head} স্পেশাল কিছু খেতে চাইলে {names} ট্রাই করতে পারেন।"
    head = (f"We have all kinds of {cuisine} items" if cuisine else "We have lots of different items") + \
           (f" — {', '.join(kinds)}." if kinds else ".")
    if not dishes:
        return head + " What would you like?"
    names = dishes[0] if len(dishes) == 1 else ", ".join(dishes[:-1]) + " or " + dishes[-1]
    return f"{head} If you'd like something special, you could try {names}."
