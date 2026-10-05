"""A dish that needs a size / choice: the clear part of the order is added, the rest is held with its quantity and
asked about in ONE question, and the guest's answer ("স্পাইসি", "দশ পিস") adds it. (Real conversation, 2026-10-05:
"হট উইংস দুটো আর অনিয়ন রিংস তিনটা" → nothing added; "স্পাইসি" → the spice question again.)"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402

SPICE = {"id": "spice", "name": "Spice level", "min": 1, "max": 1, "options": [
    {"id": "regular", "name": "Regular", "price": 0}, {"id": "spicy", "name": "Spicy", "price": 0},
    {"id": "extra-hot", "name": "Extra hot", "price": 0}]}
DIPS = {"id": "dips", "name": "Dips", "min": 0, "max": 2, "options": [
    {"id": "garlic", "name": "Garlic mayo", "price": 30}, {"id": "bbq", "name": "BBQ sauce", "price": 30}]}
ITEMS = [
    {"id": "hw", "name": "Hot Wings", "price": 320, "category": "Chicken", "modifierGroups": [SPICE],
     "variations": [{"name": "6 pcs", "price": 320}, {"name": "10 pcs", "price": 490}]},
    {"id": "or", "name": "Onion Rings", "price": 200, "category": "Sides", "modifierGroups": [DIPS]},
    {"id": "fc", "name": "Fried Chicken", "price": 280, "category": "Chicken", "modifierGroups": [SPICE, DIPS],
     "variations": [{"name": "2 pcs", "price": 280}, {"name": "4 pcs", "price": 520}]},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "replyText": ""}
ORDER = "হট উইংস দেন দুটা আর অনিয়ন রিংস দেন তিনটা।"


def ref(i):
    return IDX.ref(IDX.by_id[i])


def run(text, model=None, cart=(), history=None, state=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **(model or {})})

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai = fake

    async def no_reading(*a, **k):
        return None

    brain._understand = no_reading
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="bn", history=history, dialog_state=state,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "channel": "online"}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


def ops_of(out):
    return [(o["op"], o["itemId"], o.get("quantity"), o.get("variant"), tuple(o.get("choices") or []))
            for o in out["meta"]["cartOps"]]


def first_turn():
    # the model adds both (as the prompt now says), without guessing the wings' size / spice
    return run(ORDER, {"cartOps": [{"op": "add", "item": ref("hw"), "quantity": 2},
                                   {"op": "add", "item": ref("or"), "quantity": 3}],
                       "replyText": "হট উইংস এর স্পাইস লেভেল কী হবে?"})


def next_turn(prev, text, cart, model=None):
    history = [{"role": "user", "content": ORDER}, {"role": "assistant", "content": prev["replyText"]}]
    return run(text, model or {"replyText": "কোনটা নেবেন?"}, cart=cart, history=history,
               state={"tray": prev["meta"]["tray"]})


ONION_IN_TRAY = [{"itemId": "or", "quantity": 3, "price": 200}]


def test_the_clear_dish_is_added_and_the_wings_asked_about_in_one_question():
    out, calls = first_turn()
    assert len(calls) <= 1, "a missing size/choice must not send the model back (it dropped the whole order)"
    assert ops_of(out) == [("add", "or", 3, None, ())], out["meta"]["cartOps"]
    reply = out["replyText"]
    assert "3টা Onion Rings" in reply, reply
    # size AND spice in the same question, with the quantity they ordered
    assert "2টা Hot Wings" in reply and "6 pcs" in reply and "10 pcs" in reply and "Spicy" in reply, reply
    held = out["meta"]["tray"]["pending"]
    assert held["kind"] == "options" and held["items"][0]["quantity"] == 2, held
    # the tray's picker: the dish, what's missing, and every size / option to tap
    pick = out["meta"]["decision"]["pickOptions"]
    assert [(p["itemId"], p["quantity"], p["missing"]) for p in pick] == [("hw", 2, ["size", "Spice level"])], pick
    assert [s["name"] for s in pick[0]["sizes"]] == ["6 pcs", "10 pcs"] and pick[0]["groups"][0]["min"] == 1


def test_the_spice_answer_is_kept_and_only_the_size_is_asked():
    first, _ = first_turn()
    out, calls = next_turn(first, "স্পাইসি", ONION_IN_TRAY)
    assert not calls, "the answer is read exactly — no model call"
    assert out["meta"]["cartOps"] == [], out["meta"]["cartOps"]
    assert "Spicy" not in out["replyText"].split("—", 1)[-1] and "10 pcs" in out["replyText"], out["replyText"]
    pick = out["meta"]["decision"]["pickOptions"][0]
    assert pick["choices"] == ["Spicy"] and pick["missing"] == ["size"], pick  # the picker shows Spicy chosen
    # then the size → added with the earlier quantity and the spice
    out2, _ = next_turn(out, "দশ পিস", ONION_IN_TRAY)
    assert ops_of(out2) == [("add", "hw", 2, "10 pcs", ("Spicy",))], out2["meta"]["cartOps"]
    assert out2["meta"]["cartOps"][0]["price"] == 490
    assert "2টা Hot Wings" in out2["replyText"], out2["replyText"]


def test_both_answers_in_one_breath_add_it():
    first, _ = first_turn()
    out, _ = next_turn(first, "ছয় পিস, এক্সট্রা হট", ONION_IN_TRAY)
    assert ops_of(out) == [("add", "hw", 2, "6 pcs", ("Extra hot",))], out["meta"]["cartOps"]
    assert not out["meta"]["tray"].get("pending")


def test_the_dish_name_is_not_an_answer():
    # "hot wings" must not pick "Extra hot", and "দুটা" (the quantity) must not pick a size
    e = {"itemId": "hw", "name": "Hot Wings", "quantity": 2, "variant": "", "choices": []}
    assert brain._fill_options(e, IDX.by_id["hw"], "হট উইংস দুটা দেন") == ["size", "Spice level"]
    assert brain._said("Spicy", "স্পাইসি") and brain._said("6 pcs", "ছয় পিস") and not brain._said("2 pcs", "দুটা হট উইংস")


def test_a_question_about_the_options_keeps_the_order_waiting():
    first, _ = first_turn()
    out, calls = next_turn(first, "এক্সট্রা হট কি খুব ঝাল?", ONION_IN_TRAY,
                           {"replyText": "জি, এক্সট্রা হট বেশ ঝাল। কোনটা নেবেন?", "topic": "menu_question", "intent": "menu"})
    assert out["meta"]["cartOps"] == [], out["meta"]["cartOps"]
    assert out["meta"]["tray"]["pending"]["kind"] == "options", out["meta"]["tray"]
    out2, _ = next_turn(out, "তাহলে স্পাইসি, দশ পিস", ONION_IN_TRAY)
    assert ops_of(out2) == [("add", "hw", 2, "10 pcs", ("Spicy",))], out2["meta"]["cartOps"]


def test_saying_it_all_up_front_adds_everything_at_once():
    out, _ = run("দুইটা হট উইংস দশ পিস স্পাইসি আর তিনটা অনিয়ন রিংস দেন",
                 {"cartOps": [{"op": "add", "item": ref("hw"), "quantity": 2},
                              {"op": "add", "item": ref("or"), "quantity": 3}], "replyText": "যোগ করলাম।"})
    assert sorted(ops_of(out)) == [("add", "hw", 2, "10 pcs", ("Spicy",)), ("add", "or", 3, None, ())], out["meta"]["cartOps"]


def test_a_plain_order_needs_no_model_and_says_the_added_dish_first():
    # the real turn (10:07): the model added nothing and asked "অনিয়ন রিং দুটো নেবেন ঠিক আছে?"
    out, calls = run("আমাকে একটা হট উইংস দেন আর দুটো অনিয়ন রিংস দেন।",
                     {"cartOps": [], "replyText": "হট উইংস এর জন্য সাইজ বেছে নিতে হবে… অনিয়ন রিং দুটো নেবেন ঠিক আছে?"})
    assert not calls, "a clean order is read without the model"
    assert ops_of(out) == [("add", "or", 2, None, ())], out["meta"]["cartOps"]
    reply = out["replyText"]
    assert reply.startswith("2টা Onion Rings যোগ করলাম।") and "1টা Hot Wings" in reply, reply
    assert out["meta"]["decision"]["pickOptions"][0]["itemId"] == "hw"
