"""
English → Bangla-script transliteration for what a Bangla-speaking guest sees and hears.

The brain works with exact English MENU names (its safety checks match them), so Bangla replies still
contain "Chicken Chili Onion". Right before a reply goes out, this turns every English word into the
way a Bangladeshi would say it in Bangla script — "চিকেন চিলি অনিয়ন" — so the text reads naturally and
the voice doesn't switch to an English accent. Deterministic and free (no model call).

  - a food-word dictionary (how Dhaka says it: প্রন, স্যুপ, কাচ্চি, বোরহানি …)
  - multi-word phrases first (French Fry → ফ্রেঞ্চ ফ্রাই, Won Thon → ওয়ান্টন)
  - single capital letters as letter names (Set Menu A-03 → সেট মেনু এ-03)
  - a phonetic fallback for words not in the dictionary, so no English ever slips through
  - "2 × Kacchi" → "2টা কাচ্চি" (nobody says "times")
Tokens with digits (table E1, A-03) keep their digits; prices stay ৳ + Western digits.
"""
from __future__ import annotations

import re
from typing import Dict, List

# ------------------------------------------------------------------ dictionary (lower-case keys)

WORDS: Dict[str, str] = {
    # proteins & mains
    "chicken": "চিকেন", "beef": "বিফ", "mutton": "মাটন", "lamb": "ল্যাম্ব", "fish": "ফিশ", "prawn": "প্রন",
    "prawns": "প্রন", "shrimp": "শ্রিম্প", "squid": "স্কুইড", "snapper": "স্ন্যাপার", "egg": "এগ", "eggs": "এগ",
    "duck": "ডাক", "crab": "ক্র্যাব", "lobster": "লবস্টার", "tofu": "টোফু", "paneer": "পনির", "mushroom": "মাশরুম",
    "mushrooms": "মাশরুম", "vegetable": "ভেজিটেবল", "vegetables": "ভেজিটেবল", "veg": "ভেজ", "corn": "কর্ন",
    "cashew": "কাজুবাদাম", "cashewnut": "কাজুবাদাম", "nut": "নাট", "nuts": "নাট", "wings": "উইংস", "wing": "উইং",
    "finger": "ফিঙ্গার", "fingers": "ফিঙ্গার", "nugget": "নাগেট", "nuggets": "নাগেটস", "drumstick": "ড্রামস্টিক",
    "sausage": "সসেজ", "cheese": "চিজ", "butter": "বাটার", "cream": "ক্রিম",
    # dishes
    "rice": "রাইস", "soup": "স্যুপ", "salad": "সালাদ", "curry": "কারি", "curries": "কারি", "noodle": "নুডলস",
    "noodles": "নুডলস", "chowmein": "চাওমিন", "chopsuey": "চপসুয়ে", "roll": "রোল", "rolls": "রোল",
    "ring": "রিং", "rings": "রিং", "sizzling": "সিজলিং", "sizzler": "সিজলার", "pakora": "পাকোড়া", "burger": "বার্গার",
    "pizza": "পিৎজা", "sandwich": "স্যান্ডউইচ", "pasta": "পাস্তা", "steak": "স্টেক", "wrap": "র‍্যাপ",
    "dumpling": "ডাম্পলিং", "dumplings": "ডাম্পলিং", "momo": "মোমো", "wonton": "ওয়ান্টন", "chips": "চিপস",
    "fries": "ফ্রাইজ", "cake": "কেক", "brownie": "ব্রাউনি", "pudding": "পুডিং", "platter": "প্লাটার",
    "combo": "কম্বো", "meal": "মিল", "set": "সেট", "menu": "মেনু", "thali": "থালি", "bowl": "বোল",
    # Bangladeshi dishes
    "kacchi": "কাচ্চি", "biryani": "বিরিয়ানি", "tehari": "তেহারি", "polao": "পোলাও", "khichuri": "খিচুড়ি",
    "bhuna": "ভুনা", "rezala": "রেজালা", "korma": "কোরমা", "roast": "রোস্ট", "kebab": "কাবাব", "kabab": "কাবাব",
    "seekh": "শিক", "reshmi": "রেশমি", "tikka": "টিক্কা", "tandoori": "তন্দুরি", "halim": "হালিম", "dal": "ডাল",
    "bhaji": "ভাজি", "bhorta": "ভর্তা", "beguni": "বেগুনি", "chop": "চপ", "samosa": "সমুচা", "singara": "সিঙ্গারা",
    "fuchka": "ফুচকা", "chotpoti": "চটপটি", "ilish": "ইলিশ", "chingri": "চিংড়ি", "shorshe": "সরষে",
    "malai": "মালাই", "naan": "নান", "paratha": "পরোটা", "porota": "পরোটা", "roti": "রুটি", "luchi": "লুচি",
    "firni": "ফিরনি", "doi": "দই", "mishti": "মিষ্টি", "rasmalai": "রসমালাই", "kulfi": "কুলফি", "jilapi": "জিলাপি",
    "borhani": "বোরহানি", "lassi": "লাচ্ছি", "jhal": "ঝাল", "naga": "নাগা", "omelette": "অমলেট", "omelet": "অমলেট",
    # drinks
    "water": "ওয়াটার", "mineral": "মিনারেল", "drink": "ড্রিংক", "drinks": "ড্রিংকস", "soft": "সফট", "soda": "সোডা",
    "coke": "কোক", "juice": "জুস", "tea": "চা", "coffee": "কফি", "lime": "লাইম", "lemon": "লেমন",
    "lemonade": "লেমোনেড", "mango": "ম্যাঙ্গো", "shake": "শেক", "milkshake": "মিল্কশেক", "smoothie": "স্মুদি",
    "mint": "মিন্ট", "orange": "অরেঞ্জ", "apple": "অ্যাপল", "chocolate": "চকলেট", "vanilla": "ভ্যানিলা",
    "strawberry": "স্ট্রবেরি", "latte": "লাতে", "cappuccino": "ক্যাপুচিনো", "espresso": "এসপ্রেসো",
    "americano": "আমেরিকানো", "mojito": "মোহিতো", "ice": "আইস", "iced": "আইসড", "cold": "কোল্ড", "glass": "গ্লাস",
    "bottle": "বোতল", "can": "ক্যান", "fruit": "ফ্রুট", "fresh": "ফ্রেশ",
    # styles, sauces, flavours
    "fried": "ফ্রাইড", "fry": "ফ্রাই", "grilled": "গ্রিলড", "grill": "গ্রিল", "bbq": "বারবিকিউ", "crispy": "ক্রিস্পি",
    "spicy": "স্পাইসি", "hot": "হট", "sweet": "সুইট", "sour": "সাওয়ার", "chili": "চিলি", "chilli": "চিলি",
    "garlic": "গার্লিক", "ginger": "জিঞ্জার", "onion": "অনিয়ন", "pepper": "পেপার", "lemongrass": "লেমনগ্রাস",
    "oyster": "অয়েস্টার", "sauce": "সস", "paste": "পেস্ট", "masala": "মাসালা", "green": "গ্রিন", "red": "রেড",
    "black": "ব্ল্যাক", "white": "হোয়াইট", "yellow": "ইয়েলো", "honey": "হানি", "cashewnuts": "কাজুবাদাম",
    "mixed": "মিক্সড", "mix": "মিক্স", "shredded": "শ্রেডেড", "thick": "থিক", "clear": "ক্লিয়ার", "whole": "হোল",
    "plain": "প্লেইন", "special": "স্পেশাল", "flaming": "ফ্লেমিং", "steamed": "স্টিমড", "boiled": "বয়েলড",
    "stir": "স্টার", "baked": "বেকড", "smoked": "স্মোকড", "creamy": "ক্রিমি", "cheesy": "চিজি", "classic": "ক্লাসিক",
    "deluxe": "ডিলাক্স", "double": "ডাবল", "single": "সিঙ্গেল", "jumbo": "জাম্বো", "mini": "মিনি",
    # cuisines & places
    "thai": "থাই", "chinese": "চাইনিজ", "mongolian": "মঙ্গোলিয়ান", "american": "আমেরিকান", "french": "ফ্রেঞ্চ",
    "indian": "ইন্ডিয়ান", "italian": "ইতালিয়ান", "mexican": "মেক্সিকান", "peking": "পিকিং", "szechuan": "সেচুয়ান",
    "schezwan": "সেজওয়ান", "szu": "সু", "chuan": "চুয়ান", "chian": "চিয়ান", "hyderabadi": "হায়দরাবাদি",
    "dhakai": "ঢাকাই", "old": "পুরান", "dhaka": "ঢাকা",
    # sizes & menu words
    "small": "স্মল", "medium": "মিডিয়াম", "large": "লার্জ", "regular": "রেগুলার", "half": "হাফ", "full": "ফুল",
    "quarter": "কোয়ার্টার", "piece": "পিস", "pieces": "পিস", "pcs": "পিস", "portion": "পোর্শন", "kids": "কিডস",
    "family": "ফ্যামিলি", "lunch": "লাঞ্চ", "dinner": "ডিনার", "breakfast": "ব্রেকফাস্ট",
    "choice": "চয়েস", "choose": "চুজ", "served": "সার্ভড", "with": "উইথ", "and": "অ্যান্ড", "of": "অফ", "in": "ইন",
    "on": "অন", "for": "ফর", "your": "ইয়োর", "the": "দ্য", "a": "এ", "vat": "ভ্যাট",
}

