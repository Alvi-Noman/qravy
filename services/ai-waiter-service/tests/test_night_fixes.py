"""The night batch (2026-10-21): whole conversations — changes to the tray said plainly, counts, payment and allergy
statements, set menus, Banglish, an open offer met with "অর্ডার করবো". Run: python -m pytest tests/test_night_fixes.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from waiter_knowledge import reply_language  # noqa: E402

TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}

MENU = [
    {"id": "cfr", "name": "Chicken Fried Rice", "price": 320, "category": "Rice"},
    {"id": "efr", "name": "Egg Fried Rice", "price": 300, "category": "Rice"},
    {"id": "cco", "name": "Chicken Chili Onion", "price": 380, "category": "Chicken"},
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers"},
    {"id": "coke", "name": "Coca-Cola", "price": 80, "category": "Drinks"},
    {"id": "sm1", "name": "Set Menu 1", "price": 420, "category": "Set Menu"},
    {"id": "sm2", "name": "Set Menu 2", "price": 420, "category": "Set Menu"},
    {"id": "sm3", "name": "Set Menu 3", "price": 420, "category": "Set Menu"},
]


def run(text, cart=(), state=None, history=None, items=MENU, at="Tue 20:30", periods=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(TURN)

    async def no_reading(*a, **k):
        return None

    rows = [{"itemId": i, "id": i, "quantity": q, "qty": q, "price": next(x["price"] for x in items if x["id"] == i)}
            for i, q in cart]
    orig = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        snap = {"items": items, **({"periods": periods} if periods else {})}
        out = asyncio.run(brain.generate_reply(text, menu_snapshot=snap, locale="bn", history=history or [],
                                               dialog_state=state, restaurant={"staffAlerts": False},
                                               context={"cartItems": rows, "table": "5", "localTime": at}))
    finally:
        brain._call_openai, brain._understand = orig
    return out, calls


def ops(out):
    return [(o.get("op"), o.get("itemId"), o.get("quantity")) for o in out["meta"].get("cartOps") or []]


def test_a_count_is_the_count_not_the_dishs_number():
    q = brain._said_quantity
    assert (q("সেট মেনু ১ দশটা দেন"), q("set menu 2 three please"), q("table 5 two cokes"), q("২টা বার্গার")) == (10, 3, 2, 2)


def test_take_out_swap_and_each_need_no_model():
    out, calls = run("কোক বাদ", cart=[("smash", 2), ("coke", 1)])
    assert not calls and ops(out) == [("remove", "coke", None)], (ops(out), out["replyText"])
    out, calls = run("ফ্রাইড রাইস টা এগ ফ্রাইড রাইস করে দেন", cart=[("cfr", 1), ("cco", 1)])
    assert not calls and ops(out) == [("remove", "cfr", None), ("add", "efr", 1)], ops(out)
    out, calls = run("দুইটা করে দেন", cart=[("cfr", 1), ("cco", 1)])
    assert not calls and sorted(ops(out)) == [("set", "cco", 2), ("set", "cfr", 2)], ops(out)


def test_all_of_those_adds_what_the_waiter_named():
    state = {"reco": {"turn": 2, "last_offered": ["cfr", "cco", "smash"], "last_offer_turn": 2}}
    hist = [{"role": "user", "content": "কি খাবো?"},
            {"role": "assistant", "content": "Chicken Fried Rice, Chicken Chili Onion আর Classic Smash Burger নিতে পারেন।"}]
    out, calls = run("ঠিক আছে ওগুলোই দেন", state=state, history=hist)
    assert not calls and sorted(ops(out)) == [("add", "cco", 1), ("add", "cfr", 1), ("add", "smash", 1)], ops(out)


def test_set_menus_are_a_kind():
    out, calls = run("সেট মেনু কি কি আছে?")
    assert not calls and out["meta"]["guards"] == ["kind_list"] and out["replyText"].startswith("সেট মেনুর মধ্যে আছে"), out["replyText"]


def test_payment_and_allergy_are_answered_honestly():
    out, calls = run("কার্ড নেন?")
    assert not calls and "নিশ্চিত বলতে পারছি না" in out["replyText"] and "হ্যাঁ" not in out["replyText"], out["replyText"]
    out, calls = run("আমার বাদামে এলার্জি আছে")
    assert not calls and out["replyText"].startswith("ঠিক আছে, আপনার বাদামে এলার্জি — মনে রাখলাম।"), out["replyText"]
    assert "nuts" in (out["meta"]["reco"]["profile"].get("allergies") or []), out["meta"]["reco"]["profile"]
    assert brain._no_free_claims("Butter Chicken-এ বাদাম থাকে না। আর কিছু জানতে চান?", "bn", True).startswith(
        "সেটা আমি নিশ্চিত বলতে পারছি না।")


def test_banglish_is_answered_in_bangla():
    assert [reply_language(t, "bn") for t in ("r kisu na", "shokaler khabare ki boal mach pabo?", "I want a burger")] == [
        "bn", "bn", "en"]
    assert brain._kind_word("bhai kacchi ache?", brain.MenuIndex([{"id": "k", "name": "Kacchi Biryani", "price": 1,
                                                                    "category": "Kacchi"}]), {"k"}) == "কাচ্চি"


BHAAT = [{"id": "bhat", "name": "সাদা ভাত", "price": 40, "category": "ভাত"},
         {"id": "rui", "name": "রুই মাছ (গ্লাসি)", "price": 220, "category": "মাছ"},
         {"id": "dal", "name": "ডাল", "price": 30, "category": "ভর্তা"},
         {"id": "paratha", "name": "Paratha", "price": 15, "category": "Breakfast"},
         {"id": "pdal", "name": "Porota with Dal", "price": 40, "category": "Breakfast"},
         {"id": "dim", "name": "Dim Bhaji", "price": 30, "category": "Breakfast"},
         {"id": "dudh", "name": "Dudh Cha", "price": 30, "category": "Tea"},
         {"id": "lal", "name": "Lal Cha", "price": 20, "category": "Tea"},
         {"id": "coffee", "name": "Coffee", "price": 30, "category": "Tea"}]


def test_the_total_is_the_trays_own_sum():
    out, calls = run("মোট কত হলো?", cart=[("bhat", 2), ("rui", 1)], items=BHAAT)
    assert not calls and out["replyText"].startswith("এখন পর্যন্ত মোট ৳300"), out["replyText"]
    out, calls = run("আর একটা ডাল দিলে কত হবে?", cart=[("bhat", 2), ("rui", 1)], items=BHAAT)
    assert not calls and out["replyText"].startswith("1টা ডাল ৳30 — তাহলে মোট হবে ৳330"), out["replyText"]
    out, calls = run("total 4 ta coke koren", cart=[("coke", 1)])  # an order, not the bill
    assert "এখন পর্যন্ত মোট" not in out["replyText"], out["replyText"]


def test_a_list_with_some_counts_is_an_order_and_tea_is_asked_which():
    out, calls = run("দুইটা পরোটা আর ডিম ভাজি", items=BHAAT)
    assert not calls and ops(out) == [("add", "paratha", 2), ("add", "dim", 1)], ops(out)
    out, calls = run("চা দেন", items=BHAAT)
    assert not calls and [o["label"] for o in out["meta"]["decision"]["chooseOptions"]] == ["Dudh Cha", "Lal Cha"], out["replyText"]


def test_a_size_the_dish_doesnt_have():
    out, calls = run("হাফ প্লেট ভাত হবে?", items=BHAAT)
    assert not calls and out["meta"]["guards"] == ["size_missing"] and "হাফ" in out["replyText"], out["replyText"]


def test_spellings_said_two_ways():
    juice = [{"id": "mj", "name": "Mango Juice", "price": 120, "category": "Juice"},
             {"id": "oj", "name": "Orange Juice", "price": 120, "category": "Juice"},
             {"id": "md", "name": "Chicken Mandi", "price": 250, "category": "Mandi"},
             {"id": "mm", "name": "Mutton Mandi", "price": 300, "category": "Mandi"}]
    out, calls = run("দুইটা ম্যাংগো জুস", items=juice)
    assert not calls and ops(out) == [("add", "mj", 2)], (ops(out), out["replyText"])
    out, calls = run("হাফ মান্দির দাম কত?", items=juice)  # (মান্দি / মান্ডি — one word)
    assert not calls and out["replyText"].startswith("হাফ সাইজ নেই"), out["replyText"]


def test_of_in_bangla():
    from upsell import of_bn
    assert [of_bn(w) for w in ("থাই", "পোলাও", "চা", "পিজ্জা", "বার্গার", "কফি")] == [
        "থাইয়ের", "পোলাওয়ের", "চায়ের", "পিজ্জার", "বার্গারের", "কফির"]


MORNING = [{"id": "dal", "name": "ডাল", "price": 30, "category": "ভোরের শহর"},
           {"id": "mug", "name": "মুগ ডাল", "price": 40, "category": "ভোরের শহর", "available": False,
            "unavailableReason": "আজ শেষ হয়ে গেছে"},
           {"id": "bdal", "name": "বুটের ডাল", "price": 40, "category": "ভোরের শহর"},
           {"id": "neh", "name": "গরুর নেহারি", "price": 180, "category": "ভোরের শহর"},
           {"id": "par", "name": "পরোটা", "price": 15, "category": "ভোরের শহর"},
           {"id": "cap", "name": "Cappuccino", "price": 150, "category": "Coffee"},
           {"id": "cha", "name": "দুধ চা", "price": 20, "category": "চা"},
           {"id": "soup", "name": "চিকেন সুপ", "price": 120, "category": "Soup"}]


def test_a_dal_thats_off_says_the_other_dals():
    for q in ("মুগ ডাল নেই?", "মুগ ডাল নাই?"):
        out, calls = run(q, items=MORNING)
        assert not calls and out["meta"]["guards"] == ["unavailable_named"], out["replyText"]
        assert out["replyText"].startswith("দুঃখিত, মুগ ডাল আজ শেষ হয়ে গেছে। তবে বুটের ডাল (৳40) বা ডাল (৳30)"), out["replyText"]
    out, calls = run("ডাল কি কি আছে?", items=MORNING)
    assert not calls and out["meta"]["guards"] == ["kind_list"] and "বুটের ডাল" in out["replyText"], out["replyText"]


def test_the_morning_is_dal_nehari_and_bread_not_tea():
    from waiter_knowledge import time_fit
    score = {i["id"]: time_fit(i, ["breakfast"])[1] for i in MORNING}
    assert min(score["neh"], score["par"], score["dal"]) > max(score["cap"], score["cha"], score["soup"]), score
    from bangla_meal import house_note
    rice = MORNING + [{"id": "bhat", "name": "সাদা ভাত", "price": 40, "category": "ভাত"},
                      {"id": "rui", "name": "রুই মাছ", "price": 220, "category": "মাছ"},
                      {"id": "ilish", "name": "ইলিশ মাছ ভুনা", "price": 320, "category": "মাছ"},
                      {"id": "gbhuna", "name": "গরুর মাংস ভুনা", "price": 260, "category": "মাংস"}]
    note = house_note(rice, rice, ["breakfast"])
    assert "breakfast now" in note and "পরোটা" in note and "Don't offer a rice meal" in note, note
    assert "rice-and-curry (ভাত)" in house_note(rice, rice, ["lunch"])


def test_a_misheard_what_can_i_eat_is_still_the_eat_ask():
    assert brain._EAT_ASK.search("এখন ঠিক হতে পারি।") and brain._EAT_ASK.search("এখানে কি হতে পারি?")


PERIODS = [{"id": "breakfast", "name": "Breakfast", "start": "07:00", "end": "11:00"},
           {"id": "lunch", "name": "Lunch", "start": "12:00", "end": "15:00"}]
GAP = [dict(BHAAT[0], periods=["lunch"], available=False), dict(BHAAT[1], periods=["lunch"], available=False),
       dict(BHAAT[3], periods=["breakfast"], available=False),
       {"id": "doi", "name": "সরা দই", "price": 80, "category": "মিষ্টি"},
       {"id": "pud", "name": "ডাবের পুডিং", "price": 120, "category": "মিষ্টি"},
       {"id": "cha", "name": "দুধ চা", "price": 30, "category": "চা"},
       {"id": "latte", "name": "আইসড লাটে", "price": 220, "category": "বারিস্তা কফি"}]


def test_between_two_meals_it_says_when_the_food_is():
    for q in ("এখন কি খেতে পারি?", "এখন ভালো কি আছে?", "এখন খিচতে পারি।"):
        out, calls = run(q, items=GAP, at="Tue 11:16", periods=PERIODS)
        assert not calls and out["meta"]["guards"] == ["period_between"], (q, out["replyText"])
        assert out["replyText"].startswith("সকালের নাস্তা শেষ হয়ে গেছে — দুপুরের খাবার শুরু হবে দুপুর ১২টায়"), out["replyText"]
        assert "দুধ চা" in out["replyText"] and "লাটে" not in out["replyText"], out["replyText"]
    out, calls = run("মিষ্টি কি আছে?", items=GAP, at="Tue 11:16", periods=PERIODS)  # a sweet asked for: the sweets
    assert out["meta"]["guards"] != ["period_between"], out["replyText"]


def test_fast_food_is_a_kind():
    cafe = [{"id": "cap", "name": "Cappuccino", "price": 220, "category": "Coffee"},
            {"id": "bur", "name": "Classic Beef Burger", "price": 350, "category": "Burgers"},
            {"id": "piz", "name": "Chicken Pizza", "price": 550, "category": "Pizza"},
            {"id": "fri", "name": "French Fries", "price": 150, "category": "Sides"},
            {"id": "pas", "name": "Alfredo Pasta", "price": 420, "category": "Pasta"},
            {"id": "bro", "name": "Brownie", "price": 180, "category": "Desserts"}]
    for q in ("ফাস্টফুড আইটেমে কী কী আছে?", "ফাস্ট ফুড কি আছে?", "fast food ki ache?"):
        out, calls = run(q, items=cafe)
        assert not calls and out["meta"]["guards"] == ["kind_list"], (q, out["replyText"])
        assert out["replyText"].startswith("ফাস্টফুডের মধ্যে আছে Classic Beef Burger, Chicken Pizza আর French Fries"), out["replyText"]
