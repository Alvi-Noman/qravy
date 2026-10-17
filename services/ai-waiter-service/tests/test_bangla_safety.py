"""Allergies, diets, spice and "what X do you have?" on a menu written in Bangla — run: python -m pytest tests/test_bangla_safety.py

The ingredient checks only knew English words: চিংড়ি মালাইকারি "contained" nothing, so a guest allergic to prawns could
be offered it, and গরুর মাংস ভুনা was fine for someone who doesn't eat beef. A drinks list called "কলিজা ঠাণ্ডা" read as
"this menu has no drinks"."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from recommender import allergy_guide, extract_prefs, rank  # noqa: E402
from waiter_knowledge import MenuIndex, item_hints, missing_kinds  # noqa: E402

_ROWS = [
    ("কারির কাহিনী", ["চিকেন ঝাল ফ্রাই 🌶", "গরুর লাল ভুনা", "মাটন দোপেয়াজা", "দেশি হাঁস ভুনা"]),
    ("মাছ মসাল বাঙালি", ["রুই মাছ (গ্রাসি)", "সরষে ইলিশ", "চিংড়ি ঝোল", "সাদা ভাত"]),
    ("ভর্তা ভাজির মাখামাখি", ["আলু ভর্তা", "বেগুন ভর্তা", "ডিম ভর্তা", "চিংড়ির ভর্তা", "শাক ভাজি", "ডাল"]),
    ("দিন দুপুরে", ["মাটন খিচুড়ি", "মিক্স চিকেন খিচুড়ি", "চিকেন বিরিয়ানি", "কাজুবাদাম পোলাও"]),
    ("কলিজা ঠাণ্ডা", ["আদা লেবু লাচ্ছি 🌶", "মাল্টার পিওর জুস", "ফ্রেশ লাইম 🌶", "ওরিও ব্লাস্ট 🌶🌶🌶🌶"]),
    ("মিষ্টি বিলাস", ["বগুড়ার বিখ্যাত সরা দই", "নূর-ই-কেশর ফিরনি"]),
]
MENU = [{"id": f"s{c}{n}", "name": name, "price": 150, "category": cat} for c, (cat, names) in enumerate(_ROWS) for n, name in enumerate(names)]
IDX = MenuIndex(MENU)
ORDERABLE = {it["id"]: True for it in MENU}
BY = {it["name"]: it for it in MENU}


def _contains(name):
    return set(item_hints(BY[name])["contains"])


def test_what_a_bangla_dish_contains():
    assert "prawn/shrimp" in _contains("চিংড়ি ঝোল") and "prawn/shrimp" in _contains("চিংড়ির ভর্তা")
    assert "beef" in _contains("গরুর লাল ভুনা") and "mutton" in _contains("মাটন দোপেয়াজা") and "duck" in _contains("দেশি হাঁস ভুনা")
    assert "fish" in _contains("সরষে ইলিশ") and "egg" in _contains("ডিম ভর্তা") and "nuts" in _contains("কাজুবাদাম পোলাও")
    assert "dairy" in _contains("বগুড়ার বিখ্যাত সরা দই") and "dairy" in _contains("আদা লেবু লাচ্ছি 🌶")
    assert item_hints(BY["আলু ভর্তা"])["diet"] == "likely vegetarian" and item_hints(BY["ডিম ভর্তা"])["diet"] == ""
    # ঝাল in the name is heat; 🌶 isn't (this menu puts it on an Oreo shake and a lime soda)
    assert item_hints(BY["চিকেন ঝাল ফ্রাই 🌶"])["heat"] in ("spicy", "likely spicy")
    assert item_hints(BY["ওরিও ব্লাস্ট 🌶🌶🌶🌶"])["heat"] == ""


def _picks(said):
    picks, _ = rank(IDX, ORDERABLE, ["lunch"], extract_prefs(said), limit=10)
    return [p.item["name"] for p in picks]


def test_guests_never_get_what_they_cant_have():
    assert not [n for n in _picks("আমার চিংড়িতে এলার্জি আছে") if "চিংড়ি" in n]
    assert not [n for n in _picks("আমি গরু খাই না") if "গরু" in n]
    veg = _picks("আমি নিরামিষ খাই")
    assert veg and not [n for n in veg if re.search("চিকেন|গরু|মাটন|হাঁস|মাছ|ইলিশ|চিংড়ি|ডিম", n)]
    assert "চিকেন ঝাল ফ্রাই 🌶" not in _picks("ঝাল কম খাই")
    assert not [n for n in _picks("দুধে এলার্জি") if re.search("দই|লাচ্ছি|ফিরনি", n)]
    assert allergy_guide(IDX, "shellfish", ORDERABLE)["count"] == 2


def test_a_dish_in_two_categories_is_one_pick():
    menu = MENU + [{"id": "dup", "name": "গরুর লাল ভুনা", "price": 150, "category": "ভোরের শহর"}]
    idx = MenuIndex(menu)
    picks, _ = rank(idx, {m["id"]: True for m in menu}, ["lunch"], extract_prefs(""), limit=10)
    names = [p.item["name"] for p in picks]
    assert len(names) == len(set(names))


def test_what_kinds_are_on_a_bangla_menu():
    names = lambda q: {IDX.by_id[i]["name"] for i in brain._kind_ids_in(q, IDX)}  # noqa: E731
    assert {"আদা লেবু লাচ্ছি 🌶", "মাল্টার পিওর জুস", "ফ্রেশ লাইম 🌶"} <= names("ড্রিংকস কী আছে?")
    assert {"আদা লেবু লাচ্ছি 🌶", "মাল্টার পিওর জুস"} <= names("ঠান্ডা কিছু আছে?")
    assert {"মাটন খিচুড়ি", "মিক্স চিকেন খিচুড়ি"} == names("খিচুড়ি কী কী আছে?")
    assert missing_kinds("ড্রিংকস আছে?", IDX) == [] and missing_kinds("বিয়ার আছে?", IDX) == ["alcohol"]