# phrases said as one unit (checked before single words)
PHRASES: Dict[str, str] = {
    "won thon": "ওয়ান্টন", "won ton": "ওয়ান্টন", "french fry": "ফ্রেঞ্চ ফ্রাই", "french fries": "ফ্রেঞ্চ ফ্রাই",
    "szu-chuan": "সেচুয়ান", "szu chuan": "সেচুয়ান", "szu-chian": "সেচুয়ান", "sweet & sour": "সুইট অ্যান্ড সাওয়ার",
    "sweet and sour": "সুইট অ্যান্ড সাওয়ার", "hot & sour": "হট অ্যান্ড সাওয়ার", "hot and sour": "হট অ্যান্ড সাওয়ার",
    "soft drinks": "সফট ড্রিংকস", "soft drink": "সফট ড্রিংক", "mineral water": "মিনারেল ওয়াটার",
    "cashew nut": "কাজুবাদাম", "ice cream": "আইসক্রিম", "set menu": "সেট মেনু", "spring roll": "স্প্রিং রোল",
    "mishti doi": "মিষ্টি দই", "seekh kebab": "শিক কাবাব",
}

LETTERS = {
    "a": "এ", "b": "বি", "c": "সি", "d": "ডি", "e": "ই", "f": "এফ", "g": "জি", "h": "এইচ", "i": "আই", "j": "জে",
    "k": "কে", "l": "এল", "m": "এম", "n": "এন", "o": "ও", "p": "পি", "q": "কিউ", "r": "আর", "s": "এস", "t": "টি",
    "u": "ইউ", "v": "ভি", "w": "ডাবলিউ", "x": "এক্স", "y": "ওয়াই", "z": "জেড",
}

