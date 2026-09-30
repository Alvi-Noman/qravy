"""Offline tests for checkout: intent understanding, table capture, the stage machine, and the brain's two-step
read-back → yes → place contract.  Run: python tests/test_checkout.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import checkout as co  # noqa: E402

ITEMS = [
    {"id": "a1", "name": "Spring Roll", "price": 230, "category": "Appetizer"},
    {"id": "s2", "name": "Chicken Corn Soup", "price": 300, "category": "Soup"},
    {"id": "kb", "name": "Kacchi Biryani", "price": 420, "category": "Biryani",
     "variations": [{"name": "Half", "price": 420}, {"name": "Full", "price": 780}]},
    {"id": "bh", "name": "Borhani", "price": 90, "category": "Drinks", "tags": ["drink"]},
]
TURN = {
    "topic": "other", "intent": "chitchat", "language": "en", "mentionedItems": [], "cartOps": [],
    "clearCart": False, "confirmOrder": False, "checkout": "none", "serviceRequest": None, "suggestions": [],
    "voiceReplyText": "",
}
CART = [{"itemId": "a1", "quantity": 2, "price": 230}]


def _run(text, *, cart=CART, table="12", state=None, history=None, model=None, locale=None, channel=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(model or {**TURN, "replyText": "Sure."})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        ctx = {"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"]}
        if table:
            ctx["table"] = table
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": ITEMS}, context=ctx, history=history,
                                               dialog_state=state, locale=locale, channel=channel))
    finally:
        brain._call_openai = orig
    return out, calls


# ------------------------------------------------------------------ understanding


def test_wants_checkout_in_every_language():
    for t in ["place my order", "Please place the order", "checkout", "check out please", "I'm ready to order",
              "go ahead and order it", "send the order", "confirm my order", "we're done ordering",
              "অর্ডারটা দিয়ে দিন", "অর্ডার কনফার্ম করুন", "অর্ডার দিতে চাই", "চেক আউট", "order diye den",
              "order kore den plz", "order confirm"]:
        assert co.wants_checkout(t), t
    for t in ["can I order later?", "don't place the order yet", "what's in the order?", "how do I pay?",
              "অর্ডার এখন দেব না", "order pore dibo", "is the soup spicy?", "bill please", "wait, not yet"]:
        assert not co.wants_checkout(t), t


def test_done_and_hold_and_yes():
    for t in ["that's all", "No, that's it", "nothing else", "আর কিছু লাগবে না", "এটুকুই", "ar kichu lagbe na"]:
        assert co.is_done(t), t
    for t in ["no", "wait", "hold on", "not yet", "না", "এখন না", "দাঁড়ান", "ekhon na", "one sec"]:
        assert co.wants_to_hold(t), t
    for t in ["yes", "Yes please", "yeah go ahead", "ok", "place it", "হ্যাঁ", "জি", "হ্যাঁ দিন", "ঠিক আছে", "দিয়ে দিন"]:
        assert co.says_yes(t), t
    for t in ["yes?", "is it ready?", "no", "yes but wait", "not yet"]:
        assert not co.says_yes(t), t


def test_table_from_text():
    assert co.table_from_text("we're at table 12") == "12"
    assert co.table_from_text("টেবিল ১২") == "12"
    assert co.table_from_text("12 number table") == "12"
    assert co.table_from_text("table A3") == "A3"
    assert co.table_from_text("table five") == "5"
    assert co.table_from_text("12") is None                       # a bare number only when we asked
    assert co.table_from_text("12", expecting=True) == "12"
    assert co.table_from_text("৭ নম্বর", expecting=True) == "7"
    assert co.table_from_text("12 spring rolls", expecting=True) is None


def test_signature_is_about_what_is_ordered():
    a = [{"itemId": "kb", "quantity": 1, "variation": "Full", "modifiers": [{"name": "Extra egg", "optionId": "o1"}]}]
    b = [{"itemId": "kb", "quantity": 1, "variation": "full", "modifiers": [{"name": "Extra Egg"}], "notes": "mild"}]
    assert co.cart_signature(a) == co.cart_signature(b)
    assert co.cart_signature(a) != co.cart_signature([{**a[0], "quantity": 2}])
    assert co.cart_signature(a) != co.cart_signature([{**a[0], "variation": "Half"}])


def test_stage_machine():
    base = dict(stored_signature="s", signature_now="s", cart_nonempty=True, table="12", llm_checkout="none",
                asked_to_confirm=False, cart_changed_this_turn=False, cleared=False)
    assert co.decide(text="yes", stage="readback", **base)[0] == "place"
    assert co.decide(text="হ্যাঁ দিন", stage="readback", **base)[0] == "place"
    assert co.decide(text="is it spicy?", stage="readback", **base)[0] == "stay"
    assert co.decide(text="wait", stage="readback", **base)[0] == "hold"
    assert co.decide(text="yes", stage="readback", **{**base, "signature_now": "other"})[0] == "readback"
    assert co.decide(text="yes", stage="readback", **{**base, "table": None})[0] == "ask_table"
    assert co.decide(text="place my order", stage="none", **base)[0] == "place"      # explicit: no read-back
    assert co.decide(text="place my order", stage="none", **{**base, "cart_changed_this_turn": True})[0] == "readback"
    assert co.decide(text="place my order", stage="none", **{**base, "table": None})[0] == "ask_table"
    assert co.decide(text="place my order", stage="none", **{**base, "cart_nonempty": False})[0] == "empty"
    assert co.decide(text="yes", stage="none", **{**base, "asked_to_confirm": True})[0] == "readback"
    assert co.decide(text="yes", stage="none", **base)[0] == "stay"                  # yes to what?
    assert co.decide(text="that's all", stage="none", **base)[0] == "readback"
    assert co.decide(text="that's all", stage="none", defer_done=True, **base)[0] == "stay"  # drink offer first
    assert co.decide(text="12", stage="table", **base)[0] == "readback"
    assert co.decide(text="12", stage="table", direct_pending=True, **base)[0] == "place"  # they already said "send it"
    # "এগুলো দেন" is the tray — unless a list of dishes is on screen (then it means "add those")
    assert co.decide(text="এগুলো দেন", stage="none", **base)[0] == "place"
    assert co.decide(text="এগুলো দেন", stage="none", list_on_screen=True, **base)[0] == "stay"
    assert co.decide(text="what's the wifi", stage="table", **{**base, "table": None})[0] == "stay"
    # the model's reading counts, but never for a question
    assert co.decide(text="let's do it", stage="none", **{**base, "llm_checkout": "start"})[0] == "readback"
    assert co.decide(text="can I order now?", stage="none", **{**base, "llm_checkout": "start"})[0] == "stay"
    assert co.decide(text="sounds good", stage="readback", **{**base, "llm_checkout": "confirm"})[0] == "place"
    assert co.decide(text="clear it all", stage="readback", **{**base, "cleared": True})[0] == "reset"


# ------------------------------------------------------------------ the brain's contract


def test_send_it_places_straight_away_without_reading_prices():
    for said, locale in (("place my order", None), ("send it to the kitchen", None), ("অর্ডারটা কনফার্ম করেন", "bn"),
                         ("এগুলো দেন", "bn"), ("খাবারগুলো পাঠায় দেন", "bn"), ("খাবার সার্ভ করেন", "bn"),
                         ("order ta confirm koren", None), ("khabar gulo pathay den", None)):
        out, calls = _run(said, locale=locale)
        assert not calls, said  # deterministic, no model call
        assert out["meta"]["decision"].get("placeOrder") is True, said
        assert "৳" not in out["replyText"], said
        assert out["meta"]["orderDraft"]["table"] == "12", said
    # a question or a "not yet" never places
    for said in ("can you send it to the kitchen?", "don't place my order yet", "অর্ডার এখন না"):
        out, _ = _run(said)
        assert not out["meta"]["decision"].get("placeOrder"), said


def test_full_flow_readback_then_yes_places():
    # a softer signal — "yes" to "anything else, or shall I confirm?" — gets a short check: dishes, no prices
    out, calls = _run("yes", history=[{"role": "assistant", "content": "Added 2 × Spring Roll. Anything else, or shall I confirm your order?"}])
    assert not calls  # deterministic, no model call
    d = out["meta"]["decision"]
    assert d.get("showCheckout") and not d.get("placeOrder")
    assert out["replyText"] == "2 × Spring Roll — shall I place the order?"
    state = {"checkout": out["meta"]["checkout"]}
    out2, _ = _run("yes", state=state, history=[{"role": "assistant", "content": out["replyText"]}])
    assert out2["meta"]["decision"].get("placeOrder") is True
    assert out2["meta"]["orderDraft"] == {"table": "12", "items": [{"itemId": "a1", "qty": 2}],
                                          "signature": co.cart_signature(CART), "expectedTotal": 460}


def test_nothing_is_placed_without_the_guests_own_clear_words():
    # an empty tray never places
    out, _ = _run("confirm my order", cart=[])
    assert not out["meta"]["decision"].get("placeOrder")
    # the model claiming "confirm" out of nowhere never places
    out, _ = _run("great, sounds good", model={**TURN, "checkout": "confirm", "replyText": "Your order is placed!"})
    assert not out["meta"]["decision"].get("placeOrder") and "placed" not in out["replyText"]


def test_cart_changed_during_readback_reads_back_again():
    out, _ = _run("yes", history=[{"role": "assistant", "content": "Anything else, or shall I confirm your order?"}])
    assert out["meta"]["checkout"]["stage"] == "readback"
    state = {"checkout": out["meta"]["checkout"]}
    # the guest added a drink in the UI before saying yes
    out2, _ = _run("yes", cart=CART + [{"itemId": "bh", "quantity": 1, "price": 90}], state=state,
                   history=[{"role": "assistant", "content": out["replyText"]}])
    assert not out2["meta"]["decision"].get("placeOrder") and out2["meta"]["decision"].get("showCheckout")
    assert "Borhani" in out2["replyText"]
    # …and by voice: "add a Borhani" during the read-back → added + read back again
    add = {**TURN, "topic": "order_change", "intent": "order", "replyText": "Added a Borhani.",
           "cartOps": [{"op": "add", "item": brain.MenuIndex(ITEMS).ref(ITEMS[3]), "quantity": 1, "note": "",
                        "choices": [], "variant": ""}]}
    out3, _ = _run("add one Borhani too", state=state, model=add)
    assert out3["meta"]["decision"].get("showCheckout") and not out3["meta"]["decision"].get("placeOrder")
    assert out3["replyText"].startswith("Added 1 × Borhani") and "shall I place the order?" in out3["replyText"]


def test_no_wait_keeps_the_cart():
    out, _ = _run("yes", history=[{"role": "assistant", "content": "Anything else, or shall I confirm your order?"}])
    out2, _ = _run("wait", state={"checkout": out["meta"]["checkout"]})
    assert out2["meta"]["checkout"]["stage"] == "none" and out2["meta"]["cartOps"] == []
    assert not out2["meta"]["clearCart"] and "won't place" in out2["replyText"]


def test_asks_for_table_then_continues():
    out, _ = _run("place my order", table=None)
    assert out["meta"]["decision"].get("askTable") and "table" in out["replyText"].lower()
    # they already said "place my order" — the table was all that was missing
    out2, _ = _run("12", table=None, state={"checkout": out["meta"]["checkout"]})
    assert out2["meta"]["decision"].get("placeOrder") is True
    assert out2["meta"]["orderDraft"]["table"] == "12"


def test_a_misheard_table_is_asked_again_never_guessed():
    # the real turns: "অর্ডার কনফার্ম করেন" → which table? → "মারুক" (a mishearing of "বারো") → "বারো নম্বর টেবিল"
    out, _ = _run("অর্ডার কনফার্ম করেন", table=None, locale="bn")
    assert out["meta"]["decision"].get("askTable")
    out2, calls = _run("মারুক", table=None, locale="bn", state={"checkout": out["meta"]["checkout"]},
                       model={**TURN, "replyText": "আপনার অর্ডারটি টেবিল মারুক এর জন্য প্রস্তুত রাখা হবে।"})
    assert not calls and "মারুক" not in out2["replyText"] and "টেবিল নম্বরটা" in out2["replyText"]
    assert out2["meta"]["checkout"]["stage"] == "table"
    out3, _ = _run("বারো নম্বর টেবিল", table=None, locale="bn", state={"checkout": out2["meta"]["checkout"]})
    assert out3["meta"]["decision"].get("placeOrder") is True and out3["meta"]["orderDraft"]["table"] == "12"


def test_a_failed_order_never_reads_out_a_technical_error():
    for msg in ("Validation failed.", "HTTP 500.", ""):
        assert "Validation" not in co.failed_text(msg, "bn") and "স্টাফ" in co.failed_text(msg, "bn")
    # a guest-friendly reason from the restaurant is still said
    assert "Kacchi Biryani isn't served for dine-in." in co.failed_text("Kacchi Biryani isn't served for dine-in.", "en")


def test_online_never_asks_for_a_table_or_places_by_voice():
    # pickup / delivery guests finish on the form (name, phone, address) — no table, nothing placed by voice
    out, calls = _run("place my order", table=None, channel="online")
    assert not calls
    d = out["meta"]["decision"]
    assert d.get("showCheckout") and d.get("askDetails") and not d.get("askTable") and not d.get("placeOrder")
    assert "table" not in out["replyText"].lower() and "counter" not in out["replyText"].lower()
    assert "2 × Spring Roll" in out["replyText"] and "name and phone" in out["replyText"]
    assert out["meta"]["checkout"]["stage"] == "none"
    # "yes" afterwards still doesn't place — the Place order button on the form does
    out2, _ = _run("yes", table=None, channel="online", state={"checkout": out["meta"]["checkout"]},
                   history=[{"role": "assistant", "content": "Shall I confirm it?"}])
    assert not out2["meta"]["decision"].get("placeOrder") and not out2["meta"]["decision"].get("askTable")
    # Bangla
    out3, _ = _run("অর্ডারটা দিয়ে দিন", table=None, channel="online", locale="bn")
    assert out3["meta"]["decision"].get("askDetails") and "টেবিল" not in out3["replyText"]


def test_bangla_checkout():
    out, _ = _run("অর্ডারটা দিয়ে দিন", locale="bn")
    assert out["meta"]["decision"].get("placeOrder") is True
    # "হ্যাঁ" to "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" → a short check, then "হ্যাঁ" places
    out, _ = _run("হ্যাঁ", locale="bn", history=[{"role": "assistant", "content": "যোগ করলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"}])
    assert out["replyText"] == "2 × Spring Roll — অর্ডারটা দিয়ে দেব?"
    out2, _ = _run("হ্যাঁ", locale="bn", state={"checkout": out["meta"]["checkout"]})
    assert out2["meta"]["decision"].get("placeOrder") is True


def test_sizes_and_addons_travel_with_the_order():
    cart = [{"itemId": "kb", "quantity": 1, "price": 830, "variation": "Full",
             "modifiers": [{"groupId": "g1", "optionId": "o9", "name": "Extra Egg", "price": 50}], "notes": "less oil"}]
    # the short check names the size, add-ons and note…
    out, _ = _run("yes", cart=cart, history=[{"role": "assistant", "content": "Anything else, or shall I confirm your order?"}])
    assert "Kacchi Biryani (Full, Extra Egg)" in out["replyText"] and "less oil" in out["replyText"]
    # …and "checkout" sends them all to the kitchen
    out2, _ = _run("checkout", cart=cart)
    assert out2["meta"]["orderDraft"]["items"] == [
        {"itemId": "kb", "qty": 1, "variation": "Full", "modifiers": [{"groupId": "g1", "optionId": "o9"}], "notes": "less oil"}
    ]


def test_added_but_said_not_on_menu_is_corrected():
    # live eval: the model added Beef Sizzling but said "এখন মেনুতে নেই" (not on the menu now)
    idx = brain.MenuIndex(ITEMS)
    bad = {**TURN, "topic": "order_change", "intent": "order", "language": "bn",
           "replyText": "Borhani এখন মেনুতে নেই, কিন্তু Spring Roll নিতে পারেন।",
           "cartOps": [{"op": "add", "item": idx.ref(ITEMS[3]), "quantity": 1, "note": "", "choices": [], "variant": ""}]}
    out, _ = _run("একটা Borhani দিন", cart=[], model=bad, locale="bn")
    assert out["meta"]["cartOps"][0]["itemId"] == "bh"
    assert "মেনুতে নেই" not in out["replyText"] and "Borhani" in out["replyText"]
    # any phrasing, not a word list: "উপলব্ধ নেই", "isn't available today", "we don't have …"
    for said in ["Borhani এখন উপলব্ধ নেই।", "Sorry, Borhani isn't available today.", "We don't have Borhani right now."]:
        assert brain._contradicts_adds(said, ["Borhani"]) == ["Borhani"], said
    # a normal confirmation, or a "no" about something else in another sentence, is fine
    assert brain._contradicts_adds("1 × Borhani যোগ করা হলো। পেঁয়াজ নেই এমন কিছু?", ["Borhani"]) == []
    assert brain._contradicts_adds("Added a Borhani. Anything else?", ["Borhani"]) == []


def test_invented_order_status_is_never_spoken():
    # live: "কি খাও যেতে ভারে…" (what can I eat?) → model: "আপনার অর্ডার নেওয়া হয়েছে" (order taken) — false
    for claim in ["আপনার অর্ডার নেওয়া হয়েছে। আর কিছু সাহায্য লাগবে?", "আপনার অর্ডার বাতিল করা হলো।",
                  "অর্ডারটি সফলভাবে গ্রহণ করা হয়েছে।", "অর্ডারটা পাঠিয়ে দিয়েছি।", "Your order has been taken!",
                  "I've placed your order.", "Your order was cancelled."]:
        assert brain._CLAIMS_CONFIRMED.search(claim), claim
    for fine in ["Spring Roll যোগ করা হলো।", "অর্ডারটা দিয়ে দেব?", "Shall I place your order?", "নোট যোগ করেছি।",
                 "Ordering is available until 11pm."]:
        assert not brain._CLAIMS_CONFIRMED.search(fine), fine
    lie = {**TURN, "topic": "other", "language": "bn", "replyText": "আপনার অর্ডার নেওয়া হয়েছে। আর কিছু সাহায্য লাগবে?"}
    honest = {**TURN, "topic": "recommendation", "language": "bn",
              "replyText": "আমাদের Chicken Corn Soup আর Borhani খুব ভালো। কোনটা নেবেন?"}  # (Spring Roll is in the tray)
    seq = [lie, honest]

    async def fake(messages):
        return json.dumps(seq.pop(0) if seq else honest)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply("কি খাও যেতে ভারে আপন দেরিখা নেমাস", menu_snapshot={"items": ITEMS},
                                               context={"cartItems": CART, "table": "12"}, locale="bn"))
    finally:
        brain._call_openai = orig
    assert "false_order_status_claim" in out["meta"]["guards"]
    assert "নেওয়া হয়েছে" not in out["replyText"] and "Chicken Corn Soup" in out["replyText"]
    # the model insists → the final net replaces it with the honest cart question
    seq2 = [lie, lie]

    async def fake2(messages):
        return json.dumps(seq2.pop(0) if seq2 else lie)

    brain._call_openai = fake2
    try:
        out = asyncio.run(brain.generate_reply("কি খাও যেতে ভারে আপন দেরিখা নেমাস", menu_snapshot={"items": ITEMS},
                                               context={"cartItems": CART, "table": "12"}, locale="bn"))
    finally:
        brain._call_openai = orig
    assert "নেওয়া হয়েছে" not in out["replyText"] and "অর্ডারটা দিয়ে দেব?" in out["replyText"]


def test_generic_words_ask_which_one():
    items = ITEMS + [
        {"id": "w1", "name": "Mineral Water (small)", "price": 15, "category": "Drinks"},
        {"id": "w2", "name": "Mineral Water (large)", "price": 25, "category": "Drinks"},
        {"id": "r1", "name": "Egg Fried Rice", "price": 270, "category": "Rice"},
        {"id": "r2", "name": "Masala Fried Rice", "price": 290, "category": "Rice"},
        {"id": "p1", "name": "Special Fried Prawn", "price": 380, "category": "Prawn"},
        {"id": "p2", "name": "Thai Special Fried Rice Prawn", "price": 420, "category": "Rice"},
    ]
    idx = brain.MenuIndex(items)
    orderable = {i["id"]: True for i in items}
    by = {i["id"]: i for i in items}
    amb = lambda iid, said: [o["id"] for o in brain._ambiguous_pick(by[iid], idx, orderable, said)]  # noqa: E731
    # live: "মিনারেল ওয়াটার দেন" → small was picked silently
    assert set(amb("w1", "মিনারেল ওয়াটার দেন।")) == {"w1", "w2"}
    assert amb("w1", "ছোট মিনারেল ওয়াটার দেন") == [] and amb("w2", "বড়টা মিনারেল ওয়াটার") == []
    assert set(amb("r1", "একটা রাইস দেন")) >= {"r1", "r2"}             # "rice" → which rice?
    assert set(amb("r1", "ফ্রাইড রাইস দিন")) >= {"r1", "r2"}
    assert amb("r1", "এগ ফ্রাইড রাইস দিন") == []
    assert amb("p1", "স্পেশাল ফ্রাইড প্রন দুইটা") == []                # the full name said is never ambiguous
    assert amb("w1", "ওটা দেন") == []                                   # a reference: the model resolved it

    # end to end: the model picks "small" on its own → nothing added, the waiter asks which
    pick = {**TURN, "topic": "order_change", "intent": "order", "language": "bn",
            "replyText": "Mineral Water (small) যোগ করা হলো।",
            "cartOps": [{"op": "add", "item": idx.ref(by["w1"]), "quantity": 1, "note": "", "choices": [], "variant": ""}]}

    async def fake(messages):
        return json.dumps(pick)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply("মিনারেল ওয়াটার দেন।", menu_snapshot={"items": items}, locale="bn",
                                               context={"cartItems": [], "mealKinds": ["dinner"]}))
    finally:
        brain._call_openai = orig
    assert out["meta"]["cartOps"] == []
    assert "Mineral Water (small)" in out["replyText"] and "Mineral Water (large)" in out["replyText"]


def test_pani_asks_which_bottle_and_a_said_size_wins():
    items = ITEMS + [
        {"id": "w1", "name": "Mineral Water (small)", "price": 15, "category": "Drinks"},
        {"id": "w2", "name": "Mineral Water (large)", "price": 25, "category": "Drinks"},
    ]
    idx = brain.MenuIndex(items)

    def run(text, reply, pick):
        obj = {**TURN, "topic": "order_change", "intent": "order", "language": "bn", "replyText": reply,
               "cartOps": [{"op": "add", "item": idx.ref(next(i for i in items if i["id"] == pick)), "quantity": 1,
                            "note": "", "choices": [], "variant": ""}]}

        async def fake(messages):
            return json.dumps(obj)

        orig = brain._call_openai
        brain._call_openai = fake
        try:
            return asyncio.run(brain.generate_reply(text, menu_snapshot={"items": items}, locale="bn",
                                                    context={"cartItems": [], "mealKinds": ["dinner"]}))
        finally:
            brain._call_openai = orig

    # live: "হ্যাঁ, পানি লাগবে।" → the model added small while saying "বড়" → now: ask which
    out = run("হ্যাঁ, পানি লাগবে।", "আপনার জন্য একটা বড় Mineral Water যোগ করা হলো। আর কিছু লাগবে?", "w1")
    assert out["meta"]["cartOps"] == []
    assert "Mineral Water (small)" in out["replyText"] and "Mineral Water (large)" in out["replyText"]
    # the guest said the size → that size is added (the model's wrong pick is corrected), and it says so exactly
    out = run("বড় পানি দেন", "একটা Mineral Water যোগ করা হলো।", "w1")
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["w2"]
    assert "Mineral Water (large)" in out["replyText"] and "(small)" not in out["replyText"]
    assert out["replyText"].endswith("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?")


def test_after_adding_it_offers_to_confirm():
    assert brain._ask_anything_else_or_confirm("Spring Roll যোগ করা হলো। আর কিছু লাগবে?", "bn") == \
        "Spring Roll যোগ করা হলো। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
    assert brain._ask_anything_else_or_confirm("Spring Roll যোগ করা হলো।", "bn").endswith("নাকি অর্ডার কনফার্ম করব?")
    assert brain._ask_anything_else_or_confirm("Added a Spring Roll. Anything else?", "en") == \
        "Added a Spring Roll. Anything else, or shall I confirm your order?"
    kept = "Spring Roll যোগ করা হলো। সাথে একটা Coke নেবেন?"  # a pairing question is kept as it is
    assert brain._ask_anything_else_or_confirm(kept, "bn") == kept


def test_sessions_survive_a_restart():
    import session_ctx as sc

    class FakeColl(dict):
        def update_one(self, q, u, upsert=False):
            self[q["_id"]] = {**self.get(q["_id"], {}), **u["$set"], "_id": q["_id"]}

        def find_one(self, q):
            return self.get(q["_id"])

    store = FakeColl()
    sc.attach_store(store)
    try:
        sc.push_user("t1", "s1", "place my order")
        sc.push_assistant("t1", "s1", "Here's your order… Shall I place it?")
        sc.update_state("t1", "s1", meta={"checkout": {"stage": "readback", "sig": "abc", "table": "12"}}, user_text="x")
        # a deploy restarts the process: memory is empty again
        key = sc.skey("t1", "s1")
        sc.SESSION_CTX.pop(key, None)
        sc.SESSION_STATE.pop(key, None)
        assert sc.get_state("t1", "s1")["checkout"]["stage"] == "readback"
        assert sc.get_history("t1", "s1")[-1]["role"] == "assistant"
    finally:
        sc.attach_store(None)


def test_result_texts():
    # what the server says after auth-service answers (run_text_turn itself needs Mongo)
    assert co.placed_text({"orderNumber": 17, "table": "12", "total": 460}, "en") == "Your order is confirmed. Please sit back — it'll be served to you very soon."
    assert co.placed_text({"orderNumber": 17, "table": "12", "total": 460}, "bn") == "আপনার অর্ডার কনফার্ম করা হয়েছে। একটু অপেক্ষা করুন, খুব শীঘ্রই আপনার ফুড সার্ভ করা হবে।"
    assert "couldn't place" in co.failed_text("Spring Roll is sold out.", "en")


def test_spoken_bangla_table_numbers():
    # live: "বারো নম্বর টেবিলে বসেছিল।" → no table → the waiter claimed "confirmed" and nothing was placed
    from checkout import table_from_text as tt
    assert tt("বারো নম্বর টেবিলে বসেছিল।") == "12"
    assert tt("টেবিল বারো") == "12"
    assert tt("আমরা পঁচিশ নম্বর টেবিলে") == "25"
    assert tt("twelve number table") == "12"
    assert tt("table twenty one") == "21"
    assert tt("বারো", expecting=True) == "12"
    assert tt("বারো নম্বর", expecting=True) == "12"
    assert tt("১২ নম্বর টেবিল") == "12"
    assert tt("একটা কনফার্ম করেন।", expecting=True) is None


def test_false_confirm_claims_are_caught():
    import brain
    for r in ["আপনার অর্ডার বারো নম্বর টেবিলের জন্য কনফার্ম করলাম। ধন্যবাদ।", "অর্ডারটা দিয়ে দিলাম।",
              "I've placed your order for table 12."]:
        assert brain._CLAIMS_CONFIRMED.search(r), r
    for r in ["আপনার অর্ডারে French Fry দিয়ে দিলাম।", "অর্ডার দেওয়ার আগে বলবেন, কোন টেবিলে বসেছেন?"]:
        assert not brain._CLAIMS_CONFIRMED.search(r), r


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
