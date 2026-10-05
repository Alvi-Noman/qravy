"""THE offer engine (offers.py): one offer decided in one place, for the meal's biggest gap, said with a reason and a
price, "হ্যাঁ" adds it — and the model's own pitches never reach the guest. (Real turn, 2026-10-05: "কোকা-কোলা।" →
"একটা কোকা-কোলা যোগ করলাম। সাথে ক্লাসিক ফ্রাইজ নিলে দারুণ হবে… সাথে কি কোনো ডেজার্ট নিবেন?" + three cards.)"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402
import offers  # noqa: E402
from recommender import GuestProfile, OrderStats  # noqa: E402

EXTRAS = {"id": "extras", "name": "Extra toppings", "min": 0, "max": 4,
          "options": [{"id": "cheese", "name": "Extra cheese", "price": 40}, {"id": "egg", "name": "Fried egg", "price": 30}]}
MEAL = {"id": "meal", "name": "Make it a meal", "min": 0, "max": 1,
        "options": [{"id": "meal", "name": "Fries + soft drink", "price": 150}]}
SPICE = {"id": "spice", "name": "Spice level", "min": 1, "max": 1, "options": [
    {"id": "regular", "name": "Regular", "price": 0}, {"id": "spicy", "name": "Spicy", "price": 0},
    {"id": "extra-hot", "name": "Extra hot", "price": 0}]}
DIPS = {"id": "dips", "name": "Dips", "min": 0, "max": 2,
        "options": [{"id": "garlic", "name": "Garlic mayo", "price": 30}, {"id": "bbq", "name": "BBQ sauce", "price": 30}]}
ITEMS = [
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers", "modifierGroups": [EXTRAS, MEAL]},
    {"id": "hw", "name": "Hot Wings", "price": 320, "category": "Chicken", "tags": ["spicy"], "modifierGroups": [SPICE],
     "variations": [{"name": "6 pcs", "price": 320}, {"name": "10 pcs", "price": 490}]},
    {"id": "or", "name": "Onion Rings", "price": 200, "category": "Sides", "modifierGroups": [DIPS]},
    {"id": "ff", "name": "Classic Fries", "price": 150, "category": "Sides", "modifierGroups": [DIPS],
     "variations": [{"name": "Regular", "price": 150}, {"name": "Large", "price": 210}]},
    {"id": "coke", "name": "Coca-Cola", "price": 80, "category": "Shakes & Drinks"},
    {"id": "mint", "name": "Mint Lemonade", "price": 160, "category": "Shakes & Drinks"},
    {"id": "water", "name": "Mineral Water", "price": 25, "category": "Shakes & Drinks"},
    {"id": "brownie", "name": "Chocolate Brownie", "price": 220, "category": "Desserts"},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "replyText": ""}


def ref(i):
    return IDX.ref(IDX.by_id[i])


def line(i, q=1, **kw):
    return {"itemId": i, "quantity": q, "price": kw.pop("price", IDX.by_id[i]["price"]), **kw}


def run(text, model=None, cart=(), history=None, state=None, conversation_id=None):
    async def fake(messages):
        return json.dumps({**TURN, **(model or {})})

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        return asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="bn", history=history, dialog_state=state,
            conversation_id=conversation_id,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "channel": "online"}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u


def ops_of(out):
    return [(o["op"], o["itemId"], o.get("quantity")) for o in out["meta"]["cartOps"]]


def nxt(prev, cart):
    """The next turn's memory (what the server keeps between turns)."""
    return {"tray": prev["meta"]["tray"], "reco": prev["meta"]["reco"], "checkout": prev["meta"].get("checkout") or {}}


