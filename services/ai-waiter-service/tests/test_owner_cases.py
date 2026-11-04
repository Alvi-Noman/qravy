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


def test_the_ai_picking_one_of_a_kind_is_taken_out_and_asked():
    # the AI (told to ask) still added চিকেন ভর্তা for "একটা ভর্তা" — the code takes it out and asks which
    import asyncio
    import json
    said = "একটা ভর্তা আর একটা দেশি মুরগির ঝোল দাও।"
    add = lambda i: {"op": "add", "item": MENU.ref(MENU.by_id[i]), "quantity": 1, "variant": "", "note": "", "choices": []}

    def turn(ops, reply):
        async def fake(messages):
            return json.dumps({"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [],
                               "cartOps": ops, "clearCart": False, "confirmOrder": False, "checkout": "none",
                               "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [],
                               "replyText": reply})
        orig, brain._call_openai = brain._call_openai, fake
        try:
            return asyncio.run(brain.generate_reply(said, menu_snapshot={"items": MENU.items}, locale="bn",
                                                    context={"cartItems": [], "table": "3"}))
        finally:
            brain._call_openai = orig
    out = turn([add("b3"), add("c1")], "1টা চিকেন ভর্তা যোগ করলাম। 1টা দেশি মুরগির ঝোল যোগ করলাম।")
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["c1"], out["meta"]["cartOps"]
    assert "বেগুন ভর্তা" in out["replyText"] and "চিকেন ভর্তা যোগ" not in out["replyText"], out["replyText"]
    assert "kind_asked_which" in out["meta"]["guards"]
    # the AI asking it right is kept — the ভর্তা it lists answer the guest, they're no upsell to cut
    out = turn([add("c1")], "দেশি মুরগির ঝোল যোগ করলাম। ভর্তার জন্য বেগুন ভর্তা, আলু ভর্তা আর চিকেন ভর্তার মধ্যে কোনটা নিতে চান?")
    assert "কোনটা নিতে চান" in out["replyText"] and "model_pitch_removed" not in out["meta"]["guards"], out["replyText"]


def test_by_hand_categories_still_know_when_they_are_usually_served():
    # switched by hand, a kebab section had no hours at all — so the waiter couldn't say "from 5pm"
    import availability
    periods = [{"id": "lunch", "name": "Lunch", "start": "12:00", "end": "17:00"},
               {"id": "afternoon", "name": "Evening", "start": "17:00", "end": "22:00"}]
    rules = {"periods": periods, "categories": {"c": {"hours": [], "usualHours": [{"start": "17:00", "end": "22:00"}]}}}
    assert availability.served_periods({"categoryId": "c"}, rules) == ["afternoon"]


def _turn(said, ops, reply):
    import asyncio
    import json

    async def fake(messages):
        return json.dumps({"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [],
                           "cartOps": [{"op": "add", "item": MENU.ref(MENU.by_id[i]), "quantity": 1, "variant": "",
                                        "note": "", "choices": []} for i in ops],
                           "clearCart": False, "confirmOrder": False, "checkout": "none", "understood": True,
                           "answerItems": [], "serviceRequest": None, "suggestions": [], "replyText": reply})
    orig, brain._call_openai = brain._call_openai, fake
    try:
        return asyncio.run(brain.generate_reply(said, menu_snapshot={"items": MENU.items}, locale="bn",
                                                context={"cartItems": [], "table": "3"}))
    finally:
        brain._call_openai = orig


def test_a_kind_the_ai_left_out_of_the_order_is_asked_which():
    # gpt-6.1-terra added the ঝোল and never asked which ভর্তা
    out = _turn("একটা ভর্তা আর একটা দেশি মুরগির ঝোল দাও।", ["c1"], "1টা দেশি মুরগির ঝোল যোগ করলাম। সাথে ভাত দেব?")
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["c1"]
    assert "বেগুন ভর্তা" in out["replyText"] and "কোনটা" in out["replyText"], out["replyText"]
    assert {o["itemId"] for o in out["meta"]["decision"]["chooseOptions"]} == {"b1", "b2", "b3"}


def test_a_dish_not_on_the_menu_the_ai_left_out_is_said():
    # gpt-6.1-terra added the rice and said nothing about the চিকেন ভুনা (none on this menu)
    out = _turn("ভাই, একটা চিকেন ভুনা আর একটা ভাত দিন।", ["r1"], "একটা সাদা ভাত যোগ করলাম।")
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["r1"]
    reply = out["replyText"]
    assert "চিকেন ভুনা আমাদের মেনুতে নেই" in reply and "চিকেন ঝাল ফ্রাই" in reply, reply
    assert "missing_dish_said" in out["meta"]["guards"]
    # (a dish of ours the AI did add is never said to be missing)
    out = _turn("একটা গরুর কালা ভুনা আর একটা ভাত দিন।", ["m1", "r1"], "1টা গরুর কালা ভুনা আর 1টা সাদা ভাত যোগ করলাম।")
    assert "নেই" not in out["replyText"] and "missing_dish_said" not in out["meta"]["guards"], out["replyText"]


