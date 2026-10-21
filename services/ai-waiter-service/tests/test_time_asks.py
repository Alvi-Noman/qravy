"""A dish asked about at a time ("সকালের খাবারে কি বোয়াল মাছ পাবো?") is answered from the menu's own hours — the
dish's periods, the opening hours, closed right now — never a guessed "হ্যাঁ, সকালে পাবেন".
Run: python -m pytest tests/test_time_asks.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402

TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "হ্যাঁ, সকালে পাবেন।"}
PERIODS = [{"id": "breakfast", "name": "Breakfast", "start": "08:00", "end": "11:00"},
           {"id": "lunch", "name": "Lunch", "start": "12:00", "end": "16:00"},
           {"id": "dinner", "name": "Dinner", "start": "19:00", "end": "23:00"}]
OPENING = [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "08:00", "end": "23:00"}]
CLOSED = "এখন রেস্টুরেন্ট বন্ধ — খুলবে সকাল ৮টায়।"


def items(closed=False):
    out = [{"id": "boal", "name": "হাওরের বোয়াল মাছ", "price": 380, "category": "মাছ", "periods": ["lunch", "dinner"]},
           {"id": "rui", "name": "রুই মাছ (গ্লাসি)", "price": 220, "category": "মাছ", "periods": ["lunch", "dinner"]},
           {"id": "porota", "name": "পরোটা", "price": 15, "category": "নাস্তা", "periods": ["breakfast"]},
           {"id": "nehari", "name": "গরুর নেহারি", "price": 250, "category": "নাস্তা", "periods": ["breakfast"]},
           {"id": "tea", "name": "দুধ চা", "price": 30, "category": "চা"}]
    if closed:
        for it in out:
            it["available"], it["unavailableReason"] = False, CLOSED
    return out


def run(text, at, closed=False):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(TURN)

    async def no_reading(*a, **k):
        return None

    orig = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": items(closed), "periods": PERIODS}, locale="bn", history=[],
            restaurant={"staffAlerts": False, "opening": OPENING},
            context={"cartItems": [], "table": "5", "localTime": f"Tue {at}"}))
    finally:
        brain._call_openai, brain._understand = orig
    return out, calls


def test_a_lunch_dish_in_the_morning_while_closed():
    out, calls = run("সকালের খাবারে কি বোয়াল মাছ পাবো?", "23:45", closed=True)
    assert not calls and out["meta"]["guards"] == ["dish_time_no"], out["replyText"]
    assert out["replyText"].startswith("না, সকালে হাওরের বোয়াল মাছ পাওয়া যায় না"), out["replyText"]
    assert "নেহারি" in out["replyText"] or "পরোটা" in out["replyText"], out["replyText"]  # what IS there in the morning


def test_banglish_and_a_breakfast_dish_while_closed():
    out, _ = run("shokaler khabare ki boal mach pabo?", "23:45", closed=True)
    assert out["meta"]["guards"] == ["dish_time_no"], out["replyText"]
    out, _ = run("সকালে পরোটা পাবো?", "23:45", closed=True)
    assert out["replyText"].startswith("জি, সকালে পরোটা পাওয়া যায়") and "এখন রেস্টুরেন্ট বন্ধ" in out["replyText"], out["replyText"]


def test_open_and_served_then_offers_it():
    out, _ = run("রাতে বোয়াল মাছ পাবো?", "20:30")
    assert out["replyText"].startswith("জি, রাতে হাওরের বোয়াল মাছ পাওয়া যায়") and "দেব?" in out["replyText"], out["replyText"]


def test_a_time_the_restaurant_is_closed():
    out, _ = run("মাঝরাতে চা পাওয়া যাবে?", "20:30")
    assert out["meta"]["guards"] == ["dish_time_closed"] and "খোলা থাকি না" in out["replyText"], out["replyText"]