def test_the_models_pitches_never_reach_the_guest():
    # the real turn: a drink added → the model also pitched fries and asked about dessert, and cards popped up
    out = run("কোকা-কোলা।", {"cartOps": [{"op": "add", "item": ref("coke"), "quantity": 1}],
                            "replyText": "একটা কোকা-কোলা যোগ করলাম। সাথে Classic Fries নিলে দারুণ হবে, হালকা এবং দুপুরের জন্য ভালো। "
                                         "সাথে কি কোনো ডেজার্ট নিবেন?",
                            "suggestions": [{"item": ref("ff"), "reason": ""}, {"item": ref("brownie"), "reason": ""}]},
              cart=[line("hw", 2, variation="6 pcs"), line("or")])
    reply = out["replyText"]
    assert ops_of(out) == [("add", "coke", 1)]
    assert "Fries" not in reply and "ডেজার্ট" not in reply, reply
    assert out["meta"]["suggestions"] == [] and not out["meta"]["decision"].get("showSuggestionsModal"), out["meta"]["suggestions"]
    assert not out["meta"].get("upsellOffer")  # a drink just added → nothing to build on
    assert "model_pitch_removed" in out["meta"]["guards"]


def test_spicy_food_gets_a_cold_drink_offer_and_yes_adds_it():
    out = run("দুইটা অনিয়ন রিংস দেন", cart=[line("hw", 2, variation="6 pcs",
                                                   modifiers=[{"groupId": "spice", "optionId": "spicy", "name": "Spicy"}])])
    reply = out["replyText"]
    assert ops_of(out) == [("add", "or", 2)], out["meta"]["cartOps"]
    # made here (not the bottle), cold, with the reason and the price — instead of "anything else?"
    assert reply.startswith("2টা Onion Rings যোগ করলাম।") and "ঝাল" in reply and "Mint Lemonade" in reply and "৳160" in reply, reply
    assert "আর কিছু লাগবে" not in reply and "Mineral Water" not in reply
    offer = out["meta"]["upsellOffer"]
    assert offer["type"] == "drink" and offer["moment"] == "first_add" and offer["ops"][0]["itemId"] == "mint"
    assert out["meta"]["upsell"][0]["itemId"] == "mint" and out["meta"]["decision"]["showUpsellTray"]  # the card in the tray
    # "হ্যাঁ" → added exactly, and the stats hear it was accepted
    cart = [line("hw", 2, variation="6 pcs"), line("or", 2)]
    yes = run("হ্যাঁ", cart=cart, state=nxt(out, cart), history=[{"role": "assistant", "content": reply}])
    assert ops_of(yes) == [("add", "mint", 1)] and yes["replyText"].startswith("1টা Mint Lemonade যোগ করলাম।"), yes["replyText"]
    assert yes["meta"]["upsellOutcome"]["outcome"] == "accepted" and yes["meta"]["upsellOutcome"]["value"] == 160
    assert yes["meta"]["traySubtotal"] == 2 * 320 + 2 * 200 + 160


def test_a_burger_alone_is_offered_the_menus_own_meal_with_the_saving():
    out = run("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", {"cartOps": [{"op": "add", "item": ref("smash"), "quantity": 1}],
                                                 "replyText": "যোগ করলাম।"})
    reply = out["replyText"]
    # Fries (৳150) + Coke (৳80) apart = ৳230 vs +৳150 → ৳80 less
    assert "মিল" in reply and "+৳150" in reply and "৳80" in reply, reply
    offer = out["meta"]["upsellOffer"]
    assert offer["type"] == "meal_addon" and offer["ops"][0]["op"] == "edit"
    cart = [line("smash")]
    yes = run("হ্যাঁ দেন", cart=cart, state=nxt(out, cart))
    op = yes["meta"]["cartOps"][0]
    assert op["op"] == "edit" and op["choices"] == ["Fries + soft drink"] and op["price"] == 540, op
    assert "Fries + soft drink যোগ করলাম" in yes["replyText"], yes["replyText"]