# ------------------------------------------------------------------ phonetic fallback

_VOWEL_SIGN = [("ee", "ী"), ("oo", "ু"), ("oi", "ই"), ("ai", "াই"), ("ay", "ে"), ("ea", "ি"), ("ou", "াউ"), ("ow", "াও"),
               ("oa", "ো"), ("a", "া"), ("e", "ে"), ("i", "ি"), ("o", "ো"), ("u", "া"), ("y", "ি")]
_VOWEL_FULL = [("ee", "ঈ"), ("oo", "উ"), ("ai", "আই"), ("ay", "এ"), ("ea", "ই"), ("ou", "আউ"), ("ow", "আও"),
               ("oa", "ও"), ("a", "আ"), ("e", "এ"), ("i", "ই"), ("o", "ও"), ("u", "আ")]
_CONS = [("sh", "শ"), ("ch", "চ"), ("th", "থ"), ("ph", "ফ"), ("kh", "খ"), ("gh", "ঘ"), ("bh", "ভ"), ("dh", "ধ"),
         ("ck", "ক"), ("qu", "ক"), ("b", "ব"), ("c", "ক"), ("d", "ড"), ("f", "ফ"), ("g", "গ"),
         ("h", "হ"), ("j", "জ"), ("k", "ক"), ("l", "ল"), ("m", "ম"), ("n", "ন"), ("p", "প"), ("q", "ক"),
         ("r", "র"), ("s", "স"), ("t", "ট"), ("v", "ভ"), ("w", "ও"), ("x", "ক্স"), ("z", "জ")]
