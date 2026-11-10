"""A reply must never say a dish was added when the safety check refused to add it (2026-11-10, local test turn:
the guest answered the spice question with just "এক্স্ট্রহট"; the model wrote "…যোগ করে দেওয়া হয়েছে" but its add was
dropped for a missing size — the guest heard "added" and the order had nothing). Offline: a scripted model answer.
Run: python -m pytest -q tests/test_false_added_claim.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from brain import MenuIndex  # noqa: E402

# test data only (a dish with sizes AND a required one-pick group, and a plain dish already in the order)
WINGS = {
    "id": "wg", "name": "Test Wings", "price": 320, "category": "Starters",
    "variations": [{"name": "6 pcs", "price": 320}, {"name": "10 pcs", "price": 490}],
    "modifierGroups": [{"id": "sp", "name": "Spice level", "min": 1, "max": 1,
                        "options": [{"id": "r", "name": "Regular", "price": 0}, {"id": "s", "name": "Spicy", "price": 0},
                                    {"id": "x", "name": "Extra hot", "price": 0}]}],
}
TOWER = {"id": "tw", "name": "Test Tower", "price": 590, "category": "Burgers"}
MENU = [WINGS, TOWER]
IDX = MenuIndex(MENU)

TURN = {"sayFirst": "", "topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [],
        "clearCart": False, "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [],
        "serviceRequest": None, "suggestions": [], "guestPrefs": None}


def _run(text, obj, ctx):
    async def fake(messages):
        return json.dumps(obj)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        return asyncio.run(brain.generate_reply(text, menu_snapshot={"items": MENU}, context=dict(ctx)))
    finally:
        brain._call_openai = orig


def _claims_added(reply: str) -> bool:
    return bool(brain._CLAIMS_ADDED.search(reply or ""))


def test_bangla_ways_of_saying_added_are_recognised():
    for said in ["আপনার অর্ডারে 1টা Wings (৳320) যোগ করে দেওয়া হয়েছে।", "১টি Wings যোগ করে নিয়েছি।",
                 "Wings যুক্ত করা হয়েছে।", "Wings অ্যাড করে দিলাম।", "Wings যোগ করেছি।", "Wings যোগ করা হয়েছে।",
                 "I've added the Wings."]:
        assert _claims_added(said), said
    # an offer is not a claim
    for offer in ["Wings যোগ করে দেব?", "Wings নেবেন?", "Shall I add the Wings?"]:
        assert not _claims_added(offer), offer


def _refused_add_turn(op_extra):
    ctx = {"mealKinds": ["dinner"], "cartItems": [{"itemId": "tw", "quantity": 1}]}
    obj = {**TURN, "mentionedItems": [IDX.ref(WINGS)],
           "cartOps": [{"op": "add", "item": IDX.ref(WINGS), "quantity": 1, "note": "Extra hot", "removeNote": False,
                        "choices": [], "variant": "", **op_extra}],
           "replyText": "আপনার অর্ডারে 1টা Extra Hot Wings (৳320) যোগ করে দেওয়া হয়েছে। সাথে কোন ড্রিংক বা সাইড ডিশ রাখবেন?"}
    return _run("এক্স্ট্রহট", obj, ctx)


def test_refused_add_is_never_reported_as_added():
    for extra in ({}, {"line": "L2"}):  # a fresh add, and the model pointing at a line of the order
        out = _refused_add_turn(extra)
        added = [o for o in out["meta"].get("cartOps") or [] if o.get("op") == "add" and o.get("itemId") == "wg"]
        if added:
            continue  # (the answer completed the dish — then "added" is true)
        assert not _claims_added(out["replyText"]), (extra, out["replyText"])
        assert "যোগ করে দেওয়া হয়েছে" not in out["replyText"], (extra, out["replyText"])
        assert "cart_change_blocked" in out["meta"]["guards"], (extra, out["meta"]["guards"])


def _turn(text, obj, ctx, state=None):
    async def fake(messages):
        return json.dumps(obj)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        return asyncio.run(brain.generate_reply(text, menu_snapshot={"items": MENU}, context=dict(ctx), dialog_state=state))
    finally:
        brain._call_openai = orig


def test_answering_the_waiting_choice_in_the_next_turn():
    """The live conversation's shape: a dish with a size AND a spice ordered with another dish — the model pointed the
    new add at a made-up line ("line": "Test Wings") — then the guest answered only the spice, misheard as one word."""
    def add(item, **kw):
        return {"op": "add", "item": IDX.ref(item), "quantity": 1, "note": "", "removeNote": False, "choices": [],
                "variant": "", **kw}

    # turn 1: the plain dish goes in; the other is held and BOTH its size and its spice are asked
    t1 = _turn("একটা test wings দাও আর একটা test tower দাও",
               {**TURN, "cartOps": [add(WINGS, line="Test Wings"), add(TOWER, line="Test Tower")],
                "replyText": "আপনার অর্ডারে ১টি Test Wings আর ১টি Test Tower যোগ করে নিয়েছি।"},
               {"mealKinds": ["dinner"], "cartItems": []})
    added = {o["itemId"] for o in t1["meta"]["cartOps"] if o["op"] == "add"}
    assert added == {"tw"}, t1["meta"]["cartOps"]
    pending = (t1["meta"].get("tray") or {}).get("pending") or {}
    assert pending.get("kind") == "options" and pending["items"][0]["itemId"] == "wg", pending
    assert "6 pcs" in t1["replyText"] and "Extra hot" in t1["replyText"], t1["replyText"]

    # turn 2: "এক্স্ট্রহট" answers the spice → only the size is asked now; nothing is said to be added
    t2 = _turn("এক্স্ট্রহট",
               {**TURN, "cartOps": [add(WINGS, line="L2", note="Extra hot")],
                "replyText": "আপনার অর্ডারে 1টা Extra Hot Wings (৳320) যোগ করে দেওয়া হয়েছে।"},
               {"mealKinds": ["dinner"], "cartItems": [{"itemId": "tw", "quantity": 1}]},
               state={"tray": t1["meta"]["tray"]})
    assert not any(o["op"] == "add" and o["itemId"] == "wg" for o in t2["meta"].get("cartOps") or []), t2["meta"]["cartOps"]
    assert not _claims_added(t2["replyText"]), t2["replyText"]
    held = ((t2["meta"].get("tray") or {}).get("pending") or {}).get("items") or []
    assert held and held[0]["choices"] == ["Extra hot"], held
    assert "6 pcs" in t2["replyText"], t2["replyText"]

    # turn 3: the size → the dish goes in, complete
    t3 = _turn("দশ পিস", {**TURN, "cartOps": [], "replyText": "ঠিক আছে।"},
               {"mealKinds": ["dinner"], "cartItems": [{"itemId": "tw", "quantity": 1}]},
               state={"tray": t2["meta"]["tray"]})
    op = next(o for o in t3["meta"]["cartOps"] if o["op"] == "add" and o["itemId"] == "wg")
    assert op.get("variant") == "10 pcs" and op.get("choices") == ["Extra hot"], op
