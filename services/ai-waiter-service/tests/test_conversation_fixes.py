"""Replays of real conversations (17 Oct) that went wrong — run: python -m pytest tests/test_conversation_fixes.py
  1. "না এগুলা ভালো লাগছে না। অন্য কিছু সাজেস্ট করো।" → got "এগুলোর মধ্যে সেট মেনু-6 সবচেয়ে ভালো হবে"
  2. "প্লেটার খাবো না" → got Set Menu-2 again; "…তাহলে সেট মেনু-২টা কেনো বললে?" → got a defence of it
  3. "মোজো বা ফান্টা বা কোক বা স্প্রাইট?" → "কোকের মধ্যে আছে … জুস"
  4. "কনফার্ম করো" after "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" → asked "…অর্ডারটা কনফার্ম করব?" again
  5. "এইগুলার অনেক দাম। একটু কম দামের মধ্যে সাজেস্ট করো।" → a plain "রাতের খাবারে … খুবই ভালো", no prices
  6. "সরা দইয়ের দাম কত?" → "সরা আইটেমের মধ্যে …" — never the price
  7. "বিকেলের মেনুতে কি কি পাওয়া যায়?" → opened the menu instead of suggesting for the afternoon
  8. "আপনারা কি কিছু সার্ভিস করবেন?" → called staff AND said "no way to call staff\""""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import checkout as co  # noqa: E402

ITEMS = [
    {"id": "sm2", "name": "Set Menu-2", "price": 450, "category": "Set Menu"},
    {"id": "sm3", "name": "Set Menu-3", "price": 520, "category": "Set Menu"},
    {"id": "sm5", "name": "Set Menu-5", "price": 560, "category": "Set Menu"},
    {"id": "sm6", "name": "Set Menu-6", "price": 600, "category": "Set Menu"},
    {"id": "csz", "name": "Chicken Sizzling", "price": 420, "category": "Sizzling"},
    {"id": "mwd", "name": "Masala Wedges (Spicy)", "price": 260, "category": "Appetizer"},
    {"id": "sts", "name": "Special Thai Soup", "price": 380, "category": "Soup"},
    {"id": "tcs", "name": "Thai Clear Soup", "price": 300, "category": "Soup"},
    {"id": "ccu", "name": "Cashew Curry", "price": 390, "category": "Chicken"},
    {"id": "cns", "name": "Cashew Nut Salad", "price": 350, "category": "Salad"},
    {"id": "ccf", "name": "Crispy Chicken Fry", "price": 280, "category": "Chicken"},
    {"id": "cos", "name": "Corn Soup", "price": 220, "category": "Soup"},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "wtn", "name": "Wonthon", "price": 240, "category": "Appetizer"},
    {"id": "crb", "name": "Crispy Chicken Rice bowl", "price": 290, "category": "Rice"},
    {"id": "rmj", "name": "Ripe Mango Juice", "price": 150, "category": "Drinks"},
    {"id": "gmj", "name": "Green Mango Juice", "price": 150, "category": "Drinks"},
    {"id": "kms", "name": "Kitkat Milk Shake", "price": 220, "category": "Drinks"},
    {"id": "wat", "name": "Water", "price": 30, "category": "Drinks"},
    {"id": "sdr", "name": "Soft Drinks", "price": 50, "category": "Drinks"},
    {"id": "sod", "name": "বগুড়ার বিখ্যাত সরা দই", "price": 180, "category": "মিষ্টি বিলাস"},
    {"id": "kod", "name": "বগুড়ার বিখ্যাত কাপ দই", "price": 90, "category": "মিষ্টি বিলাস"},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": ""}
FIRST_PICKS = ["sm6", "csz", "mwd", "sm5", "sts"]


def ref(i):
    return IDX.ref(IDX.by_id[i])


def run(text, model=None, *, cart=(), state=None, history=None, shown=None, kinds=("dinner",), channel=None, table="7"):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **(model or {"replyText": "MODEL"})})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        ctx = {"cartItems": [dict(c) for c in cart], "mealKinds": list(kinds), "table": table}
        if shown:
            ctx["shownItems"] = shown
        if channel:
            ctx["channel"] = channel
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": ITEMS}, locale="bn", history=history,
                                               dialog_state=state, context=ctx))
    finally:
        brain._call_openai = orig
    return out, calls


