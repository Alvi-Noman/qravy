"""Offline tests for the tray: exact lines, relative changes, edits, undo, "sure?" questions, tray questions and
warnings. Run: python tests/test_tray.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import tray  # noqa: E402

ITEMS = [
    {"id": "sr", "name": "Spring Roll", "price": 230, "category": "Appetizer"},
    {"id": "kb", "name": "Kacchi Biryani", "price": 420, "category": "Biryani",
     "variations": [{"name": "Half", "price": 420}, {"name": "Full", "price": 780}]},
    {"id": "pf", "name": "Prawn Fried Rice", "price": 320, "category": "Rice"},
    {"id": "c2", "name": "Choice of 2 Curry", "price": 320, "category": "Curry",
     "modifierGroups": [{"id": "g", "name": "Choose 2", "min": 2, "max": 2, "options": [
         {"id": "o1", "name": "Beef Chili Onion", "price": 0}, {"id": "o2", "name": "Szu-Chuan Chicken", "price": 0},
         {"id": "o3", "name": "Beef Hot Sauce", "price": 0}]}]},
    {"id": "gone", "name": "Beef Sizzling", "price": 450, "category": "Sizzling", "available": False,
     "unavailableReason": "Beef Sizzling আজ শেষ হয়ে গেছে।"},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [], "cartOps": [],
        "clearCart": False, "confirmOrder": False, "checkout": "none", "understood": True, "serviceRequest": None,
        "suggestions": [], "voiceReplyText": ""}
KACCHI_TWO = [  # the same dish twice: a Half and a Full line
    {"itemId": "kb", "quantity": 2, "price": 420, "variation": "Half"},
    {"itemId": "kb", "quantity": 1, "price": 780, "variation": "Full"},
    {"itemId": "sr", "quantity": 1, "price": 230},
]


def op(kind, item, line="", q=0, variant="", note="", choices=None, remove_note=False):
    return {"op": kind, "item": IDX.ref(next(i for i in ITEMS if i["id"] == item)), "line": line, "quantity": q,
            "variant": variant, "note": note, "removeNote": remove_note, "choices": choices or []}


def run(text, cart, model=None, state=None, history=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(model or {**TURN, "replyText": "ঠিক আছে।"})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": ITEMS}, locale="bn", history=history,
                                               dialog_state=state, context={"cartItems": [dict(c) for c in cart],
                                                                            "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai = orig
    return out, calls


def test_line_keys_match_the_storefront():
    # CartContext.cartLineKey: `${id}::${variation ?? ''}::${groupId:optionId sorted, joined by |}`
    mods = [{"groupId": "g", "optionId": "o2"}, {"groupId": "g", "optionId": "o1"}]
    assert tray.line_key("c2", "", mods) == "c2::::g:o1|g:o2"
    assert tray.line_key("kb", "Full", []) == "kb::Full::"


def test_the_model_sees_every_line_with_a_ref():
    _, calls = run("কী কী আছে আমার?", KACCHI_TWO, model={**TURN, "topic": "other", "replyText": "…"})
    cart = calls[0][-1]["content"]  # this turn's block
    assert "L1: 2 × Kacchi Biryani" in cart and "L2: 1 × Kacchi Biryani" in cart and "Full" in cart
    assert "TRAY FACTS" in cart and "4 items" in cart


def test_two_lines_of_one_dish_ask_which_unless_a_line_is_given():
    out, _ = run("কাচ্চিটা বাদ দিন", KACCHI_TWO, model={**TURN, "cartOps": [op("remove", "kb")], "replyText": "বাদ দিলাম।"})
    assert out["meta"]["cartOps"] == [] and "Half" in out["replyText"] and "Full" in out["replyText"]
    # "বড়টা বাদ দিন" → the model points at the Full line → exactly that line goes
    out, _ = run("বড়টা বাদ দিন", KACCHI_TWO, model={**TURN, "cartOps": [op("remove", "kb", line="L2")], "replyText": "বাদ দিলাম।"})
    assert [(o["op"], o["lineKey"]) for o in out["meta"]["cartOps"]] == [("remove", "kb::Full::")]
    # "দুইটাই বাদ দিন" → both lines
    out, _ = run("কাচ্চি দুইটাই বাদ দিন", KACCHI_TWO, model={**TURN, "cartOps": [op("remove", "kb")], "replyText": "বাদ দিলাম।"})
    assert sorted(o["lineKey"] for o in out["meta"]["cartOps"]) == ["kb::Full::", "kb::Half::"]


def test_one_less_and_edit_a_line():
    out, _ = run("হাফ কাচ্চি একটা কমান", KACCHI_TWO, model={**TURN, "cartOps": [op("sub", "kb", line="L1", q=1)], "replyText": "…"})
    assert [(o["op"], o["lineKey"], o["quantity"]) for o in out["meta"]["cartOps"]] == [("set", "kb::Half::", 1)]
    out, _ = run("স্প্রিং রোল একটা কমান", KACCHI_TWO, model={**TURN, "cartOps": [op("sub", "sr", q=1)], "replyText": "…"})
    assert [(o["op"], o["lineKey"]) for o in out["meta"]["cartOps"]] == [("remove", "sr::::")]
    # "ফুলটা হাফ করে দিন" → the Full line becomes Half (price follows)
    out, _ = run("ফুলটা হাফ করে দিন", KACCHI_TWO, model={**TURN, "cartOps": [op("edit", "kb", line="L2", variant="Half")], "replyText": "…"})
    o = out["meta"]["cartOps"][0]
    assert (o["op"], o["lineKey"], o["variant"], o["price"]) == ("edit", "kb::Full::", "Half", 420.0)
    # swap a curry choice — the full new list, only with choices the guest said
    cart = [{"itemId": "c2", "quantity": 1, "price": 320, "modifiers": [
        {"groupId": "g", "optionId": "o1", "name": "Beef Chili Onion", "price": 0},
        {"groupId": "g", "optionId": "o2", "name": "Szu-Chuan Chicken", "price": 0}]}]
    out, _ = run("Beef Chili Onion এর বদলে Beef Hot Sauce দিন", cart,
                 model={**TURN, "cartOps": [op("edit", "c2", line="L1", choices=["Beef Hot Sauce", "Szu-Chuan Chicken"])], "replyText": "…"})
    o = out["meta"]["cartOps"][0]
    assert o["op"] == "edit" and sorted(o["choices"]) == ["Beef Hot Sauce", "Szu-Chuan Chicken"]
    # remove a note
    out, _ = run("ঝাল কম লাগবে না", [{"itemId": "sr", "quantity": 1, "price": 230, "notes": "ঝাল কম"}],
                 model={**TURN, "cartOps": [op("note", "sr", line="L1", remove_note=True)], "replyText": "…"})
    assert out["meta"]["cartOps"][0]["removeNote"] is True


def test_undo_restores_exactly():
    # turn 1: the Full kacchi is removed …
    out, _ = run("বড়টা বাদ দিন", KACCHI_TWO, model={**TURN, "cartOps": [op("remove", "kb", line="L2")], "replyText": "…"})
    state = {"tray": out["meta"]["tray"]}
    after = [c for c in KACCHI_TWO if c.get("variation") != "Full"]
    # turn 2: "আগের মতো করে দিন" → it comes back (no model call)
    out2, calls = run("না না, আগের মতো করে দিন", after, state=state)
    assert not calls
    ops = out2["meta"]["cartOps"]
    assert [o["op"] for o in ops] == ["restore"] and ops[0]["line"]["variation"] == "Full" and ops[0]["line"]["quantity"] == 1
    assert "আগের মতো" in out2["replyText"]
    # nothing to undo
    out3, _ = run("undo", KACCHI_TWO, state={})
    assert out3["meta"]["cartOps"] == [] and "nothing for me to undo" in out3["replyText"]
    out4, _ = run("আগের মতো করে দিন", KACCHI_TWO, state={})
    assert out4["meta"]["cartOps"] == [] and "ফিরিয়ে দেব" in out4["replyText"]


def test_big_quantity_duplicates_and_clear_ask_first():
    out, _ = run("২০টা স্প্রিং রোল দিন", [], model={**TURN, "cartOps": [op("add", "sr", q=20)], "replyText": "যোগ করলাম।"})
    assert out["meta"]["cartOps"] == [] and "ঠিক শুনেছি" in out["replyText"]
    out2, calls = run("হ্যাঁ", [], state={"tray": out["meta"]["tray"]})
    assert not calls and out2["meta"]["cartOps"][0]["quantity"] == 20
    # already in the tray and no "more" word → ask
    cart = [{"itemId": "sr", "quantity": 1, "price": 230}]
    out, _ = run("স্প্রিং রোল দিন", cart, model={**TURN, "cartOps": [op("add", "sr", q=1)], "replyText": "যোগ করলাম।"})
    assert out["meta"]["cartOps"] == [] and "আগে থেকেই 1টা" in out["replyText"] and "মোট 2টা" in out["replyText"]
    out2, _ = run("না", cart, state={"tray": out["meta"]["tray"]})
    assert out2["meta"]["cartOps"] == [] and "যেমন ছিল" in out2["replyText"]
    # "আরেকটা" is clear → no question
    out, _ = run("আরেকটা স্প্রিং রোল দিন", cart, model={**TURN, "cartOps": [op("add", "sr", q=1)], "replyText": "…"})
    assert out["meta"]["cartOps"][0]["op"] == "add"
    # clearing the tray always asks first (with yes / no buttons); yes clears
    out, _ = run("সব বাতিল করে দিন", KACCHI_TWO, model={**TURN, "clearCart": True, "replyText": "বাতিল করলাম।"})
    assert out["meta"]["clearCart"] is False and "সবগুলো বাদ" in out["replyText"]
    assert len(out["meta"]["decision"]["chooseOptions"]) == 2
    out2, _ = run("হ্যাঁ", KACCHI_TWO, state={"tray": out["meta"]["tray"]})
    assert out2["meta"]["clearCart"] is True
    # … and it can be undone
    out3, _ = run("আগের মতো করে দিন", [], state={"tray": out2["meta"]["tray"]})
    assert len([o for o in out3["meta"]["cartOps"] if o["op"] == "restore"]) == 3


def test_one_more_and_one_less_follow_the_last_change():
    # turn 1: the model added a Full kacchi
    out, _ = run("একটা ফুল কাচ্চি দিন", [], model={**TURN, "cartOps": [op("add", "kb", q=1, variant="Full")], "replyText": "…"})
    state = {"tray": out["meta"]["tray"]}
    cart = [{"itemId": "kb", "quantity": 1, "price": 780, "variation": "Full"}]
    # "আরেকটা দিন" → one more of exactly that line (Full), no model
    out2, calls = run("আরেকটা দিন", cart, state=state)
    assert not calls
    o = out2["meta"]["cartOps"][0]
    assert (o["op"], o["itemId"], o.get("variant"), o["quantity"]) == ("add", "kb", "Full", 1)
    # "একটা কমান" → one less of that line
    cart2 = [{"itemId": "kb", "quantity": 2, "price": 780, "variation": "Full"}]
    out3, calls = run("একটা কমান", cart2, state={"tray": out2["meta"]["tray"]})
    assert not calls and [(o["op"], o["quantity"]) for o in out3["meta"]["cartOps"]] == [("set", 1)]


def test_eval_findings_are_fixed():
    # swap keeps the quantity (2 Spring Rolls → 2 soups)
    items_soup = ITEMS + [{"id": "cs", "name": "Chicken Corn Soup", "price": 300, "category": "Soup"}]
    global IDX
    saved = (IDX, list(ITEMS))
    ITEMS.append({"id": "cs", "name": "Chicken Corn Soup", "price": 300, "category": "Soup"})
    IDX = brain.MenuIndex(ITEMS)
    try:
        out, _ = run("স্প্রিং রোলের বদলে চিকেন কর্ন স্যুপ দিন", [{"itemId": "sr", "quantity": 2, "price": 230}],
                     model={**TURN, "cartOps": [op("remove", "sr", line="L1"), op("add", "cs", q=1)], "replyText": "…"})
        assert [(o["op"], o["itemId"], o.get("quantity")) for o in out["meta"]["cartOps"]] == [("remove", "sr", None), ("add", "cs", 2)]
    finally:
        IDX = saved[0]
        ITEMS[:] = saved[1]
    assert len(items_soup) == len(ITEMS) + 1
    # "২০টা?" → "না, ২টা" is a correction: add exactly 2
    out, _ = run("২০টা স্প্রিং রোল দিন", [], model={**TURN, "cartOps": [op("add", "sr", q=20)], "replyText": "…"})
    out2, calls = run("না, ২টা", [], state={"tray": out["meta"]["tray"]})
    assert not calls and [(o["op"], o["quantity"]) for o in out2["meta"]["cartOps"]] == [("add", 2)]
    # duplicate question answered with a number = the total
    cart = [{"itemId": "sr", "quantity": 1, "price": 230}]
    out, _ = run("স্প্রিং রোল দিন", cart, model={**TURN, "cartOps": [op("add", "sr", q=1)], "replyText": "…"})
    out2, _ = run("না, মোট ৩টা", cart, state={"tray": out["meta"]["tray"]})
    assert [(o["op"], o["quantity"]) for o in out2["meta"]["cartOps"]] == [("set", 3)]
    # each dish named to go (even if that empties the tray) → just done: exactly what they asked, no "delete all?"
    two = [{"itemId": "sr", "quantity": 1, "price": 230}, {"itemId": "pf", "quantity": 2, "price": 320}]
    out, _ = run("স্প্রিং রোল আর প্রন ফ্রাইড রাইস বাদ দিন", two,
                 model={**TURN, "cartOps": [op("remove", "sr", line="L1"), op("remove", "pf", line="L2")], "replyText": "খালি করলাম।"})
    assert [o["op"] for o in out["meta"]["cartOps"]] == ["remove", "remove"] and "সবগুলো বাদ" not in out["replyText"]
    # "চারজন" is not "চা" (tea)
    from waiter_knowledge import missing_kinds

    assert "tea" not in missing_kinds("আমরা চারজন, এটা কি যথেষ্ট হবে?", IDX)
    assert "tea" in missing_kinds("চা আছে?", IDX)


def test_yes_only_accepts_a_dish_the_waiter_asked_about():
    from recommender import RecoState

    state = {"reco": RecoState(turn=1, last_offered=["sr"], last_offer_turn=1).to_dict()}
    silent = [{"role": "assistant", "content": "আপনার ট্রে খালি করা হলো।"}]  # a card was shown, nothing was asked
    out, calls = run("হ্যাঁ", [], state=state, history=silent)
    assert calls and not out["meta"]["cartOps"]
    asked = [{"role": "assistant", "content": "সাথে একটা Spring Roll দেব?"}]
    out, calls = run("হ্যাঁ", [], state=state, history=asked)
    assert not calls and out["meta"]["cartOps"][0]["itemId"] == "sr"


def test_whats_in_my_tray():
    out, calls = run("আমার ট্রেতে কী কী আছে?", KACCHI_TWO)
    assert not calls
    assert "4টা আইটেম" in out["replyText"] and "Kacchi Biryani (Full)" in out["replyText"] and "নাকি অর্ডার কনফার্ম করব?" in out["replyText"]
    out, _ = run("what's in my tray?", [])
    assert "empty" in out["replyText"]


def test_warnings_for_the_whole_tray():
    # a sold-out line is flagged, and blocks the read-back with an offer to remove it
    cart = [{"itemId": "sr", "quantity": 1, "price": 230}, {"itemId": "gone", "quantity": 1, "price": 450}]
    out, _ = run("অর্ডারটা দিয়ে দিন", cart)
    assert "Beef Sizzling" in out["replyText"] and "বাদ দিয়ে দেব" in out["replyText"]
    assert not out["meta"]["decision"].get("showCheckout")
    out2, _ = run("হ্যাঁ", cart, state={"tray": out["meta"]["tray"]})
    assert [(o["op"], o["lineKey"]) for o in out2["meta"]["cartOps"]] == [("remove", "gone::::")]
    # an allergy mentioned earlier + a prawn dish tapped into the tray → said once, flagged on the tray
    from recommender import GuestProfile, RecoState

    state = {"reco": RecoState(profile=GuestProfile(allergies=["shellfish"]).to_dict()).to_dict()}
    out, _ = run("আর কী আছে?", [{"itemId": "pf", "quantity": 1, "price": 320}], state=state,
                 model={**TURN, "topic": "other", "replyText": "আরও অনেক কিছু আছে।"})
    assert any(w["itemId"] == "pf" and w["kind"] == "diet" for w in out["meta"]["cartWarnings"])
    assert "খেয়াল করবেন" in out["replyText"]
    state2 = {"reco": state["reco"], "tray": out["meta"]["tray"]}
    out, _ = run("আর কী আছে?", [{"itemId": "pf", "quantity": 1, "price": 320}], state=state2,
                 model={**TURN, "topic": "other", "replyText": "আরও অনেক কিছু আছে।"})
    assert "খেয়াল করবেন" not in out["replyText"]  # said once, not every turn


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
