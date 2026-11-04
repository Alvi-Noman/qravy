"""The guest's opening "এখন কি খেতে পারি?": the AI's answer is kept for the next guests in exactly the same situation
(brain._saved_pick_key) — never for another hour, another menu state, another question, or a guest who said more."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402

ITEMS = [
    {"id": "g1", "name": "চিকেন গ্রিল", "category": "গ্রিল", "price": 350},
    {"id": "k1", "name": "চিকেন তান্দুরি কাবাব", "category": "কাবাব", "price": 280},
    {"id": "r1", "name": "সাদা ভাত", "category": "ভাত", "price": 40},
    {"id": "c1", "name": "দেশি মুরগির ঝোল", "category": "কারি", "price": 300},
]
REPLY = "এখন সাদা ভাতের সাথে দেশি মুরগির ঝোল খেতে পারেন। কোনটা অর্ডার করতে চান?"


def setup_function():
    brain._SAVED_PICKS.clear()
    brain.AI_FIRST = True


def teardown_function():
    brain._SAVED_PICKS.clear()
    brain.AI_FIRST = os.environ.get("WAITER_AI_FIRST", "").strip() == "1"


def ask(text, at="19:39", items=None, cart=(), history=None, reply=REPLY, extra=None):
    calls = []

    async def fake(messages):
        calls.append(1)
        return json.dumps({"topic": "recommendation", "intent": "suggestions", "language": "bn", "mentionedItems": [],
                           "cartOps": [], "clearCart": False, "confirmOrder": False, "checkout": "none",
                           "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [],
                           "foodsNamed": ["সাদা ভাত", "দেশি মুরগির ঝোল"], "guestPrefs": None,
                           "replyText": reply, **(extra or {})})
    orig, brain._call_openai = brain._call_openai, fake
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": [dict(i) for i in (items or ITEMS)]}, locale="bn", history=history,
            context={"cartItems": [dict(c) for c in cart], "localTime": at, "table": "3"}))
    finally:
        brain._call_openai = orig
    return out, len(calls)


def test_the_same_opening_question_in_the_same_situation_is_answered_without_the_ai():
    out1, n1 = ask("এখন কি খেতে পারি?")
    out2, n2 = ask("এখন কি খেতে পারি?", at="19:52")  # (another minute of the same hour)
    assert (n1, n2) == (1, 0)
    assert out2["replyText"] == out1["replyText"] and "saved_answer" in out2["meta"]["guards"]
    # (the same question in other words is the same answer — "খেতে পারি", "খাওয়া যেতে পারে", "কি খাব"…)
    for said in ["এখন কি খাওয়া যেতে পারে?", "এখন কি খেতে পারবো?", "কি খাব এখন?", "খাওয়ার মত কি আছে?"]:
        assert ask(said)[1] == 0, said


def test_a_different_situation_asks_the_ai():
    ask("এখন কি খেতে পারি?")
    assert ask("এখন কি খেতে পারি?", at="20:05")[1] == 1  # another hour
    sold_out = [dict(i, available=False, unavailableReason="আজ শেষ") if i["id"] == "g1" else i for i in ITEMS]
    assert ask("এখন কি খেতে পারি?", items=sold_out)[1] == 1  # a dish sold out since
    assert ask("এখন কি খেতে পারি?", cart=[{"id": "r1", "name": "সাদা ভাত", "quantity": 1, "price": 40}])[1] >= 1
    history = [{"role": "user", "content": "হ্যালো"}, {"role": "assistant", "content": "জি, বলুন"}]
    assert ask("এখন কি খেতে পারি?", history=history)[1] == 1  # not their first words


def test_a_question_with_more_in_it_always_asks_the_ai():
    for said in ["ঝাল ছাড়া কি খেতে পারি?", "২ জনের জন্য কি খেতে পারি?", "রাতে কি খেতে পারি?", "বাচ্চার জন্য কি খেতে পারি?",
                 "চিকেন গ্রিলের সাথে কি খেতে পারি?", "কাবাব কি খেতে পারি?", "একটা সাদা ভাত দাও"]:
        brain._SAVED_PICKS.clear()
        ask(said)
        assert not brain._SAVED_PICKS, said  # (never kept)
        assert not brain._plain_pick_ask(said, brain.MenuIndex(ITEMS)), said


def test_an_answer_the_checks_had_to_correct_is_never_kept():
    # a dish that isn't on the menu → the self-check asks again; nothing is kept
    ask("এখন কি খেতে পারি?", reply="এখন বিফ তেহারি খেতে পারেন।", extra={"foodsNamed": ["বিফ তেহারি"]})
    assert not brain._SAVED_PICKS


def test_what_do_you_have_opens_the_menu():
    # "কী আছে তোমাদের মেনুতে?" → "এই যে আমাদের মেনু — দেখে বলুন…" and the menu opens (the time of day's fact, on every
    # turn, once kept it from ever firing)
    out, n = ask("কী আছে তোমাদের মেনুতে?")
    assert n == 0 and (out["meta"].get("decision") or {}).get("openMenu"), out["replyText"]
    assert "মেনু" in out["replyText"]