def after_suggesting(ids=FIRST_PICKS):
    """The memory after the waiter suggested these dishes (they're on the guest's screen)."""
    rstate = brain.RecoState()
    rstate.turn, rstate.last_offered, rstate.last_offer_turn = 1, list(ids), 1
    return {"reco": rstate.to_dict()}


def picked(out, calls):
    """The dishes this turn offered: the cards, or what the model was told to pick from."""
    cards = [s.get("itemId") for s in out["meta"].get("suggestions") or []]
    return cards, (calls[-1][-1]["content"] if calls else "")


def test_1_none_of_these_gets_other_dishes_not_the_best_of_these():
    out, calls = run("না এগুলা ভালো লাগছে না। তুমি অন্য কিছু সাজেস্ট করো।",
                     {"replyText": "তাহলে Cashew Curry বা Crispy Chicken Fry নিতে পারেন।",
                      "suggestions": [{"item": ref("ccu"), "reason": "x"}, {"item": ref("ccf"), "reason": "y"}]},
                     state=after_suggesting(), shown=FIRST_PICKS)
    assert "এগুলোর মধ্যে" not in out["replyText"] and "compare_answer_replaced" not in out["meta"]["guards"], out["replyText"]
    assert set(out["meta"]["reco"]["profile"]["declined"]) >= set(FIRST_PICKS)
    cards, block = picked(out, calls)
    assert not set(cards) & set(FIRST_PICKS)
    picks_block = block.split("RANKED PICKS", 1)[-1]
    assert not any(IDX.by_id[i]["name"] in picks_block.split("\n(Reasons")[0] for i in FIRST_PICKS), picks_block[:400]


def test_2_no_platter_means_no_set_menu_and_a_why_gets_an_apology_first():
    out, calls = run("না, প্লেটার খাবো না, অন্য কিছু দিয়ে পেট ভরবো।", {"replyText": "MODEL"},
                     state=after_suggesting(["sm6", "sm5", "ccu"]))
    declined = set(out["meta"]["reco"]["profile"]["declined"])
    assert {"sm2", "sm3", "sm5", "sm6"} <= declined, declined
    picks_block = calls[-1][-1]["content"].split("RANKED PICKS", 1)[-1].split("\n(Reasons")[0]
    assert "Set Menu" not in picks_block, picks_block
    # the next turn: "…তাহলে তুমি সেট মেনু-২টা কেনো বললে?" → told to apologise and own it, not defend the dish
    _, calls = run("আমি বলছি যে প্লেটার খাবো না, তাহলে তুমি সেট মেনু-2টা কেনো বললে? কেনো সাজেস্ট করলে আমাকে?",
                   {"replyText": "MODEL"}, state={"reco": out["meta"]["reco"]})
    block = calls[-1][-1]["content"]
    assert "THE GUEST IS UNHAPPY WITH YOUR LAST SUGGESTION" in block and "apology" in block


def test_3_drink_brands_are_answered_as_brands_not_as_a_kind_of_coke():
    out, calls = run("কোনো ভেরিয়েন্ট নাই মোজো বা ফান্টা বা কোক বা স্প্রাইট?", {"replyText": "MODEL"})
    assert "কোকের মধ্যে" not in out["replyText"]
    assert calls, "the model answers it, with the facts"
    block = calls[-1][-1]["content"]
    assert "DRINK BRANDS ASKED" in block and "Soft Drinks" in block and "Never call a juice or shake a kind of Coke" in block


