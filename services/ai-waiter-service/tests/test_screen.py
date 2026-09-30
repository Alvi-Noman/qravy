"""Offline tests: "which of these…" is about the list on the guest's screen. Run: python tests/test_screen.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402

ITEMS = [
    {"id": "crs", "name": "Crispy Rice Soup", "price": 300, "category": "Soup"},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "sfp", "name": "Special Fried Prawn", "price": 380, "category": "Appetizer", "tags": ["Spicy"]},
    {"id": "brc", "name": "Beef with Red Curry", "price": 380, "category": "Beef Selection"},
    {"id": "crc", "name": "Chicken with Red Curry", "price": 350, "category": "Chicken Selection"},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "item_question", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [],
        "clearCart": False, "confirmOrder": False, "checkout": "none", "understood": True, "serviceRequest": None,
        "suggestions": [], "voiceReplyText": ""}
SHOWN = ["crs", "ff", "sfp"]


def run(text, replies, shown=SHOWN):
    calls = []
    seq = list(replies)

    async def fake(messages):
        calls.append(list(messages))  # a copy: a retry appends to the same list
        return json.dumps(seq.pop(0) if len(seq) > 1 else seq[0])

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": ITEMS}, locale="bn",
                                               context={"cartItems": [], "mealKinds": ["dinner"], "shownItems": shown}))
    finally:
        brain._call_openai = orig
    return out, calls


def test_which_of_these_is_about_the_screen_and_highlights_the_answer():
    # live: "সেগুলোর মধ্যে ঝাল খুন্টা হবে" → the waiter suggested Beef/Chicken with Red Curry from the whole menu
    wrong = {**TURN, "replyText": "ঝাল কম চাইলে Beef with Red Curry বা Chicken with Red Curry নিতে পারেন।"}
    right = {**TURN, "replyText": "সবচেয়ে কম ঝাল হবে French Fry — একদম ঝাল নেই; Crispy Rice Soup-ও হালকা। French Fry দেব?",
             "answerItems": [IDX.ref(ITEMS[1])]}
    out, calls = run("সেগুলোর মধ্যে ঝাল কম কোনটা হবে?", [wrong, right])
    turn = calls[0][-1]["content"]
    assert "ON SCREEN" in turn and "Special Fried Prawn" in turn and "RECOMMENDATION MODE: COMPARE" in turn
    assert len(calls) == 2 and "ON SCREEN" in calls[1][-1]["content"]  # the off-list answer was sent back
    assert "left_the_list_on_screen" in out["meta"]["guards"]
    assert out["meta"]["highlight"] == ["ff"]  # the answer — not every dish the reply mentions
    # the list on screen stays: no new cards, no pop-up switch
    assert out["meta"]["suggestions"] == [] and not out["meta"]["decision"].get("showSuggestionsModal")


def test_only_the_picked_dish_is_highlighted():
    # live: the reply compared all three → all three were highlighted
    all3 = {**TURN, "replyText": "Beef with Red Curry আর Special Fried Prawn দুটোই ঝাল; Crispy Rice Soup-এর ঝাল লেখা নেই।"}
    out, _ = run("এগুলোর মধ্যে কোনটাতে বেশি ঝাল হবে?", [all3])
    assert out["meta"]["highlight"] == []  # no clear pick → nothing lights up
    # no answerItems from the model → the dish in the comparing sentence
    one = {**TURN, "replyText": "French Fry আর Crispy Rice Soup হালকা। তবে সবচেয়ে ঝাল হবে Special Fried Prawn।"}
    out, _ = run("এগুলোর মধ্যে সবচেয়ে ঝাল কোনটা?", [one])
    assert out["meta"]["highlight"] == ["sfp"]  # the superlative sentence, not the first dish named
    picked = {**one, "answerItems": [IDX.ref(ITEMS[2])]}
    out, _ = run("এগুলোর মধ্যে সবচেয়ে ঝাল কোনটা?", [picked])
    assert out["meta"]["highlight"] == ["sfp"]


def test_other_phrasings_and_when_it_is_not_about_the_list():
    ok = {**TURN, "replyText": "Special Fried Prawn সবচেয়ে ঝাল।"}
    for t in ["এগুলোর মধ্যে সবচেয়ে ঝাল কোনটা?", "which of these is the cheapest?", "কোনটা ভালো হবে?", "egula r moddhe konta valo?"]:
        out, calls = run(t, [ok])
        assert "RECOMMENDATION MODE: COMPARE" in calls[0][-1]["content"], t
    # a dish named that isn't on screen → a normal question, not a comparison
    out, calls = run("Beef with Red Curry কি ঝাল?", [ok])
    assert "RECOMMENDATION MODE: COMPARE" not in calls[0][-1]["content"]
    # nothing on screen → nothing to compare
    out, calls = run("কোনটা ভালো হবে?", [ok], shown=[])  # (answered by the fixed recommendation line — no model call)
    assert not calls or "RECOMMENDATION MODE: COMPARE" not in calls[0][-1]["content"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
