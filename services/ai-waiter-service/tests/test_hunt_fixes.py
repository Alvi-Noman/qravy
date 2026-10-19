"""What a test run of everyday lines on a fast-food place, a Chinese-Thai restaurant and a Bengali rice house found
(2026-10-20): an allergy ignored, the time answer leaving out the all-day food, "চিকেনের কি কি আছে?" read as a dish,
"দুপুরে" read as a category, wrong kinds ("স্যুপের" set menus), closed hours, a milkshake as the spicy pick, breakfast
without its paratha first.  Run: python -m pytest tests/test_hunt_fixes.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability  # noqa: E402
import brain  # noqa: E402
from recommender import extract_prefs  # noqa: E402

PERIODS = [{k: p[k] for k in ("id", "name", "start", "end")} for p in availability.DEFAULT_PERIODS]
TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}

FAST = [
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers", "categoryId": "b"},
    {"id": "tower", "name": "Triple Cheese Tower", "price": 520, "category": "Burgers", "categoryId": "b"},
    {"id": "wings", "name": "Hot Wings", "price": 320, "category": "Chicken", "categoryId": "c"},
    {"id": "fried", "name": "Fried Chicken", "price": 280, "category": "Chicken", "categoryId": "c"},
    {"id": "fries", "name": "Classic Fries", "price": 150, "category": "Sides", "categoryId": "s"},
    {"id": "brownie", "name": "Chocolate Brownie", "price": 220, "category": "Desserts", "categoryId": "d",
     "periods": ["afternoon", "dinner"]},
    {"id": "sundae", "name": "Oreo Brownie Sundae", "price": 260, "category": "Desserts", "categoryId": "d",
     "periods": ["afternoon", "dinner"]},
    {"id": "shake", "name": "Oreo Milkshake", "price": 240, "category": "Shakes & Drinks", "categoryId": "x"},
]
CHINESE = [
    {"id": "cco", "name": "Chicken Chili Onion", "price": 380, "category": "Chicken", "categoryId": "c"},
    {"id": "bsz", "name": "Beef Sizzling", "price": 450, "category": "Beef", "categoryId": "b"},
    {"id": "efr", "name": "Egg Fried Rice", "price": 220, "category": "Rice", "categoryId": "r"},
    {"id": "tsp", "name": "Thai Soup", "price": 300, "category": "Soup", "categoryId": "s"},
    {"id": "set1", "name": "Set Menu-1 (Fried Rice, Chicken Fry, Soup)", "price": 390, "category": "Set Menu",
     "categoryId": "m", "periods": ["lunch"]},
    {"id": "set2", "name": "Set Menu-2 (Fried Rice, Chilli Chicken, Soup)", "price": 450, "category": "Set Menu",
     "categoryId": "m", "periods": ["lunch"]},
]
BANGLA = [
    {"id": "porota", "name": "পরোটা", "price": 15, "category": "ভোরের শহর", "categoryId": "o", "periods": ["breakfast"]},
    {"id": "dal", "name": "ডাল", "price": 30, "category": "ভোরের শহর", "categoryId": "o", "periods": ["breakfast"]},
    {"id": "nehari", "name": "পেয়ারি গরুর নেহারি", "price": 250, "category": "ভোরের শহর", "categoryId": "o",
     "periods": ["breakfast"]},
    {"id": "kacchi", "name": "মাটন কাচ্চি", "price": 400, "category": "দিন দুপুরে", "categoryId": "l"},
    {"id": "tikka", "name": "চিকেন টিক্কা", "price": 200, "category": "ছ্যাঁকাখোর", "categoryId": "k"},
    {"id": "jhal", "name": "চিকেন ঝাল ফ্রাই 🌶", "price": 260, "category": "কারির কাহিনী", "categoryId": "q"},
    {"id": "roast", "name": "মুরগির রোস্ট", "price": 280, "category": "কারির কাহিনী", "categoryId": "q"},
    {"id": "oreo", "name": "ওরিও ব্লাস্ট 🌶🌶🌶🌶", "price": 220, "category": "কলিজা ঠাণ্ডা", "categoryId": "z"},
    {"id": "coke", "name": "কোকা কোলা", "price": 25, "category": "কলিজা ঠাণ্ডা", "categoryId": "z"},
    {"id": "lassi", "name": "আদা লেবু লাচ্ছি 🌶", "price": 120, "category": "কলিজা ঠাণ্ডা", "categoryId": "z"},
]


def run(text, items, at="Tue 13:00", periods=PERIODS, restaurant=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(TURN)

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        minute = int(at[-5:-3]) * 60 + int(at[-2:])
        now = set(availability.periods_at(minute, {"periods": periods}))
        snap = [dict(it, available=False) if it.get("periods") is not None and not set(it["periods"]) & now else it
                for it in items]
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": snap, "periods": periods}, locale="bn",
                                               history=[], dialog_state=None, restaurant=restaurant or {"staffAlerts": False},
                                               context={"cartItems": [], "table": "5", "localTime": at}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


def cards(out):
    return {s["itemId"] for s in out["meta"].get("suggestions") or []}


def test_a_nut_allergy_without_the_word_allergy_goes_to_the_model():
    assert extract_prefs("আমি বাদাম খাই না, কি খেতে পারি?").allergies == ["nuts"]
    assert extract_prefs("no nuts please").allergies == ["nuts"]
    assert extract_prefs("চিংড়ি ছাড়া কি আছে?").allergies == ["shellfish"]
    assert not extract_prefs("তিলোত্তমা পাতলা নান খাই না").allergies  # (the তিল of a naan's name is no sesame)
    for items in (FAST, CHINESE, BANGLA):
        out, calls = run("আমি বাদাম খাই না, কি খেতে পারি?", items)
        assert calls, out["replyText"]  # never the plain list of specials


def test_chicken_question_is_no_dish_name():
    idx = brain.MenuIndex(BANGLA)
    assert not brain._dishes_named("চিকেনের কি কি আছে?", idx)
    assert [it["name"] for it in brain._dishes_named("একটা চিকেন টিক্কা দিন", idx)] == ["চিকেন টিক্কা"]
    out, _ = run("চিকেনের কি কি আছে?", BANGLA)
    assert "kind_list" in out["meta"]["guards"] and cards(out) >= {"jhal", "roast"}, out["replyText"]


def test_a_time_word_is_no_category():
    idx = brain.MenuIndex(BANGLA)
    assert not brain._kind_ids_in("দুপুরে কি পাওয়া যায়?", idx)  # (a category "দিন দুপুরে")
    out, _ = run("দুপুরে কি পাওয়া যায়?", BANGLA)
    assert "দুপুরের মধ্যে আছে" not in out["replyText"], out["replyText"]


def test_the_time_answer_keeps_the_all_day_food():
    # fast food, desserts only afternoon / dinner: at night the burgers are still there
    out, _ = run("এখন কি খাওয়া যেতে পারে?", FAST, at="Tue 20:00")
    t = out["replyText"]
    assert "তো আছেই" in t and "Classic Smash Burger" in t and "Chocolate Brownie" in t, t
    assert "ড্রিংকস" not in t.split("আর এখন")[-1], t
    assert {"smash", "brownie"} <= cards(out)
    # a Chinese place with set menus at lunch: the whole menu, and the set menus too — never "স্যুপের আইটেমগুলো"
    out, _ = run("দুপুরে কি পাওয়া যায়?", CHINESE, at="Tue 13:00")
    t = out["replyText"]
    assert "সেট মেনুও পাওয়া যায়" in t and "Chicken Chili Onion" in t and "স্যুপের" not in t, t


def test_closed_at_that_time_says_when_it_opens():
    opening = [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "12:00", "end": "23:00"}]
    out, calls = run("সকালে কি আছে?", CHINESE, restaurant={"staffAlerts": False, "opening": opening})
    assert not calls and out["replyText"] == "সকালে আমরা খোলা থাকি না — আমরা খুলি দুপুর ১২টায়।", out["replyText"]
    # open then → not this answer
    out, _ = run("রাতে কি আছে?", CHINESE, restaurant={"staffAlerts": False, "opening": opening})
    assert "খোলা থাকি না" not in out["replyText"]


def test_spicy_is_food_not_a_milkshake():
    out, _ = run("ঝাল কিছু আছে?", BANGLA)
    assert "ওরিও ব্লাস্ট" not in out["replyText"] and "oreo" not in cards(out), out["replyText"]


def test_never_a_promise_that_a_dish_is_free_of_the_allergen():
    model = {"replyText": "আপনি Hot Wings বা Chocolate Brownie নিতে পারেন। এগুলো বাদাম মুক্ত। কোনটা দেবো?"}
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **model})

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        out = asyncio.run(brain.generate_reply("আমি বাদাম খাই না, কি খেতে পারি?", menu_snapshot={"items": FAST},
                                               locale="bn", history=[], context={"cartItems": [], "table": "5"}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    t = out["replyText"]
    assert "বাদাম মুক্ত" not in t and "স্টাফকে" in t, t
    assert brain._no_free_claims("Feel free to ask — the Hot Wings are nut-free.", "en") == (
        "Please also let the staff know about the allergy so the kitchen can confirm.")


def test_i_know_what_to_order_just_listens():
    for said, want in (("আমি জানি কী অর্ডার করব", "জি, বলুন — কী দেব?"), ("I know what to order", "Sure — what would you like?")):
        out, calls = run(said, FAST)
        assert not calls and out["replyText"] == want and not cards(out), out["replyText"]
    # naming a dish in the same breath is an order
    out, _ = run("আমি জানি কী অর্ডার করব, একটা Hot Wings দিন", FAST)
    assert "knows_order" not in out["meta"]["guards"]


def test_breakfast_leads_with_paratha_and_dal():
    out, _ = run("সকালে কি পাওয়া যায়?", BANGLA, at="Tue 08:30")
    # a Bengali breakfast: the bread, and what it's eaten with
    assert out["replyText"].startswith("সকালে পরোটা খেতে পারেন — সাথে ডাল"), out["replyText"]