def test_4_confirm_after_shall_i_confirm_is_the_confirmation():
    for said in ("কনফার্ম করো.", "হ্যাঁ", "অর্ডার কনফার্ম করুন"):
        action, why = co.decide(text=said, stage="none", stored_signature="", signature_now="x", cart_nonempty=True,
                                table="7", llm_checkout="none", asked_to_confirm=True, cart_changed_this_turn=False,
                                cleared=False)
        assert action == "place", (said, action, why)
    # online: the same yes opens the details form (no second "shall I confirm?")
    hist = [{"role": "user", "content": "একটা সফট ড্রিংকস অ্যাড করে দাও."},
            {"role": "assistant", "content": "একটা সফট ড্রিংকস যোগ করে দিলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"}]
    cart = [{"itemId": "sm3", "quantity": 1, "price": 520}, {"itemId": "sdr", "quantity": 1, "price": 50}]
    out, _ = run("কনফার্ম করো.", cart=cart, history=hist, channel="online", table="")
    assert "কনফার্ম করব?" not in out["replyText"], out["replyText"]
    assert out["meta"]["decision"].get("checkoutStage") == "details", out["meta"]["decision"]
    # at a table: placed
    out, _ = run("কনফার্ম করো.", cart=cart, history=hist)
    assert out["meta"]["decision"].get("placeOrder") is True and "কনফার্ম করব?" not in out["replyText"], out["replyText"]
    # "না" (nothing more) still gets the one read-back
    action, _ = co.decide(text="আর কিছু লাগবে না", stage="none", stored_signature="", signature_now="x", cart_nonempty=True,
                          table="7", llm_checkout="none", asked_to_confirm=False, cart_changed_this_turn=False, cleared=False)
    assert action == "readback"


def test_5_too_expensive_gets_cheaper_dishes_with_their_prices():
    out, _ = run("এইগুলার অনেক দাম। আমাকে একটু কম দামের মধ্যে সাজেস্ট করো।", state=after_suggesting(["sm6", "csz", "sts"]),
                 shown=["sm6", "csz", "sts"])
    text = out["replyText"]
    assert text.startswith("কম দামের মধ্যে") and "৳" in text, text
    ids = [s["itemId"] for s in out["meta"]["suggestions"]]
    assert ids and all(brain._lowest_price(IDX.by_id[i]) < 380 for i in ids), ids  # below the cheapest they saw
    assert not {"sm6", "csz", "sts"} & set(ids)
    prices = [brain._lowest_price(IDX.by_id[i]) for i in ids]
    assert prices == sorted(prices)


def test_6_a_price_question_gets_the_price():
    out, calls = run("সরা দইয়ের দাম কত?", {"replyText": "বগুড়ার বিখ্যাত সরা দই এর দাম ৳180।"})
    assert "আইটেমের মধ্যে" not in out["replyText"]
    assert calls and "৳180" in out["replyText"]


def test_7_whats_on_the_afternoon_menu_suggests_for_the_afternoon():
    out, _ = run("তোমাদের এখানে বিকেলের মেনুতে কি কি পাওয়া যায়?", kinds=("dinner",))
    assert not out["meta"]["decision"].get("openMenu"), out["replyText"]
    assert out["replyText"].startswith("বিকেলের নাস্তায়"), out["replyText"]
    assert out["meta"]["suggestions"]
    # a plain "what's on the menu?" still opens it, and a greeting isn't a meal
    plain, _ = run("মেনুতে কী আছে?")
    assert plain["meta"]["decision"].get("openMenu") is True
    assert brain._meal_period("good morning, মেনুতে কী আছে?") == ""


def test_8_a_vague_service_ask_asks_first_then_shows_the_options():
    out, calls = run("আপনারা কি কিছু সার্ভিস করবেন?")
    assert not calls and out["replyText"] == "আপনি কি ওয়েটার ডাকতে চাচ্ছেন?", out["replyText"]
    assert out["meta"]["decision"].get("chooseOptions") and not out["meta"].get("serviceRequest")
    state = {"tray": out["meta"]["tray"], "reco": out["meta"]["reco"], "checkout": out["meta"].get("checkout") or {}}
    yes, calls = run("হ্যাঁ", state=state)
    assert not calls and yes["meta"]["decision"].get("openServiceSheet") is True, yes["replyText"]
    assert "নিচে থেকে বেছে নিন" in yes["replyText"]
    no, _ = run("না", state=state)
    assert not no["meta"]["decision"].get("openServiceSheet") and "আর কিছু লাগলে বলবেন" in no["replyText"]
    online, _ = run("আপনারা কি কিছু সার্ভিস করবেন?", channel="online", table="")
    assert "অনলাইন অর্ডারে" in online["replyText"]
