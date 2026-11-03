"""What the guest means — a named meal, a split-off ending, "which one?", "something light" (from real conversations).
Run: python -m pytest tests/test_guest_meaning.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import recommender  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

PERIODS = [{"id": "breakfast", "name": "Breakfast", "start": "06:00", "end": "12:01"},
           {"id": "lunch", "name": "Lunch", "start": "12:02", "end": "17:00"},
           {"id": "afternoon", "name": "Evening", "start": "17:01", "end": "22:00"},
           {"id": "dinner", "name": "Dinner", "start": "22:01", "end": "00:01"}]


def test_a_named_meal_is_the_restaurants_own_period():
    # "বিকেলের নাস্তা" at 16:25 got the lunch rice list (a fixed 16:30); this restaurant's afternoon starts at 17:01
    assert brain._when_said("তোমাদের বিকেলের নাস্তায় কি কি আছে?", PERIODS) == ("বিকেলে", 17 * 60 + 1)
    assert brain._when_said("সকালের খাবারে কি আছে?", PERIODS) == ("সকালে", 9 * 60)  # (inside its breakfast: kept)
    assert brain._when_said("বিকেলে কি আছে?", []) == ("বিকেলে", 16 * 60 + 30)  # no periods set: the usual time
    assert brain._when_said("কি আছে?", PERIODS) is None


def test_an_ending_split_off_by_speech_to_text():
    # "মাছ এর মধ্যে কি খাওয়া যেতে পারে?" after the desserts was answered with desserts
    ix = MenuIndex([{"id": "r", "name": "রুই মাছ", "category": "মাছ"}, {"id": "i", "name": "সরষে ইলিশ", "category": "মাছ"},
                    {"id": "p", "name": "ডাবের পুডিং", "category": "মিষ্টি"}])
    assert brain._kind_ids_in("মাছ এর মধ্যে কি খাওয়া যেতে পারে?", ix) == brain._kind_ids_in("মাছের মধ্যে কি খাওয়া যেতে পারে?", ix)
    assert "r" in brain._kind_ids_in("মাছ এর মধ্যে কি খাওয়া যেতে পারে?", ix)


def test_which_one_asked_is_not_an_order_of_one():
    # "…একটা ভর্তা দাও। কোন ভর্তা খাওয়া যেতে পারে?" added মাছ ভর্তা
    ix = MenuIndex([{"id": "m", "name": "মাছ ভর্তা"}, {"id": "a", "name": "আলু ভর্তা"}, {"id": "b", "name": "সাদা ভাত"}])
    t = "মাছের সাথে একটা ভাত দাও আর একটা ভর্তা দাও। কোন ভর্তা খাওয়া যেতে পারে?"
    assert brain._asks_which_of(t, ix.by_id["m"], ix) and not brain._asks_which_of(t, ix.by_id["b"], ix)
    assert not brain._asks_which_of("আলু ভর্তা আছে? থাকলে দাও", ix.by_id["a"], ix)  # names the dish: ordered


def test_something_light_is_never_wings_or_burgers():
    # at a burger place with fries and lemonade, "হালকা কিছু" got Hot Wings, a chicken burger and a cheese tower
    ix = MenuIndex([{"id": "b", "name": "Triple Cheese Tower", "category": "Burgers", "price": 590},
                    {"id": "w", "name": "Hot Wings", "category": "Chicken", "price": 320},
                    {"id": "f", "name": "Classic Fries", "category": "Sides", "price": 150},
                    {"id": "o", "name": "Onion Rings", "category": "Sides", "price": 200},
                    {"id": "l", "name": "Mint Lemonade", "category": "Shakes & Drinks", "price": 160}])
    prof = recommender.GuestProfile()
    prof.mood = ["light"]
    picks, _ = recommender.rank(ix, {}, ["dinner"], prof, limit=3)
    names = [p.item["name"] for p in picks]
    # (the light ones lead; a third pick may be the least heavy of the rest on a 5-dish menu — never the cheese tower)
    assert set(names[:2]) <= {"Classic Fries", "Onion Rings", "Mint Lemonade"} and "Triple Cheese Tower" not in names


def test_the_rice_is_not_turned_into_the_bhorta_asked_about():
    # the AI added the rice; "retarget to the guest's words" made it মাছ ভর্তা ("মাছের সাথে … ভর্তা")
    ix = MenuIndex([{"id": "m", "name": "মাছ ভর্তা"}, {"id": "a", "name": "আলু ভর্তা"}, {"id": "b", "name": "সাদা ভাত"}])
    t = "মাছের সাথে একটা ভাত দাও আর একটা ভর্তা দাও। কোন ভর্তা খাওয়া যেতে পারে?"
    ops = [{"op": "add", "itemId": "b", "name": "সাদা ভাত", "quantity": 1}]
    assert brain._reconcile_ops_with_words(ops, t, ix) == [] and ops[0]["itemId"] == "b"


def test_the_food_only_served_then_leads_the_answer():
    # "বিকেলের নাস্তায় কি আছে?" listed the fish (served lunch to night) — the kebabs are the afternoon's own section
    periods = PERIODS
    ix = MenuIndex([{"id": "k1", "name": "বিফ শিক কাবাব", "category": "ছ্যাঁকাখোর (বিকালের নাস্তা)", "periods": ["afternoon"], "price": 300},
                    {"id": "k2", "name": "আফগানি কাবাব", "category": "ছ্যাঁকাখোর (বিকালের নাস্তা)", "periods": ["afternoon"], "price": 320},
                    {"id": "f1", "name": "আইর মাছ", "category": "মাছ", "periods": ["lunch", "afternoon", "dinner"], "price": 280},
                    {"id": "f2", "name": "সরষে ইলিশ", "category": "মাছ", "periods": ["lunch", "afternoon", "dinner"], "price": 350},
                    {"id": "f3", "name": "রুই মাছ", "category": "মাছ", "periods": ["lunch", "afternoon", "dinner"], "price": 220}])
    on = {ix.item_id(i): True for i in ix.items}
    text = brain._period_menu_reply("তোমাদের বিকেলের নাস্তায় কি কি আছে?", ix, on, periods, 985, set(), "bn")[0]
    assert "কাবাব" in text and "ইলিশ" not in text
