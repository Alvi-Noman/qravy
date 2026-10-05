"""What part of a meal each dish plays (upsell.dish_roles — the offer engine's map of a meal, offers.py), and the offer
engine on a curry menu: one offer for the meal's biggest gap, never a chain, never the same kind twice."""
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
            text, menu_snapshot={"items": ITEMS}, locale="bn", history=history, dialog_state=state,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai = orig
    return out


def add(i):
    return {"cartOps": [{"op": "add", "item": IDX.ref(BY[i]), "quantity": 1}],
            "replyText": f"{BY[i]['name']} যোগ করলাম। আর কিছু লাগবে?"}


def state_of(out):
    return {"reco": out["meta"]["reco"], "tray": out["meta"]["tray"]}


def test_one_offer_for_the_biggest_gap_never_a_chain():
    # a curry with nothing to eat it with → the rice (with its price) instead of "anything else?" — no kinds question
    out = run("একটা বিফ উইথ রেড কারি দিন", model=add("brc"))
    reply = out["replyText"]
    assert out["meta"]["upsellOffer"]["type"] == "rice" and "Fried Rice" in reply and "(৳" in reply, reply
    assert reply.endswith("দেব?") and "আর কিছু লাগবে" not in reply and "ড্রিংকস অথবা ডেজার্ট" not in reply, reply
    # "হ্যাঁ, দুইটা" → two of what was offered, exactly
    cart = [{"itemId": "brc", "quantity": 1, "price": 420}]
    yes = run("হ্যাঁ, দুইটা দেন", state=state_of(out), cart=cart)
    rice = out["meta"]["upsellOffer"]["item_ids"][0]
    assert [(o["itemId"], o["quantity"]) for o in yes["meta"]["cartOps"]] == [(rice, 2)], yes["replyText"]
    # a drink added next → nothing to build on: the plain question, never a chain of pitches
    cart = cart + [{"itemId": rice, "quantity": 2, "price": BY[rice]["price"]}]
    out2 = run("একটা ম্যাঙ্গো লাচ্ছি দিন", state=state_of(yes), cart=cart, model=add("lassi"))
    assert out2["replyText"].endswith("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"), out2["replyText"]
    assert not out2["meta"].get("upsellOffer")


def test_the_end_of_the_meal_and_nothing_missing():
    cart = [{"itemId": i, "quantity": 1, "price": BY[i]["price"]} for i in ("brc", "cfr", "lassi")]
    end = run("এই হবে, আর কিছু না", cart=cart, model={"replyText": "ঠিক আছে।"})
    offer = end["meta"]["upsellOffer"]
    assert offer["type"] == "dessert" and offer["moment"] == "wrap_up", end["replyText"]
    assert BY[offer["item_ids"][0]]["name"] in end["replyText"] and "(৳" in end["replyText"], end["replyText"]
    # everything there → no offer at all
    full = cart + [{"itemId": "firni", "quantity": 1, "price": 120}]
    out = run("এই হবে, আর কিছু না", cart=full, model={"replyText": "ঠিক আছে।"})
    assert not out["meta"].get("upsellOffer"), out["replyText"]


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
