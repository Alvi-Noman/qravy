""""বিকেলে কি আছে?" / "এখন কি পাওয়া যাবে?" → what the restaurant SET for that time (its service periods, from the
category / dish hours: availability.served_periods), at any hour — not a guess from dish names.
Run: python -m pytest tests/test_period_menu.py"""
import asyncio
import json
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability  # noqa: E402
import brain  # noqa: E402

PERIODS = [{k: p[k] for k in ("id", "name", "start", "end")} for p in availability.DEFAULT_PERIODS]
SNACKS, MORNING, CURRY = "ছ্যাঁকাখোর (বিকালের নাস্তা)", "ভোরের শহর", "কারির কাহিনী"
ITEMS = [
    {"id": "shik", "name": "বিফ শিক কাবাব", "price": 220, "category": SNACKS, "categoryId": "c1", "periods": ["afternoon"]},
    {"id": "tikka", "name": "চিকেন টিক্কা", "price": 200, "category": SNACKS, "categoryId": "c1", "periods": ["afternoon"]},
    {"id": "naan", "name": "গার্লিক নান", "price": 70, "category": SNACKS, "categoryId": "c1", "periods": ["afternoon"]},
    {"id": "porota", "name": "পরোটা", "price": 15, "category": MORNING, "categoryId": "c2", "periods": ["breakfast"]},
    {"id": "dal", "name": "ডাল", "price": 30, "category": MORNING, "categoryId": "c2", "periods": ["breakfast"]},
    {"id": "beef", "name": "গরুর লাল ভুনা", "price": 300, "category": CURRY, "categoryId": "c3"},  # all day
    {"id": "rice", "name": "সাদা ভাত", "price": 40, "category": CURRY, "categoryId": "c3"},
]
TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}


