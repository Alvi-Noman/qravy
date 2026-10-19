""""বিকেলে কি আছে?" / "এখন কি পাওয়া যাবে?" → what the restaurant SET for that time (its service periods, from the
category / dish hours: availability.served_periods), at any hour — not a guess from dish names.
Run: python -m pytest tests/test_period_menu.py"""
import asyncio
import json
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
    assert t.startswith("বিকেলের নাস্তা পাওয়া যায় ৩টা থেকে ৬টা") and "বিফ শিক কাবাব" in t and "চিকেন টিক্কা" in t, t
    assert "পরোটা" not in t and "গরুর লাল ভুনা" not in t, t
    assert not cards(out)  # not orderable yet — nothing to tap


def test_afternoon_asked_in_the_afternoon_shows_it_to_order():
    out, _ = run("বিকেলে কি পাওয়া যায়?", at="Mon 16:10")
    assert "এখনই পাওয়া যাচ্ছে" in out["replyText"] and cards(out) == {"shik", "tikka", "naan"}, out["replyText"]


def test_ekhon_reads_the_restaurants_clock():
    out, _ = run("এখন কি আছে?", at="Mon 16:10")
    assert out["replyText"].startswith("এখন বিকেলের নাস্তার সময় (৩টা থেকে ৬টা)"), out["replyText"]
    assert cards(out) == {"shik", "tikka", "naan"}
    morning, _ = run("এখন কি খাওয়া যাবে?", at="Tue 08:20")
    assert morning["replyText"].startswith("এখন সকালের নাস্তার সময়") and cards(morning) == {"porota", "dal"}, \
        morning["replyText"]


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
    assert run("সকালে কি পাওয়া যায়?")[0]["replyText"].startswith("সকালের নাস্তা পাওয়া যায় ৭টা থেকে ১১টা")
    out, _ = run("সন্ধ্যায় কি আছে?", at="Mon 13:05")  # 6:30 pm → the dinner period: nothing set for it
    assert "period_menu" not in out["meta"]["guards"]
    out, _ = run("রাতে কি আছে?", items=ITEMS + [{"id": "kacchi", "name": "মাটন কাচ্চি", "price": 400, "category": CURRY,
                                                   "categoryId": "c3", "periods": ["dinner"]}])
    assert "মাটন কাচ্চি" in out["replyText"] and "রাতের খাবার" in out["replyText"], out["replyText"]


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
