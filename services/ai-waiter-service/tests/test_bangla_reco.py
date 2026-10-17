"""A menu written in Bangla gets the same sensible picks as an English one — run: python -m pytest tests/test_bangla_reco.py

A guest asked "এখন খাওয়ার মতো ভালো কী আছে?" on an all-Bangla menu with no orders yet, and got the first five dishes of
the alphabet (আইর মাছ, আইসড আমেরিকানো, আট আনা ভর্তা, আদা লেবু লাচ্ছি, আফগানি কাবাব): the dish-kind checks only knew
English words, so every dish tied and the tie went to the name."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recommender import GuestProfile, dish_facts, rank  # noqa: E402
from waiter_knowledge import MenuIndex, is_dessert, is_side, kind_text, recommendation_pool, time_fit  # noqa: E402

_ROWS = [
    ("কফি", ["আইসড আমেরিকানো", "ক্যাপুচিনো", "মসলা চা"]),
    ("পানীয়", ["আদা লেবু লাচ্ছি 🌶", "মিন্ট লেমোনেড", "বোরহানি"]),
    ("ভর্তা", ["আট আনা ভর্তা মিক্সড 🌶🌶", "আলু ভর্তা", "শুটকি ভর্তা"]),
    ("মাছ", ["আইর মাছ", "সর্ষে ইলিশ", "রুই মাছের কালিয়া", "চিংড়ি মালাইকারি"]),
    ("মাংস", ["গরুর মাংস ভুনা", "খাসির রেজালা", "দেশি মুরগির ঝোল"]),
    ("কাবাব", ["আফগানি কাবাব", "চিকেন টিক্কা", "বিফ শিক কাবাব"]),
    ("ভাত ও পোলাও", ["সাদা ভাত", "কাচ্চি বিরিয়ানি", "মোরগ পোলাও", "ভুনা খিচুড়ি"]),
    ("নাস্তা", ["আলুর চপ", "সিঙ্গারা", "চিকেন রোল", "ডিম চপ"]),
    ("স্যুপ", ["থাই স্যুপ"]),
    ("ডেজার্ট", ["ফিরনি", "মিষ্টি দই"]),
]
MENU = [
    {"id": f"b{c}{n}", "name": name, "price": 100 + 10 * n, "category": cat}
    for c, (cat, names) in enumerate(_ROWS)
    for n, name in enumerate(names)
]
IDX = MenuIndex(MENU)
ORDERABLE = {it["id"]: True for it in MENU}
BY_NAME = {it["name"]: it for it in MENU}


def _names(picks):
    return [p.item["name"] for p in picks]


def test_bangla_dish_kinds():
    f = lambda n: dish_facts(BY_NAME[n])  # noqa: E731
    assert f("আইসড আমেরিকানো")["drink"] and f("আদা লেবু লাচ্ছি 🌶")["drink"] and f("মসলা চা")["drink"]
    assert f("গরুর মাংস ভুনা")["main"] and f("রুই মাছের কালিয়া")["main"] and f("আফগানি কাবাব")["main"]
    assert f("কাচ্চি বিরিয়ানি")["complete_meal"] and f("সাদা ভাত")["rice"]
    assert f("সিঙ্গারা")["starter"] and f("থাই স্যুপ")["soup"]
    assert is_side(BY_NAME["আট আনা ভর্তা মিক্সড 🌶🌶"]) and is_side(BY_NAME["আলু ভর্তা"])
    assert is_dessert(BY_NAME["ফিরনি"]) and not is_dessert(BY_NAME["গরুর মাংস ভুনা"])


def test_short_words_match_whole_words_only():
    assert "tea" in kind_text({"name": "মসলা চা"})
    assert "tea" not in kind_text({"name": "চাটনি"}) and "tea" not in kind_text({"name": "চাউমিন"})
    assert "soup" not in kind_text({"name": "সুপার বার্গার"})


def test_what_is_good_now_on_a_bangla_menu():
    for kinds in (["lunch"], ["afternoon"], ["dinner"]):
        picks, _ = rank(IDX, ORDERABLE, kinds, GuestProfile(), limit=5)
        names = _names(picks)
        # never the alphabet's first five
        assert names != ["আইর মাছ", "আইসড আমেরিকানো", "আট আনা ভর্তা মিক্সড 🌶🌶", "আদা লেবু লাচ্ছি 🌶", "আফগানি কাবাব"], kinds
        top3 = [BY_NAME[n] for n in names[:3]]
        assert not any(dish_facts(it)["drink"] or is_side(it) or is_dessert(it) for it in top3), (kinds, names)
        assert not any(is_side(BY_NAME[n]) for n in names), (kinds, names)
    # afternoon: snacks lead ("বিকেলের নাস্তায়"), dinner: mains / biryani
    aft, _ = rank(IDX, ORDERABLE, ["afternoon"], GuestProfile(), limit=5)
    assert dish_facts(aft[0].item)["starter"], _names(aft)
    din, _ = rank(IDX, ORDERABLE, ["dinner"], GuestProfile(), limit=5)
    assert all(dish_facts(p.item)["main"] or dish_facts(p.item)["complete_meal"] for p in din[:3]), _names(din)


def test_ties_keep_the_menu_order_not_the_alphabet():
    # five equally plain dishes: the restaurant's order wins
    menu = [{"id": f"x{i}", "name": n, "price": 200, "category": "Specials"} for i, n in enumerate(["Zinger", "Mango Bowl", "Apple Pie Plate"])]
    idx = MenuIndex(menu)
    picks, _ = rank(idx, {m["id"]: True for m in menu}, ["lunch"], GuestProfile(), limit=3)
    assert _names(picks) == ["Zinger", "Mango Bowl", "Apple Pie Plate"]


def test_recommendation_pool_skips_sides_first():
    pool, _, _ = recommendation_pool(IDX, ORDERABLE, ["dinner"], limit=6)
    assert not any(is_side(it) for it in pool[:4]), [it["name"] for it in pool]


def test_english_add_on_category_is_a_side_but_a_sauce_dish_is_not():
    assert is_side({"name": "BBQ Sauce", "category": "Add On"})
    assert not is_side({"name": "Beef Oyster Sauce", "category": "Beef"})
    assert time_fit({"name": "Beef Oyster Sauce", "category": "Beef"}, ["dinner"])[0]