def test_a_dish_not_on_now_said_in_passing_is_mended_without_asking_again():
    # gpt-6.1-terra said "পরোটা" at night (the breakfast one) and "ভর্তা-ভাজিও আছে" with ভাজি sold out — the AI was
    # asked a second time for each (4–5 s); the code mends the sentence itself
    m = MenuIndex([
        {"id": "p1", "name": "পরোটা", "category": "নাস্তা", "price": 20},
        {"id": "p2", "name": "প্যাঁচ পরোটা", "category": "রুটি", "price": 40},
        {"id": "v1", "name": "ভাজি", "category": "নাস্তা", "price": 30},
        {"id": "g1", "name": "চিকেন গ্রিল", "category": "গ্রিল", "price": 350},
    ])
    on = {"p1": False, "p2": True, "v1": False, "g1": True}
    by = m.by_id
    assert brain._mend_unavailable("জি, পরোটা আছে। কোনটা দেব?", [by["p1"]], m, on) == "জি, প্যাঁচ পরোটা আছে। কোনটা দেব?"
    assert (brain._mend_unavailable("চিকেন গ্রিল খেতে পারেন। ভর্তা-ভাজিও আছে। কোনটা দেব?", [by["v1"]], m, on)
            == "চিকেন গ্রিল খেতে পারেন। কোনটা দেব?")
    # (a sentence offering a dish that IS on as well → not mended here: the AI answers again)
    assert brain._mend_unavailable("চিকেন গ্রিল আর ভর্তা-ভাজি খেতে পারেন।", [by["v1"]], m, on) is None


def test_the_owners_rice_words_are_said_as_they_are():
    # AI-first: given "এখন ভাত খেতে পারেন, ভাতের সাথে মাছের মধ্যে …" as a fact, the AI wrote its own ("এখন সাদা ভাত
    # (মিনিকেট) এর সাথে হাওরের বোয়াল মাছ…") — at a rice house the owner's words are said, no AI
    import asyncio
    import json
    calls = []

    async def fake(messages):
        calls.append(1)
        return json.dumps({"topic": "recommendation", "intent": "suggestions", "language": "bn", "mentionedItems": [],
                           "cartOps": [], "clearCart": False, "confirmOrder": False, "checkout": "none",
                           "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [],
                           "foodsNamed": [], "guestPrefs": None, "replyText": "(the AI)"})
    orig, ai_first = brain._call_openai, brain.AI_FIRST
    brain._call_openai, brain.AI_FIRST = fake, True
    try:
        periods = [{"id": "breakfast", "name": "Breakfast", "start": "06:00", "end": "12:01"},
                   {"id": "lunch", "name": "Lunch", "start": "12:02", "end": "17:00"},
                   {"id": "afternoon", "name": "Evening", "start": "17:01", "end": "22:00"},
                   {"id": "dinner", "name": "Dinner", "start": "22:01", "end": "00:01"}]
        out = asyncio.run(brain.generate_reply("এখন কি খাওয়া যেতে পারে?", locale="bn",
                                               menu_snapshot={"items": [dict(i, periods=["lunch", "afternoon", "dinner"])
                                                                        for i in MENU.items], "periods": periods},
                                               context={"cartItems": [], "localTime": "21:30"}))
    finally:
        brain._call_openai, brain.AI_FIRST = orig, ai_first
    assert not calls and out["replyText"].startswith("এখন ভাত খেতে পারেন — ভাতের সাথে মাছের মধ্যে"), out["replyText"]


def test_every_general_suggestion_gets_the_times_answer_and_a_condition_goes_to_the_ai():
    # the owner: every general suggestion question gets the time's answer — only one with a condition is the AI's
    import asyncio
    import json
    periods = [{"id": "breakfast", "name": "Breakfast", "start": "06:00", "end": "12:01"},
               {"id": "lunch", "name": "Lunch", "start": "12:02", "end": "17:00"},
               {"id": "afternoon", "name": "Evening", "start": "17:01", "end": "22:00"},
               {"id": "dinner", "name": "Dinner", "start": "22:01", "end": "00:01"}]
    items = [dict(i, periods=["lunch", "afternoon", "dinner"]) for i in MENU.items]

    def ask(said):
        calls = []

        async def fake(messages):
            calls.append(1)
            return json.dumps({"topic": "recommendation", "intent": "suggestions", "language": "bn", "mentionedItems": [],
                               "cartOps": [], "clearCart": False, "confirmOrder": False, "checkout": "none",
                               "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [],
                               "foodsNamed": [], "guestPrefs": None, "replyText": "(the AI)"})
        orig, ai_first = brain._call_openai, brain.AI_FIRST
        brain._call_openai, brain.AI_FIRST = fake, True
        try:
            out = asyncio.run(brain.generate_reply(said, locale="bn", menu_snapshot={"items": items, "periods": periods},
                                                   context={"cartItems": [], "localTime": "21:30"}))
        finally:
            brain._call_openai, brain.AI_FIRST = orig, ai_first
        return out["replyText"], len(calls)

    for said in ["কিছু সাজেস্ট করেন", "ভালো কি আছে?", "আপনার রেকমেন্ডেশন কি?", "কি নেওয়া যায়?", "কি অর্ডার করবো?",
                 "খিদে পেয়েছে, কি খাওয়া যায়?"]:
        text, n = ask(said)
        assert n == 0 and text.startswith("এখন ভাত খেতে পারেন"), (said, text)
    for said in ["ঝাল ছাড়া কি আছে?", "২ জনের জন্য কি খাব?", "বাচ্চার জন্য কি ভালো?", "হালকা কিছু দিন",
                 "সবচেয়ে জনপ্রিয় কি?", "৫০০ টাকার মধ্যে কি খাব?"]:
        assert ask(said)[1] >= 1, said