_VOWELS = set("aeiou")


def _phonetic(word: str) -> str:
    """Rough English → Bangla sounds for words the dictionary doesn't know (only a safety net)."""
    w = word.lower()
    w = re.sub(r"([bcdfghjklmnpqrstvwxz])\1", r"\1", w)  # "quesadilla" → quesadila
    if len(w) > 3 and w.endswith("e") and w[-2] not in _VOWELS:
        w = w[:-1]  # silent final e: "lime" → lim
    out: List[str] = []
    i = 0
    prev_cons = False
    while i < len(w):
        ch = w[i]
        nxt = w[i + 2] if i + 2 < len(w) else ""
        # "-er" before a consonant or at the end sounds "-ার" (tender → টেন্ডার, zinger → জিঙ্গার)
        if w.startswith("er", i) and nxt not in _VOWELS:
            out.append("ার" if prev_cons else "আর")
            i += 2
            prev_cons = False
            continue
        # "ng" + vowel → ঙ্গ (zinger), otherwise ং (spring)
        if w.startswith("ng", i):
            if nxt in _VOWELS:
                out.append("ঙ্গ")
                prev_cons = True
            else:
                out.append("ং")
                prev_cons = False
            i += 2
            continue
        # a "y" between vowels is য় (teriyaki → টেরিয়াকি)
        if ch == "y" and i > 0 and w[i - 1] in _VOWELS and i + 1 < len(w) and w[i + 1] in _VOWELS:
            out.append("য়")
            prev_cons = True
            i += 1
            continue
        if ch in _VOWELS or (ch == "y" and prev_cons):
            table = _VOWEL_SIGN if prev_cons else _VOWEL_FULL
            for k, v in table:
                if w.startswith(k, i):
                    out.append(v)
                    i += len(k)
                    break
            else:
                i += 1
            prev_cons = False
            continue
        if ch == "c" and i + 1 < len(w) and w[i + 1] in "eiy":
            glyph, step = "স", 1
        else:
            glyph, step = next(((v, len(k)) for k, v in _CONS if w.startswith(k, i)), ("", 1))
            if ch == "y":
                glyph, step = "ই", 1
        if glyph:
            if prev_cons and glyph not in ("ং",):
                out.append("্")  # consonant cluster: join with hasant
            out.append(glyph)
            prev_cons = glyph not in ("ই",)
        i += step
    return "".join(out) or word


# ------------------------------------------------------------------ public API

