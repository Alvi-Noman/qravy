"""The owner's list of bad answers (2026-11-04), each kept fixed — run: python -m pytest tests/test_owner_cases.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability  # noqa: E402
import brain  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

MENU = MenuIndex([
    {"id": "r1", "name": "সাদা ভাত", "category": "ভাত", "price": 40},
    {"id": "r2", "name": "সুগন্ধি ভাত (নাজিরশাইল)", "category": "ভাত", "price": 60},
    {"id": "f1", "name": "ছোট মাছ (ভুনা)", "category": "মাছ", "price": 150},
    {"id": "f2", "name": "সরষে ইলিশ", "category": "মাছ", "price": 350},
    {"id": "f3", "name": "রুই মাছ", "category": "মাছ", "price": 220},
    {"id": "c1", "name": "দেশি মুরগির ঝোল", "category": "কারি", "price": 300},
    {"id": "c2", "name": "চিকেন ঝাল ফ্রাই", "category": "কারি", "price": 180},
    {"id": "m1", "name": "গরুর কালা ভুনা", "category": "কারি", "price": 350},
    {"id": "m2", "name": "গরুর লাল ভুনা", "category": "কারি", "price": 350},
    {"id": "b1", "name": "বেগুন ভর্তা", "category": "ভর্তা", "price": 40},
    {"id": "b2", "name": "আলু ভর্তা", "category": "ভর্তা", "price": 30},
    {"id": "b3", "name": "চিকেন ভর্তা", "category": "ভর্তা", "price": 100},
])
ON = {MENU.item_id(i): True for i in MENU.items}


def test_just_bhaat_is_the_plain_white_rice():
    # "একটা ভাত দাও আর একটা ছোট মাছ দাও" added সুগন্ধি ভাত (৳60) while সাদা ভাত (৳40) was there
    raw = [{"op": "add", "item": MENU.ref(MENU.by_id["r2"]), "quantity": 1, "variant": "", "note": "", "choices": []}]
    t = "একটা ভাত দাও আর একটা ছোট মাছ দাও।"
    assert [o["itemId"] for o in brain._validate_ops(raw, MENU, {}, ON, t, t)[0]] == ["r1"]
    t = "একটা সুগন্ধি ভাত দাও"
    assert [o["itemId"] for o in brain._validate_ops(raw, MENU, {}, ON, t, t)[0]] == ["r2"]


def test_a_dish_name_comes_from_one_part_of_the_order():
    # "একটা ভর্তা আর একটা দেশি মুরগির ঝোল দাও" became চিকেন ভর্তা (মুরগির + ভর্তা from two dishes)
    named = [i["id"] for i in brain._dishes_named("একটা ভর্তা আর একটা দেশি মুরগির ঝোল দাও।", MENU, limit=4)]
    assert named == ["c1"]


def test_x_except_what_else():
    # "ইলিশ বাদে আর কিছু নেই?", "সুগন্ধি ভাত না, অন্য ভাত আছে?" were never understood
    fact = brain._excluding_fact("সুগন্ধি ভাত না, অন্য ভাত আছে?", MENU, ON)[0]
    assert "সাদা ভাত" in fact.split("on now:")[1] and "সুগন্ধি" not in fact.split("on now:")[1]
    fact = brain._excluding_fact("ইলিশ বাদে আর কিছু নেই?", MENU, ON)[0]
    assert "রুই মাছ" in fact.split("on now:")[1] and "ভর্তা" not in fact.split("on now:")[1]
    fact = brain._excluding_fact("গরুর কালা ভুনা ছাড়া আর কি আছে?", MENU, ON)[0]
    assert fact.split("on now:")[1].strip(" .") == "গরুর লাল ভুনা"
    assert brain._excluding_fact("না থাক", MENU, ON) == []


def test_what_goes_with_it_is_not_do_you_have_it():
    # "চা সাথে কি খেতে পারি?" got "জি, ষোল আনা স্পেশাল চা আছে — দেব?"
    assert brain._WITH_WHAT.search("চা সাথে কি খেতে পারি?") and not brain._WITH_WHAT.search("চা আছে?")


def test_curries_said_by_fish_chicken_and_meat():
    # "তরকারির মধ্যে কি কি আছে?" got "here's our menu"
    ids = brain._kind_ids_in("তরকারির মধ্যে কি কি আছে?", MENU)
    assert {"f1", "c1", "m1"} <= ids and "b1" not in ids


def test_times_said_round():
    # "দুপুর ১২টা ২ মিনিট", "বিকাল ৫:০১" — the menu's 12:02 / 17:01 said the way people say them
    assert availability.format_windows([{"start": "12:02", "end": "17:00"}], "bn") == "দুপুর ১২টা–বিকাল ৫টা"
    assert availability.format_windows([{"start": "17:01", "end": "22:00"}], "en") == "5pm–10pm"
    assert availability._fmt_time_bn("15:30") == "বিকাল ৩:৩০"  # (a real half hour stays)


def test_the_evening_kebabs_lead_the_picks():
    # the owner's rule: at a rice house with kebabs, the kebabs lead while they're served (they never made the picks)
    import recommender
    ix = MenuIndex([{"id": "rice", "name": "সাদা ভাত", "category": "ভাত", "price": 40, "periods": ["lunch", "afternoon"]},
                    {"id": "fish", "name": "ছোট মাছ (ভুনা)", "category": "মাছ", "price": 150, "periods": ["lunch", "afternoon"]},
                    {"id": "curry", "name": "মাটন আলু ঝোল", "category": "কারি", "price": 280, "periods": ["lunch", "afternoon"]},
                    {"id": "k1", "name": "চিকেন গ্রিল", "category": "কাবাব", "price": 250, "periods": ["afternoon"]},
                    {"id": "k2", "name": "বিফ শিক কাবাব", "category": "কাবাব", "price": 300, "periods": ["afternoon"]},
                    {"id": "b1", "name": "আলু ভর্তা", "category": "ভর্তা", "price": 30, "periods": ["lunch", "afternoon"]}])
    picks, _ = recommender.rank(ix, {}, ["dinner"], recommender.GuestProfile(), limit=4)
    assert {p.item["id"] for p in picks[:2]} == {"k1", "k2"}


def test_from_9pm_the_rice_meal_leads_again():
    # the owner's rule: kebabs first in the evening, but from 9pm "এখন ভাত খেতে পারেন … আবার চাইলে কাবাব-নানও"
    import bangla_meal
    import recommender
    assert not bangla_meal.rice_time_again(20 * 60 + 50) and bangla_meal.rice_time_again(21 * 60 + 15)
    assert bangla_meal.rice_time_again(1 * 60) and not bangla_meal.rice_time_again(13 * 60)
    ix = MenuIndex([{"id": "rice", "name": "সাদা ভাত", "category": "ভাত", "price": 40, "periods": ["lunch", "afternoon"]},
                    {"id": "fish", "name": "ছোট মাছ (ভুনা)", "category": "মাছ", "price": 150, "periods": ["lunch", "afternoon"]},
                    {"id": "k1", "name": "চিকেন গ্রিল", "category": "কাবাব", "price": 250, "periods": ["afternoon"]},
                    {"id": "k2", "name": "বিফ শিক কাবাব", "category": "কাবাব", "price": 300, "periods": ["afternoon"]}])
    token = recommender.RICE_FIRST.set(True)
    try:
        picks, _ = recommender.rank(ix, {}, ["dinner"], recommender.GuestProfile(), limit=4)
    finally:
        recommender.RICE_FIRST.reset(token)
    assert picks[0].item["id"] not in ("k1", "k2")  # (the kebabs aren't pushed to the front after 9pm)


def test_the_morning_says_the_dals_on_their_own():
    # the owner's wording: "… আছে। সাথে বুটের ডাল আর মুগ ডালও আছে।" — only those on now; none → no dal sentence
    periods = [{"id": "breakfast", "name": "Breakfast", "start": "06:00", "end": "12:01"},
               {"id": "lunch", "name": "Lunch", "start": "12:02", "end": "17:00"}]
    ix = MenuIndex([{"id": "p", "name": "পরোটা", "category": "নাস্তা", "price": 15, "periods": ["breakfast"]},
                    {"id": "n", "name": "গরুর নেহারি", "category": "নাস্তা", "price": 250, "periods": ["breakfast"]},
                    {"id": "k", "name": "কলিজা ভুনা", "category": "নাস্তা", "price": 180, "periods": ["breakfast"]},
                    {"id": "d1", "name": "বুটের ডাল", "category": "নাস্তা", "price": 50, "periods": ["breakfast"]},
                    {"id": "d2", "name": "মুগ ডাল", "category": "নাস্তা", "price": 50, "periods": ["breakfast"]},
                    {"id": "r", "name": "সাদা ভাত", "category": "ভাত", "price": 40, "periods": ["lunch"]}])

    def said(off):
        on = {i["id"]: i["id"] not in off and i["id"] != "r" for i in ix.items}
        return brain._period_menu_reply("এখন কী খেতে পারি?", ix, on, periods, 9 * 60 + 30, set(), "bn")[0]

    assert "সাথে বুটের ডাল আর মুগ ডালও আছে" in said(set())
    assert "সাথে মুগ ডালও আছে" in said({"d1"}) and "বুটের" not in said({"d1"})
    assert "ডাল" not in said({"d1", "d2"}) and "নেহারি" in said({"d1", "d2"})


def test_a_kind_not_served_yet_is_on_the_menu_from_its_time():
    # "কাবাব আইটেমের মধ্যে কি কি আছে?" at 16:27 got "আমাদের মেনুতে কাবাব আইটেম নেই" (they start at 17:01)
    periods = [{"id": "lunch", "name": "Lunch", "start": "12:02", "end": "17:00"},
               {"id": "afternoon", "name": "Evening", "start": "17:01", "end": "22:00"}]
    ix = MenuIndex([{"id": "k1", "name": "বিফ শিক কাবাব", "category": "কাবাব", "periods": ["afternoon"]},
                    {"id": "k2", "name": "আফগানি কাবাব", "category": "কাবাব", "periods": ["afternoon"]}])
    fact = brain._later_today_fact({"k1", "k2"}, ix, {"k1": False, "k2": False}, periods, 16 * 60 + 27)
    assert fact and "5pm" in fact[0] and "never that the menu doesn't have them" in fact[0]
    assert brain._later_today_fact({"k1", "k2"}, ix, {"k1": True, "k2": True}, periods, 18 * 60) == []  # (on now)


def test_one_of_a_kind_in_an_order_is_asked_which():
    # "একটা ভর্তা আর একটা দেশি মুরগির ঝোল দাও" — the ঝোল added, the ভর্তা forgotten
    fact = brain._which_one_fact("একটা ভর্তা আর একটা দেশি মুরগির ঝোল দাও।", MENU, ON)
    assert len(fact) == 1 and "বেগুন ভর্তা" in fact[0] and "আলু ভর্তা" in fact[0] and "ঝোল" not in fact[0].split("(")[1]
    assert brain._which_one_fact("একটা ভাত দাও আর একটা ছোট মাছ দাও।", MENU, ON) == []  # (ভাত is the white rice)


def test_by_hand_categories_still_know_when_they_are_usually_served():
    # switched by hand, a kebab section had no hours at all — so the waiter couldn't say "from 5pm"
    import availability
    periods = [{"id": "lunch", "name": "Lunch", "start": "12:00", "end": "17:00"},
               {"id": "afternoon", "name": "Evening", "start": "17:00", "end": "22:00"}]
    rules = {"periods": periods, "categories": {"c": {"hours": [], "usualHours": [{"start": "17:00", "end": "22:00"}]}}}
    assert availability.served_periods({"categoryId": "c"}, rules) == ["afternoon"]