def run(text, at="Mon 13:05", items=ITEMS, periods=PERIODS):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(TURN)

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        snap = {"items": items, **({"periods": periods} if periods else {})}
        out = asyncio.run(brain.generate_reply(text, menu_snapshot=snap, locale="bn", history=[], dialog_state=None,
                                               context={"cartItems": [], "table": "3", "localTime": at}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


def cards(out):
    return {s["itemId"] for s in out["meta"].get("suggestions") or []}


def test_served_periods_come_from_the_category_and_dish_hours():
    rules = {"periods": availability.DEFAULT_PERIODS,
             "categories": {"c1": {"hours": [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "15:00", "end": "18:00"}]},
                            "c2": {"hours": []}}}
    assert availability.served_periods({"categoryId": "c1"}, rules) == ["afternoon"]
    assert availability.served_periods({"categoryId": "c2"}, rules) is None  # all day: no period of its own
    assert availability.served_periods({"categoryId": "c2", "servicePeriodIds": ["breakfast", "lunch"]}, rules) == [
        "breakfast", "lunch"]
    # a dinner that runs past midnight
    late = {"categoryId": "c2", "availability": [{"days": [5], "start": "21:00", "end": "01:00"}]}
    assert set(availability.served_periods(late, rules)) == {"dinner", "late-night"}


def test_afternoon_asked_at_lunch_lists_the_afternoon_menu_and_when():
    out, calls = run("বিকেলে কি আছে?", at="Mon 13:05")
    assert not calls and "period_menu" in out["meta"]["guards"], out["replyText"]
    t = out["replyText"]
    # as a waiter says it: the time in words, the kind of food, the main dishes first, the bread only "সাথে … আছে"
    assert t == ("বিকেলে, মানে বিকেল ৩টা থেকে সন্ধ্যা ৬টা পর্যন্ত, আমাদের কাবাব-গ্রিল আইটেমগুলো পাওয়া যায়: বিফ শিক কাবাব "
                 "আর চিকেন টিক্কা। সাথে নান-ও আছে। এখন এগুলো পাওয়া যাচ্ছে না — তবে এখন যা আছে তার থেকে কিছু দেব?"), t
    assert "পরোটা" not in t and "গরুর লাল ভুনা" not in t and "ছ্যাঁকাখোর" not in t, t
    assert not cards(out)  # not orderable yet — nothing to tap


def test_afternoon_asked_in_the_afternoon_shows_it_to_order():
    out, _ = run("বিকেলে কি পাওয়া যায়?", at="Mon 16:10")
    assert out["replyText"] == ("বিকেলে আমাদের কাবাব-গ্রিল আইটেমগুলো চলে: বিফ শিক কাবাব আর চিকেন টিক্কা। "
                                "সাথে নান-ও আছে। কোনটা দেব?"), out["replyText"]
    assert cards(out) == {"shik", "tikka", "naan"}


def test_ekhon_reads_the_restaurants_clock():
    out, _ = run("এখন কি আছে?", at="Mon 16:10")
    assert out["replyText"].startswith("এখন আমাদের কাবাব-গ্রিল আইটেমগুলো চলছে: বিফ শিক কাবাব"), out["replyText"]
    assert cards(out) == {"shik", "tikka", "naan"}
    morning, _ = run("এখন কি খাওয়া যাবে?", at="Tue 08:20")
    assert morning["replyText"].startswith("এখন আমাদের নাস্তার আইটেমগুলো চলছে: পরোটা আর ডাল"), morning["replyText"]
    assert cards(morning) == {"porota", "dal"}


def test_ekhon_as_speech_to_text_writes_it():
    # the real lines: "এখন কি খাও যেতে পারে ?", "এখন কিই খাবা জেতে পারে।", "What can we eat now?"
    for said in ("এখন কি খাও যেতে পারে ?", "এখন কিই খাবা জেতে পারে।", "এখন কি খাওয়া যেতে পারে?", "What can we eat now?"):
        out, _ = run(said, at="Mon 16:10")
        assert "period_menu" in out["meta"]["guards"] and cards(out) == {"shik", "tikka", "naan"}, (said, out["replyText"])
    # about the guest's own tray, people / seats, or a pick ("ভালো কি…" — from what's orderable now) — not this
    for said in ("তাহুলে আমার কাটে এখন কি কিয়াছে?", "মানুষ কি আছে এখন?", "এখন ভালো কি খাওয়া যেতে পারে?"):
        out, _ = run(said, at="Mon 16:10")
        assert "period_menu" not in out["meta"]["guards"], (said, out["replyText"])


def test_every_time_word():
    assert run("সকালে কি পাওয়া যায়?")[0]["replyText"].startswith(
        "সকালে, মানে সকাল ৭টা থেকে ১১টা পর্যন্ত, আমাদের নাস্তার আইটেমগুলো পাওয়া যায়: পরোটা আর ডাল।")
    out, _ = run("সন্ধ্যায় কি আছে?", at="Mon 13:05")  # 6:30 pm → the dinner period: nothing set for it
    assert "period_menu" not in out["meta"]["guards"]
    out, _ = run("রাতে কি আছে?", items=ITEMS + [{"id": "kacchi", "name": "মাটন কাচ্চি", "price": 400, "category": CURRY,
                                                   "categoryId": "c3", "periods": ["dinner"]}])
    assert out["replyText"].startswith(
        "রাতে, মানে সন্ধ্যা ৬টা থেকে রাত ১১টা পর্যন্ত, আমাদের কাচ্চি-পোলাও আইটেমগুলো পাওয়া যায়: মাটন কাচ্চি"), out["replyText"]


def test_nothing_set_for_that_time_keeps_the_usual_answer():
    # "এখন কি আছে?" at lunch: no dish is set for lunch → the usual (the menu)
    out, _ = run("এখন কি আছে?", at="Mon 13:05")
    assert "period_menu" not in out["meta"]["guards"], out["replyText"]
    # a menu without any hours at all → never this answer
    plain = [{k: v for k, v in it.items() if k != "periods"} for it in ITEMS]
    out, _ = run("বিকেলে কি আছে?", items=plain)
    assert "period_menu" not in out["meta"]["guards"]


def test_a_kind_at_a_time_and_not_a_question():
    out, _ = run("বিকেলে কি কাবাব আছে?", at="Mon 16:10")
    assert "period_menu" in out["meta"]["guards"] and cards(out) == {"shik", "tikka"}, out["replyText"]
    assert "গার্লিক নান" not in out["replyText"]
    for said in ("এখন অর্ডারটা কনফার্ম করুন", "বিকেলে আসবো", "এখন একটা চিকেন টিক্কা দিন"):
        out, _ = run(said, at="Mon 16:10")
        assert "period_menu" not in out["meta"]["guards"], (said, out["replyText"])


def test_the_real_evening_question():
    # the real turn: the owner's own "Evening" period, 17:01–22:00, asked after it — "এভেনিং পাওয়া যায় পাঁচ:এক থেকে দশটা
    # — তখন আছে ছ্যাঁকাখোর (বিকালের নাস্তা): কাশ্মীরি নান, তিলোত্তমা পাতলা নান, … আর আরও সতেরোটা"
    evening = PERIODS + [{"id": "evening", "name": "Evening", "start": "17:01", "end": "22:00"}]
    items = [dict(it, periods=["evening"]) if it["categoryId"] == "c1" else it for it in ITEMS]
    out, _ = run("সন্ধ্যায় কি কি পাওয়া যায় তোমাদের?", at="Tue 00:10", items=items, periods=evening)
    assert out["replyText"] == (
        "সন্ধ্যায়, মানে বিকেল ৫টা থেকে রাত ১০টা পর্যন্ত, আমাদের কাবাব-গ্রিল আইটেমগুলো পাওয়া যায়: বিফ শিক কাবাব আর "
        "চিকেন টিক্কা। সাথে নান-ও আছে। এখন এগুলো পাওয়া যাচ্ছে না — তবে এখন যা আছে তার থেকে কিছু দেব?"), out["replyText"]
    for bad in ("এভেনিং", "Evening", "আরও", "(বিকালের নাস্তা)"):
        assert bad not in out["replyText"], bad
    assert not re.search(r"[০-৯\d]:[০-৯\d]", out["replyText"])  # never "৫:০১"


def test_dinner_at_a_rice_house_is_rice_first_then_the_kebabs():
    # the owner set the kebabs / grills for Evening + Dinner; rice, fish and meat are all day → at dinner a Bengali
    # waiter offers the rice meal first, the kebabs as the other choice (with naan / paratha)
    house = [
        {"id": "rice", "name": "সাদা ভাত", "price": 40, "category": "মাছে মাতাল বাঙালি", "categoryId": "c4"},
        {"id": "rui", "name": "রুই মাছ", "price": 250, "category": "মাছে মাতাল বাঙালি", "categoryId": "c4"},
        {"id": "ilish", "name": "সরষে ইলিশ", "price": 450, "category": "মাছে মাতাল বাঙালি", "categoryId": "c4"},
        {"id": "murgi", "name": "দেশি মুরগির ঝোল", "price": 280, "category": CURRY, "categoryId": "c3"},
        {"id": "beef", "name": "গরুর লাল ভুনা", "price": 300, "category": CURRY, "categoryId": "c3"},
        {"id": "shik", "name": "বিফ শিক কাবাব", "price": 220, "category": SNACKS, "categoryId": "c1", "periods": ["evening", "dinner"]},
        {"id": "tikka", "name": "চিকেন টিক্কা", "price": 200, "category": SNACKS, "categoryId": "c1", "periods": ["evening", "dinner"]},
        {"id": "naan", "name": "গার্লিক নান", "price": 70, "category": SNACKS, "categoryId": "c1", "periods": ["evening", "dinner"]},
        {"id": "porota", "name": "পরোটা", "price": 15, "category": SNACKS, "categoryId": "c1", "periods": ["evening", "dinner"]},
    ]
    periods = PERIODS + [{"id": "evening", "name": "Evening", "start": "17:01", "end": "22:00"}]
    out, calls = run("রাতে কি আছে?", at="Tue 20:00", items=house, periods=periods)
    assert not calls and out["replyText"] == (
        "রাতে ভাত খেতে পারেন — ভাতের সাথে মাছের মধ্যে রুই মাছ আর সরষে ইলিশ আছে, মুরগির মধ্যে দেশি মুরগির ঝোল আছে, "
        "মাংসের মধ্যে গরুর লাল ভুনা আছে। আবার চাইলে কাবাব-গ্রিলও খেতে পারেন — বিফ শিক কাবাব আর চিকেন টিক্কা, "
        "নান কিংবা পরোটা দিয়ে। কোনটা দেব?"), out["replyText"]
    assert {"rice", "rui", "shik"} <= cards(out)
    # asked at lunch: when, then the same — and no cards (not orderable yet)
    later, _ = run("রাতে কি কি পাওয়া যায়?", at="Tue 13:00", items=house, periods=periods)
    assert later["replyText"].startswith("রাতে, মানে সন্ধ্যা ৬টা থেকে রাত ১১টা পর্যন্ত, ভাত খেতে পারেন") and not cards(later)
    # the evening snack time before dinner is no rice meal ("বিকেলে" = 4:30, only the evening period)
    snack, _ = run("বিকেলে কি আছে?", at="Tue 17:20", items=house, periods=periods)
    assert "ভাত খেতে পারেন" not in snack["replyText"], snack["replyText"]


def test_times_are_said_the_spoken_way():
    assert brain._bn_hours("17:01", "22:00") == "বিকেল ৫টা থেকে রাত ১০টা পর্যন্ত"
    assert brain._bn_hours("12:00", "15:00") == "দুপুর ১২টা থেকে বিকেল ৩টা পর্যন্ত"
    assert brain._bn_hours("12:00", "14:30") == "দুপুর ১২টা থেকে সাড়ে ২টা পর্যন্ত"
    assert brain._bn_hours("07:00", "11:00") == "সকাল ৭টা থেকে ১১টা পর্যন্ত"
    assert brain._bn_hours("15:30", "18:00") == "বিকেল সাড়ে ৩টা থেকে সন্ধ্যা ৬টা পর্যন্ত"
    assert brain._bn_hours("22:00", "02:00") == "রাত ১০টা থেকে ২টা পর্যন্ত"
