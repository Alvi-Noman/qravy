"""Ordering, made smooth: never guess an item into the tray, add what's clear and ask about the rest (with the
answers as buttons), short confirmations, clean orders without a model call, and the listening hint."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402

ITEMS = [
    {"id": "tvs", "name": "Thai Vegetable Soup (Chicken / Prawn)", "price": 310, "category": "Soup"},
    {"id": "tts", "name": "Thai Thick Soup", "price": 310, "category": "Soup"},
    {"id": "ttm", "name": "Thai Thick Soup with Mushroom", "price": 350, "category": "Soup"},
    {"id": "crs", "name": "Crispy Rice Soup", "price": 300, "category": "Soup"},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "mws", "name": "Mineral Water (small)", "price": 15, "category": "Drinks"},
    {"id": "mwl", "name": "Mineral Water (large)", "price": 25, "category": "Drinks"},
    {"id": "ccs", "name": "Chicken Cashew Nut Salad (regular)", "price": 350, "category": "Salad"},
    {"id": "kb", "name": "Kacchi Biryani", "price": 450, "category": "Biryani",
     "variations": [{"name": "Half", "price": 450}, {"name": "Full", "price": 850}]},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": ""}


def ref(i):
    return IDX.ref(IDX.by_id[i])


def run(text, model=None, cart=(), history=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **(model or {})})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="bn", history=history,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai = orig
    return out, calls


def ops_of(out):
    return [(o["op"], o["itemId"], o.get("quantity")) for o in out["meta"]["cartOps"]]


def test_two_phrases_on_one_dish_keep_the_named_one_and_ask_about_the_other():
    # the real turn: "ভাইস ঠিক স্যুপ" (= থাই থিক স্যুপ, misheard) ×2 + Thai Vegetable Soup ×1 → was 3 × Thai Vegetable Soup
    said = "ভাইস ঠিক স্যুপ দেবেন দুইটা আর থাই ভেজিটেবল স্যুপ দেবেন একটা।"
    out, _ = run(said, {"cartOps": [{"op": "add", "item": ref("tvs"), "quantity": 2},
                                    {"op": "add", "item": ref("tvs"), "quantity": 1}],
                        "replyText": "2টা থাই ভেজিটেবল স্যুপ যোগ করা হলো।"})
    assert ops_of(out) == [("add", "tvs", 1)], out["meta"]["cartOps"]
    reply = out["replyText"]
    assert "1টা Thai Vegetable Soup" in reply and "Thai Thick Soup" in reply and reply.endswith("?"), reply
    opts = out["meta"]["decision"]["chooseOptions"]
    assert opts[0]["itemId"] == "tts" and opts[0]["say"] == "2টা Thai Thick Soup দিন", opts  # the quantity they said


def test_the_clear_part_is_added_and_only_the_unclear_part_is_asked():
    # the real turn: "দুইটা পানি আর দুইটা ক্যাশিউ নাট সালাদ" → was 1 small + 1 large water
    out, _ = run("আমাকে দুইটা পানি আর দুইটা চিকেন ক্যাশিউ নাট সালাদ দিবেন।",
                 {"cartOps": [{"op": "add", "item": ref("mws"), "quantity": 1}, {"op": "add", "item": ref("mwl"), "quantity": 1},
                              {"op": "add", "item": ref("ccs"), "quantity": 2}], "replyText": "যোগ করলাম।"})
    assert ops_of(out) == [("add", "ccs", 2)], out["meta"]["cartOps"]
    assert "2টা Chicken Cashew Nut Salad" in out["replyText"] and "Mineral Water (small)" in out["replyText"]
    assert {o["itemId"] for o in out["meta"]["decision"]["chooseOptions"]} == {"mws", "mwl"}
    assert "added_clear_asked_rest" in out["meta"]["guards"]


def test_a_size_question_comes_with_size_buttons():
    out, _ = run("একটা কাচ্চি বিরিয়ানি দেন", {"cartOps": [{"op": "add", "item": ref("kb"), "quantity": 1}],
                                              "replyText": "Kacchi Biryani যোগ করলাম।"})
    assert ops_of(out) == []
    opts = out["meta"]["decision"]["chooseOptions"]
    assert [o["label"] for o in opts] == ["Half", "Full"] and opts[1]["say"] == "1টা Kacchi Biryani Full দিন", opts


def test_a_clean_order_needs_no_model_and_is_confirmed_short():
    out, calls = run("দুইটা ক্রিস্পি রাইস স্যুপ আর একটা ফ্রেঞ্চ ফ্রাই দিন")
    assert not calls, "a clean order is added without the model"
    assert ops_of(out) == [("add", "crs", 2), ("add", "ff", 1)]
    # (starters only → the main course is offered; only water to drink here: never upsold)
    assert out["replyText"].startswith("2টা Crispy Rice Soup যোগ করলাম। 1টা French Fry যোগ করলাম। "), out["replyText"]
    assert out["meta"]["upsellOffer"]["type"] == "main" and "মেইন কোর্সে" in out["replyText"], out["replyText"]
    assert "clean_order" in out["meta"]["guards"]
    # anything more than "these dishes, this many" → the model reads it (with all its checks)
    for said in ("ঝাল কম করে দুইটা ক্রিস্পি রাইস স্যুপ দিন",   # a note
                 "দুইটা স্যুপ দিন",                          # which soup?
                 "ক্রিস্পি রাইস স্যুপ কেমন?",                  # a question
                 "ভাইস ঠিক স্যুপ দুইটা দেন"):                 # a word we can't place
        _, calls = run(said, {"replyText": "…"})
        assert calls, said
    # a size to pick → no model either: it's held and asked about (Half or Full?), never guessed
    out, calls = run("একটা কাচ্চি বিরিয়ানি দেন", {"replyText": "…"})
    assert not calls and ops_of(out) == [] and "Half" in out["replyText"] and "Full" in out["replyText"], out["replyText"]
    # already in the tray → the model (it asks "add more, making 3?")
    _, calls = run("দুইটা ক্রিস্পি রাইস স্যুপ দিন", {"replyText": "…"}, cart=[{"itemId": "crs", "quantity": 1, "price": 300}])
    assert calls


def test_small_to_large_is_really_done():
    # the real turns: "স্মল না, তুমি আমাকে বড়টা দাও।" / "মিনারেল ওয়াটার ছোটটা না দিয়ে আমাকে বড়টা দাও।" → the model
    # said "মিনারেল ওয়াটার বড় সাইজে বদলে দিলাম" with NO cart change
    tray = [{"itemId": "mws", "quantity": 2, "price": 15}, {"itemId": "crs", "quantity": 1, "price": 300}]
    lie = {"cartOps": [], "replyText": "মিনারেল ওয়াটার বড় সাইজে বদলে দিলাম। আর কিছু লাগবে?"}
    for said in ("স্মল না, তুমি আমাকে বড়টা দাও।", "মিনারেল ওয়াটার ছোটটা না দিয়ে আমাকে বড়টা দাও।"):
        out, calls = run(said, lie, cart=tray)
        assert not calls, "done exactly, no model"
        ops = [(o["op"], o["itemId"], o.get("quantity")) for o in out["meta"]["cartOps"]]
        assert ops == [("remove", "mws", None), ("add", "mwl", 2)], (said, ops)  # the same 2, now large
        assert "Mineral Water (large)" in out["replyText"], out["replyText"]
    # a real size option (Half → Full) on the dish itself
    out, _ = run("হাফ না, ফুলটা দিন", {"replyText": "…"}, cart=[{"itemId": "kb", "quantity": 1, "price": 450, "variation": "Half"}])
    assert [(o["op"], o.get("variant")) for o in out["meta"]["cartOps"]] == [("edit", "Full")], out["meta"]["cartOps"]


def test_never_claims_a_change_that_didnt_happen():
    tray = [{"itemId": "crs", "quantity": 1, "price": 300}]
    out, _ = run("এটা একটু বদলে দাও", {"cartOps": [], "replyText": "বদলে দিলাম। আর কিছু লাগবে?"}, cart=tray)
    assert "বদলে দিলাম" not in out["replyText"] and "বুঝতে পারিনি" in out["replyText"], out["replyText"]
    assert "false_change_claim_replaced" in out["meta"]["guards"]


def test_the_listening_hint_leads_with_the_dishes_just_named():
    import server
    server._STT_NAMES[("t1", "bn")] = [("Thai Thick Soup", "থাই থিক স্যুপ"), ("Crispy Rice Soup", "ক্রিস্পি রাইস স্যুপ"),
                                        ("French Fry", "ফ্রেঞ্চ ফ্রাই")]
    orig = server.get_history
    server.get_history = lambda tenant, session: [
        {"role": "user", "content": "স্যুপ কী আছে?"},
        {"role": "assistant", "content": "স্যুপ আইটেমের মধ্যে Thai Thick Soup অথবা Crispy Rice Soup খুবই ভালো।"},
    ]
    try:
        hint = server.stt_turn_hint("t1", "s1", "bn")
        assert hint == "থাই থিক স্যুপ, ক্রিস্পি রাইস স্যুপ", hint
        assert server.stt_turn_hint("t1", None, "bn") == ""
        server.get_history = lambda tenant, session: [{"role": "assistant", "content": "হ্যালো! কী খাবেন?"}]
        assert server.stt_turn_hint("t1", "s1", "bn") == ""  # nothing named → nothing added
    finally:
        server.get_history = orig


def test_a_word_we_cant_place_is_never_guessed_into_the_tray():
    # the real turn: "না, আরেকটি ছোলাক বানাও।" → the model added another soup (it guessed what "ছোলাক" was)
    tray = [{"itemId": "crs", "quantity": 1, "price": 300}]
    guess = {"cartOps": [{"op": "add", "item": ref("crs"), "quantity": 1}],
             "replyText": "আরেকটা ক্রিস্পি রাইস স্যুপ যোগ করলাম। আর কিছু লাগবে?"}
    out, _ = run("না, আরেকটি ছোলাক বানাও।", guess, cart=tray)
    assert ops_of(out) == [], out["meta"]["cartOps"]
    assert out["replyText"] == "দুঃখিত, স্পষ্ট শুনতে পারিনি। আরেকবার বলবেন, প্লিজ?", out["replyText"]
    # plain words only → "another one" means the last dish, still added
    for said in ("আরেকটা দিন", "ওটাই আরেকটা বানিয়ে দিন প্লিজ", "same one again please"):
        out, _ = run(said, guess, cart=tray)
        assert ops_of(out) == [("add", "crs", 1)], (said, out["meta"]["cartOps"], out["replyText"])
    # the dish named (or misheard close to its name) → added
    out, _ = run("আরেকটা ক্রিস্পি রাইস স্যুপ দাও তো ভাই", guess, cart=tray)
    assert ops_of(out) == [("add", "crs", 1)], out["meta"]["cartOps"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