def test_no_is_remembered_and_two_nos_end_the_offers():
    out = run("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", {"cartOps": [{"op": "add", "item": ref("smash"), "quantity": 1}],
                                                 "replyText": "যোগ করলাম।"})
    cart = [line("smash")]
    no = run("না", cart=cart, state=nxt(out, cart))
    assert no["replyText"] == "ঠিক আছে! আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?", no["replyText"]
    assert no["meta"]["upsellOutcome"]["outcome"] == "declined" and no["meta"]["reco"]["offer_declines"] == 1
    # the next dish: a different gap may be offered once more…
    cart2 = cart + [line("hw", 1, variation="6 pcs")]
    more = run("একটা হট উইংস ৬ পিস স্পাইসি দেন", {"cartOps": [{"op": "add", "item": ref("hw"), "quantity": 1,
                                                             "variant": "6 pcs", "choices": ["Spicy"]}], "replyText": "যোগ করলাম।"},
               cart=cart, state=nxt(no, cart))
    assert ops_of(more) == [("add", "hw", 1)], more["replyText"]  # "৬ পিস" is the size, not six of them
    assert more["meta"].get("upsellOffer"), more["replyText"]
    no2 = run("না, লাগবে না", cart=cart2, state=nxt(more, cart2))
    assert no2["meta"]["reco"]["offer_declines"] == 2
    # …and after two "no"s nothing more is offered this visit, not even at the end
    end = run("এই হবে, আর কিছু না", cart=cart2, state=nxt(no2, cart2), model={"replyText": "ঠিক আছে।"})
    assert not end["meta"].get("upsellOffer"), end["replyText"]


def test_that_is_all_brings_one_offer_for_what_the_meal_misses():
    cart = [line("smash"), line("ff", variation="Regular"), line("coke")]
    end = run("এই হবে, আর কিছু না", cart=cart, model={"replyText": "ঠিক আছে।"})
    offer = end["meta"]["upsellOffer"]
    assert offer["type"] == "dessert" and offer["moment"] == "wrap_up", end["replyText"]
    assert "Chocolate Brownie" in end["replyText"] and "৳220" in end["replyText"], end["replyText"]
    # "না" at the end → straight on to confirming
    no = run("না", cart=cart, state=nxt(end, cart))
    assert no["replyText"] == "ঠিক আছে! তাহলে অর্ডারটা কনফার্ম করব?", no["replyText"]
    # a full meal already (drink + dessert) → no offer, the usual read-back
    full = run("এই হবে, আর কিছু না", cart=cart + [line("brownie")], model={"replyText": "ঠিক আছে।"})
    assert not full["meta"].get("upsellOffer")


def _ctx(rows, added, **kw):
    base = dict(index=IDX, orderable={}, rows=rows, added=added, picks=[], stats=OrderStats(), profile=GuestProfile(),
                clash=lambda it: [], lang="bn", arm={"wording": "reason", "timing": "early"})
    base.update(kw)
    return offers.Ctx(**base)


def _rows(*cart):
    rows, _ = brain.cart_lines(IDX, list(cart))
    return brain._tray.with_refs(rows)


def test_a_group_gets_one_each_and_more_of_the_main():
    rows = _rows(line("hw", 1, variation="6 pcs"), line("or"))
    o = offers.plan("first_add", _ctx(rows, [{"op": "add", "itemId": "hw", "quantity": 1}], profile=GuestProfile(party_size=4)))
    assert o.type == "more_food" and o.ops[0] == {"op": "set", "itemId": "hw", "name": "Hot Wings",
                                                   "lineKey": rows[0]["key"], "quantity": 4}, o
    assert "৪ জন" in o.text or "4 জন" in o.text, o.text
    o = offers.plan("first_add", _ctx(rows, [{"op": "add", "itemId": "hw", "quantity": 1}],
                                      profile=GuestProfile(party_size=4), done_types=["more_food"]))
    assert o.type == "drink" and o.ops[0]["quantity"] == 4 and "সবার জন্য" in o.text, o.text


