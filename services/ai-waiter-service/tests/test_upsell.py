"""The upsell: ONE question per visit, about kinds ("সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?"), then the guest leads."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402
import upsell  # noqa: E402

ITEMS = [
    {"id": "brc", "name": "Beef with Red Curry", "price": 420, "category": "Curry"},
    {"id": "ckm", "name": "Chicken Tikka Masala", "price": 380, "category": "Curry"},
    {"id": "cfr", "name": "Chicken Fried Rice", "price": 280, "category": "Rice"},
    {"id": "sfr", "name": "Special Fried Rice", "price": 380, "category": "Rice"},
    {"id": "nan", "name": "Butter Naan", "price": 60, "category": "Bread"},
    {"id": "bbg", "name": "Classic Beef Burger", "price": 350, "category": "Burger"},
    {"id": "ff", "name": "French Fries", "price": 150, "category": "Sides"},
    {"id": "wed", "name": "Potato Wedges", "price": 180, "category": "Sides"},
    {"id": "tts", "name": "Thai Thick Soup", "price": 310, "category": "Soup"},
    {"id": "csz", "name": "Chicken Sizzling", "price": 550, "category": "Sizzling"},
    {"id": "wat", "name": "Mineral Water", "price": 25, "category": "Drinks"},
    {"id": "coke", "name": "Coca-Cola", "price": 60, "category": "Drinks"},
    {"id": "lassi", "name": "Mango Lassi", "price": 150, "category": "Drinks"},
    {"id": "firni", "name": "Firni", "price": 120, "category": "Dessert"},
    {"id": "brw", "name": "Chocolate Brownie", "price": 220, "category": "Dessert"},
    {"id": "cof", "name": "Cappuccino", "price": 200, "category": "Coffee"},
]
BY = {i["id"]: i for i in ITEMS}
IDX = brain.MenuIndex(ITEMS)


def roles(i):
    return {k for k, v in upsell.dish_roles(BY[i]).items() if v}


def test_what_part_of_a_meal_each_dish_is():
    assert "drink" in roles("coke") and "drink" in roles("lassi") and "drink" in roles("cof")
    assert "dessert" in roles("firni") and "dessert" in roles("brw")
    assert "main" in roles("brc") and "rice" in roles("cfr") and "handheld" in roles("bbg")
    assert "drink" not in roles("bbg")  # "Classic" contains "lassi"


def test_what_to_ask_about():
    def ask(*ids, kinds=("dinner",)):
        return upsell.missing_kinds([BY[i] for i in ids], ITEMS, {}, lambda it: it["id"], kinds)

    assert ask("brc") == ["drink", "dessert"]
    assert ask("brc", "coke") == ["dessert"]                      # a drink is there → dessert only
    assert ask("brc", "firni") == ["drink"]
    assert ask("brc", "coke", "firni") == []                      # nothing missing → nothing asked
    assert ask("tts") == ["drink"]                                # a soup alone: no dessert push
    assert ask("brc", kinds=("breakfast",)) == ["drink"]          # no dessert at breakfast
    assert ask("cof") == [] and ask("firni") == []                # a coffee / a dessert alone is the order
    # the menu can't serve it now → not asked
    no_sweets = {"firni": False, "brw": False}
    assert upsell.missing_kinds([BY["brc"]], ITEMS, no_sweets, lambda it: it["id"], ["dinner"]) == ["drink"]


def test_wording():
    assert upsell.question(["drink", "dessert"], "bn") == "সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?"
    assert upsell.question(["drink"], "bn") == "সাথে কি কোনো ড্রিংকস নিবেন?"
    assert upsell.question(["dessert"], "en") == "Would you like any dessert with that?"
    r = "1টা Beef with Red Curry যোগ করলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
    assert upsell.swap_closing(r, ["drink", "dessert"], "bn") == \
        "1টা Beef with Red Curry যোগ করলাম। সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?"
    # made here first, then the ready-made ones; no praise
    drinks = upsell.kind_items("drink", ITEMS, {}, lambda it: it["id"])
    assert [d["id"] for d in drinks][:2] == ["lassi", "cof"] and drinks[-1]["id"] == "wat", [d["id"] for d in drinks]
    text = upsell.listing([("drink", drinks[:3])], "bn")
    assert text == "ড্রিংকসের মধ্যে আছে Mango Lassi, Cappuccino অথবা Coca-Cola — কোনটা দেব?", text


def run(text, state=None, cart=(), model=None, history=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [],
                           "clearCart": False, "confirmOrder": False, "checkout": "none", "understood": True,
                           "answerItems": [], "serviceRequest": None, "suggestions": [], "voiceReplyText": "",
                           "replyText": "", **(model or {})})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="bn", history=history, dialog_state={"reco": state} if state else None,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai = orig
    return out


def add(i):
    return {"cartOps": [{"op": "add", "item": IDX.ref(BY[i]), "quantity": 1}],
            "replyText": f"{BY[i]['name']} যোগ করলাম। আর কিছু লাগবে?"}


def test_asked_once_about_kinds_never_a_chain():
    out = run("একটা বিফ উইথ রেড কারি দিন", model=add("brc"))
    assert out["replyText"].endswith("সাথে কি কোনো ড্রিংকস অথবা ডেজার্ট নিবেন?"), out["replyText"]
    assert "আর কিছু লাগবে" not in out["replyText"] and not out["meta"]["upsell"]  # no dish pushed by name
    state = out["meta"]["reco"]
    assert state["upsell_asked"] is True
    # the next add: the plain question — never a second pitch
    out2 = run("একটা চিকেন ফ্রাইড রাইস দিন", state=state, model=add("cfr"), cart=[{"itemId": "brc", "quantity": 1, "price": 420}])
    assert out2["replyText"].endswith("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"), out2["replyText"]
    # a drink already in the tray → dessert only
    out3 = run("একটা বিফ উইথ রেড কারি দিন", model=add("brc"), cart=[{"itemId": "coke", "quantity": 1, "price": 60}])
    assert out3["replyText"].endswith("সাথে কি কোনো ডেজার্ট নিবেন?"), out3["replyText"]
    # nothing missing → the plain question
    cart = [{"itemId": i, "quantity": 1, "price": BY[i]["price"]} for i in ("coke", "firni")]
    out4 = run("একটা বিফ উইথ রেড কারি দিন", model=add("brc"), cart=cart)
    assert out4["replyText"].endswith("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"), out4["replyText"]


def test_the_guest_leads_after_the_question():
    first = run("একটা বিফ উইথ রেড কারি দিন", model=add("brc"))
    state = first["meta"]["reco"]
    history = [{"role": "user", "content": "একটা বিফ উইথ রেড কারি দিন"}, {"role": "assistant", "content": first["replyText"]}]
    cart = [{"itemId": "brc", "quantity": 1, "price": 420}]
    silent = {"replyText": "ঠিক আছে।"}

    # "হ্যাঁ" → what we have, both kinds, as cards — never "confirm the order"
    out = run("হ্যাঁ", state=state, cart=cart, history=history, model=silent)
    assert out["replyText"].startswith("ড্রিংকসের মধ্যে আছে") and "ডেজার্টের মধ্যে আছে" in out["replyText"], out["replyText"]
    assert out["replyText"].endswith("কোনটা দেব?") and out["meta"]["suggestions"], out["replyText"]
    assert (out["meta"].get("checkout") or {}).get("stage") in (None, "none")
    # "ড্রিংকসের মধ্যে কি কি আছে?" → the drinks only
    out = run("ড্রিংকসের মধ্যে কি কি আছে?", state=state, cart=cart, history=history, model=silent)
    assert out["replyText"].startswith("ড্রিংকসের মধ্যে আছে") and "ডেজার্ট" not in out["replyText"], out["replyText"]
    # "ডেজার্ট" → the desserts
    out = run("ডেজার্ট", state=state, cart=cart, history=history, model=silent)
    assert out["replyText"].startswith("ডেজার্টের মধ্যে আছে"), out["replyText"]
    # "না" → shall I confirm? (and nothing more is pushed)
    out = run("না", state=state, cart=cart, history=history, model=silent)
    assert out["replyText"] == "ঠিক আছে! তাহলে অর্ডারটা কনফার্ম করব?", out["replyText"]
    # a dish named → just the usual order flow
    out = run("একটা ম্যাঙ্গো লাচ্ছি দিন", state=state, cart=cart, history=history, model=add("lassi"))
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["lassi"], out["replyText"]
    # "না, কনফার্ম করুন" → straight to the read-back
    out = run("না, কনফার্ম করুন", state=state, cart=cart, history=history, model=silent)
    assert out["meta"]["checkout"]["stage"] == "readback", out["replyText"]


def test_suggestions_never_repeat_what_is_in_the_tray():
    # the real complaint: a dish added (after its description), then "কী ভালো হবে?" → it was recommended again
    cart = [{"itemId": "brc", "quantity": 1, "price": 420}, {"itemId": "csz", "quantity": 1, "price": 550}]
    out = run("আর কী ভালো হবে?", cart=cart, model={"topic": "recommendation", "intent": "suggestions",
                                                   "replyText": "Chicken Tikka Masala ট্রাই করতে পারেন।"})
    ids = [s["itemId"] for s in out["meta"]["suggestions"]]
    assert ids and not {"brc", "csz"} & set(ids), (ids, out["replyText"])
    assert "Beef with Red Curry" not in out["replyText"] and "Chicken Sizzling" not in out["replyText"], out["replyText"]
    out = run("ভালো কী আছে আপনাদের?", cart=cart)
    assert not {"brc", "csz"} & {s["itemId"] for s in out["meta"]["suggestions"]}, out["replyText"]
    assert "Beef with Red Curry" not in out["replyText"], out["replyText"]
    # …but asked about it by name, it's answered
    import recommender
    picks, blocked = recommender.rank(IDX, {}, ["dinner"], recommender.GuestProfile(), exclude={"brc"})
    assert "brc" not in [p.item["id"] for p in picks] and "already in the guest's tray" in blocked["brc"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