_LATIN_WORD = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]+(?:'[a-z]+)?(?![A-Za-z0-9])")
_QTY_TIMES = re.compile(r"(\d+)\s*[×x]\s*(?=\S)")
# menu codes like "A-01", "A -03", "এ-02" (Latin or already-Bangla letter)
_CODE = re.compile(r"(?<![A-Za-z0-9ঀ-৿])([A-Za-z]|এ|বি|সি|ডি|ই)\s*-\s*0*(\d{1,3})(?!\d)")
_BN_DIGIT_CHARS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
NUM_WORDS = {
    1: "এক", 2: "দুই", 3: "তিন", 4: "চার", 5: "পাঁচ", 6: "ছয়", 7: "সাত", 8: "আট", 9: "নয়", 10: "দশ",
    11: "এগারো", 12: "বারো", 13: "তেরো", 14: "চোদ্দ", 15: "পনেরো", 16: "ষোলো", 17: "সতেরো", 18: "আঠারো",
    19: "উনিশ", 20: "বিশ",
}


def _codes(text: str, spoken: bool, drop_code_letter: bool) -> str:
    """'Set Menu A-01' → 'সেট মেনু 1' (spoken: 'সেট মেনু এক') — never 'এ শূন্য এক'.
    The letter stays when the menu has several letters (A-01 vs B-01 would sound the same)."""
    def sub(m: re.Match) -> str:
        letter = m.group(1)
        letter = LETTERS.get(letter.lower(), letter) if re.match(r"[A-Za-z]", letter) else letter
        n = int(m.group(2))
        num = NUM_WORDS.get(n, str(n)) if spoken else str(n)
        if drop_code_letter:
            return num
        return f"{letter} {num}" if spoken else f"{letter}-{num}"

    return _CODE.sub(sub, text.translate(_BN_DIGIT_CHARS) if spoken else text)


# Bangla numbers 0–99 are irregular — a fixed table, never generated (the model wrote "পঁইশ" for 25)
_N99 = (
    "শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ "
    "বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আঠাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ "
    "ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ "
    "সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন ঊনষাট "
    "ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর সত্তর একাত্তর বাহাত্তর "
    "তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি আশি একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি "
    "সাতাশি অষ্টাশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই "
    "আটানব্বই নিরানব্বই"
).split()
assert len(_N99) == 100


def bn_number(n: int) -> str:
    """25 → পঁচিশ, 350 → তিনশো পঞ্চাশ, 1600 → এক হাজার ছয়শো, 125000 → এক লাখ পঁচিশ হাজার."""
    if n < 0:
        return "মাইনাস " + bn_number(-n)
    if n < 100:
        return _N99[n]
    parts: List[str] = []
    for unit, word in ((10_000_000, "কোটি"), (100_000, "লাখ"), (1000, "হাজার")):
        if n >= unit:
            parts.append(f"{bn_number(n // unit)} {word}")
            n %= unit
    if n >= 100:
        parts.append(f"{_N99[n // 100]}শো")
        n %= 100
    if n:
        parts.append(_N99[n])
    return " ".join(parts)


def _spoken_numbers(text: str) -> str:
    """Digits → correct Bangla words for the voice: 5% → পাঁচ শতাংশ, #17 → সতেরো নম্বর, 2টা → দুইটা."""
    def num(s: str) -> str:
        s = s.replace(",", "")
        whole = s.split(".")[0]
        return bn_number(int(whole)) if whole.isdigit() else s

    text = re.sub(r"\(\s*\+\s*", "(", text)  # "(+5% ভ্যাট)" — the voice shouldn't say "plus"
    text = re.sub(r"(\d[\d,]*(?:\.\d+)?)\s*%", lambda m: f"{num(m.group(1))} শতাংশ", text)
    text = re.sub(r"#\s*(\d+)", lambda m: f"{num(m.group(1))} নম্বর", text)
    # standalone numbers only — not codes glued to letters like "E1"
    return re.sub(r"(?<![A-Za-z0-9])(\d[\d,]*(?:\.\d+)?)(?![A-Za-z0-9])", lambda m: num(m.group(1)), text)


def _spoken_money(text: str) -> str:
    """For the voice: '৳320' / '৳চারশ' → '320 টাকা' / 'চারশ টাকা' (the ৳ sign isn't read well)."""
    return re.sub(r"৳\s*([0-9][0-9,]*(?:\.\d+)?|[ঀ-৿]+(?:\s[ঀ-৿]+)?)", r"\1 টাকা", text)


def word_to_bn(word: str) -> str:
    low = word.lower()
    if low in WORDS:
        return WORDS[low]
    if len(word) == 1:
        return LETTERS.get(low, word)
    if word.isupper() and len(word) <= 3:  # BBQ-like acronyms not in the dictionary: spell them
        return "".join(LETTERS.get(c.lower(), c) for c in word)
    return _phonetic(word)


def to_bangla_script(text: str, *, spoken: bool = False, drop_code_letter: bool = False) -> str:
    """Every English word in a Bangla reply → Bangla script; "2 × X" → "2টা X"; menu codes without the
    zero ("A-01" → "1"). `spoken` = the text for the voice ("৳320" → "320 টাকা", "এ-01" → "এক")."""
    if not text:
        return ""
    out = _QTY_TIMES.sub(r"\1টা ", text)
    out = _codes(out, spoken, drop_code_letter)
    out = out.replace(" & ", " অ্যান্ড ").replace("&amp;", "অ্যান্ড")
    if spoken:
        out = _spoken_numbers(_spoken_money(out))
    if not re.search(r"[A-Za-z]", out):
        return out
    # phrases first (longest first), case-insensitive, on word boundaries
    for phrase in sorted(PHRASES, key=len, reverse=True):
        out = re.sub(rf"(?<![A-Za-z]){re.escape(phrase)}(?![A-Za-z])", PHRASES[phrase], out, flags=re.I)
    return _LATIN_WORD.sub(lambda m: word_to_bn(m.group(0)), out)


__all__ = ["to_bangla_script", "word_to_bn", "WORDS", "PHRASES"]