def test_the_ab_arms():
    rows = _rows(line("hw", 1, variation="6 pcs"), line("or"))
    added = [{"op": "add", "itemId": "or", "quantity": 1}]
    short = offers.plan("first_add", _ctx(rows, added, arm={"wording": "short", "timing": "early"}))
    assert short.text == "1টা Mint Lemonade ৳160 — দেব?", short.text
    assert offers.may_offer(object(), "first_add", {"timing": "late"}) is False  # late arm: only at the end
    assert offers.may_offer(object(), "wrap_up", {"timing": "late"}) is True
    os.environ["UPSELL_AB"] = "on"
    try:
        arms = {tuple(sorted(offers.arm_for("burger-house", f"s{i}").items())) for i in range(40)}
        assert len(arms) == 4 and offers.arm_for("burger-house", "s1") == offers.arm_for("burger-house", "s1")
    finally:
        os.environ["UPSELL_AB"] = "off"


def test_the_size_up_is_a_hint_on_the_picker_not_a_question():
    hints = offers.size_hints([{"name": "6 pcs", "price": 320}, {"name": "10 pcs", "price": 490}], "bn")
    assert hints == {"10 pcs": "আরও 4 পিস, মাত্র +৳170 · সবচেয়ে সাশ্রয়ী"}, hints
    assert offers.size_hints([{"name": "Regular", "price": 150}, {"name": "Large", "price": 210}], "en") == {"Large": "just +৳60"}


THAI = [
    {"id": "soup", "name": "Crispy Rice Soup", "price": 250, "category": "Soup"},
    {"id": "pak", "name": "Chicken Pakora", "price": 220, "category": "Appetizer"},
    {"id": "cfr", "name": "Chicken Fried Rice", "price": 320, "category": "Rice"},
    {"id": "curry", "name": "Chicken Red Curry", "price": 380, "category": "Chicken"},
    {"id": "lime", "name": "Fresh Lime Soda", "price": 120, "category": "Drinks"},
]


def test_starters_only_are_offered_a_main_course():
    # the real turn: "একটা ক্রিস্পি রাইস স্যুপ আর দুইটা চিকেন পাকোড়া" → added, then just "আর কিছু লাগবে…?" — a soup
    # and pakoras are starters: no side / rice / drink rule fired, so the meal's real gap (a main) was never offered
    idx = brain.MenuIndex(THAI)

    async def fake(messages):
        return json.dumps({**TURN, "cartOps": [{"op": "add", "item": idx.ref(idx.by_id["soup"]), "quantity": 1},
                                               {"op": "add", "item": idx.ref(idx.by_id["pak"]), "quantity": 2}],
                           "replyText": "যোগ করলাম।"})

    async def no_reading(*a, **k):
        return None

    orig = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        out = asyncio.run(brain.generate_reply(
            "একটা ক্রিস্পি রাইস স্যুপ আর দুইটা চিকেন পাকোড়া দেন", menu_snapshot={"items": THAI}, locale="bn",
            context={"cartItems": [], "mealKinds": ["dinner"], "channel": "online"}))
    finally:
        brain._call_openai, brain._understand = orig
    offer = out["meta"].get("upsellOffer")
    assert offer and offer["type"] == "main", (out["replyText"], offer)
    assert offer["ops"][0]["itemId"] in ("cfr", "curry") and "মেইন কোর্সে" in out["replyText"], out["replyText"]


def test_a_tray_of_starters_can_still_get_a_drink():
    idx = brain.MenuIndex(THAI)
    rows = [{"itemId": "soup", "quantity": 1, "price": 250}, {"itemId": "pak", "quantity": 2, "price": 220}]
    c = offers.Ctx(index=idx, orderable={}, rows=rows, added=[], picks=[], stats=OrderStats.from_orders([]),
                   profile=GuestProfile(), clash=lambda it: [], lang="bn", arm={"wording": "reason", "timing": "early"})
    o = offers._drink("wrap_up", c)
    assert o and o.ops[0]["itemId"] == "lime", o
