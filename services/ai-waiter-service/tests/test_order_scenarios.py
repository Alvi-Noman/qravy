"""Whole-turn scenarios on a burger menu: sold-out dishes, sizes / spice said or not, several dishes waiting for their
options, answers that name one dish, changing one's mind, and the offers around them. Each one was a real failure
found by playing the guest (2026-10-05)."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402
import offers  # noqa: E402
from recommender import GuestProfile, OrderStats, dish_facts  # noqa: E402

EXTRAS = {"id": "extras", "name": "Extra toppings", "min": 0, "max": 4, "options": [
    {"id": "cheese", "name": "Extra cheese", "price": 40}, {"id": "egg", "name": "Fried egg", "price": 30}]}
MEAL = {"id": "meal", "name": "Make it a meal", "min": 0, "max": 1, "options": [{"id": "meal", "name": "Fries + soft drink", "price": 150}]}
SPICE = {"id": "spice", "name": "Spice level", "min": 1, "max": 1, "options": [
    {"id": "regular", "name": "Regular", "price": 0}, {"id": "spicy", "name": "Spicy", "price": 0},
    {"id": "extra-hot", "name": "Extra hot", "price": 0}]}
DIPS = {"id": "dips", "name": "Dips", "min": 0, "max": 2, "options": [
    {"id": "garlic", "name": "Garlic mayo", "price": 30}, {"id": "bbq", "name": "BBQ sauce", "price": 30}]}
ITEMS = [
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers", "modifierGroups": [EXTRAS, MEAL]},
    {"id": "ccb", "name": "Crispy Chicken Burger", "price": 360, "category": "Chicken", "modifierGroups": [SPICE, EXTRAS, MEAL]},
    {"id": "hw", "name": "Hot Wings", "price": 320, "category": "Chicken", "tags": ["spicy"], "modifierGroups": [SPICE],
     "variations": [{"name": "6 pcs", "price": 320}, {"name": "10 pcs", "price": 490}]},
    {"id": "fc", "name": "Fried Chicken", "price": 280, "category": "Chicken", "modifierGroups": [SPICE, DIPS],
     "variations": [{"name": "2 pcs", "price": 280}, {"name": "4 pcs", "price": 520}]},
    {"id": "tend", "name": "Chicken Tenders", "price": 300, "category": "Chicken",
     "description": "Golden chicken tenders with garlic mayo.", "modifierGroups": [DIPS]},
    {"id": "ff", "name": "Classic Fries", "price": 150, "category": "Sides", "modifierGroups": [DIPS],
     "variations": [{"name": "Regular", "price": 150}, {"name": "Large", "price": 210}]},
    {"id": "peri", "name": "Peri Peri Fries", "price": 190, "category": "Sides", "modifierGroups": [DIPS]},
    {"id": "or", "name": "Onion Rings", "price": 200, "category": "Sides", "modifierGroups": [DIPS]},
    {"id": "mint", "name": "Mint Lemonade", "price": 160, "category": "Shakes & Drinks"},
    {"id": "coke", "name": "Coca-Cola", "price": 80, "category": "Shakes & Drinks"},
    {"id": "brownie", "name": "Chocolate Brownie", "price": 220, "category": "Desserts"},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "replyText": "ঠিক আছে।"}


def add(i, q=1, **kw):
    return {"op": "add", "item": IDX.ref(IDX.by_id[i]), "quantity": q, **kw}


class Guest:
    """One visit: the tray and the waiter's memory carry from turn to turn (as the server keeps them)."""

    def __init__(self, sold_out=(), lang="bn", cart=()):
        self.items = [dict(it, available=it["id"] not in sold_out) for it in ITEMS]
        self.cart, self.state, self.history, self.lang = [dict(c) for c in cart], None, [], lang

    def say(self, text, ops=(), reply="ঠিক আছে।"):
        async def fake(messages):
            return json.dumps({**TURN, "language": self.lang, "replyText": reply, "cartOps": list(ops)})

        async def no_reading(*a, **k):
            return None

        orig = brain._call_openai, brain._understand
        brain._call_openai, brain._understand = fake, no_reading
        try:
            out = asyncio.run(brain.generate_reply(
                text, menu_snapshot={"items": self.items}, locale=self.lang, history=self.history[-8:],
                dialog_state=self.state, conversation_id="t", lock_language=True,
                context={"cartItems": [dict(c) for c in self.cart], "mealKinds": ["dinner"], "channel": "online"}))
        finally:
            brain._call_openai, brain._understand = orig
        m = out["meta"]
        index = brain.MenuIndex(self.items)
        rows, _ = brain.cart_lines(index, self.cart)
        brain._tray.with_refs(rows)
        after = brain._tray.simulate(rows, m.get("cartOps") or [], bool(m.get("clearCart")), index.by_id)
        self.cart = [{"itemId": r["itemId"], "quantity": r["quantity"], "price": r["price"],
                      "variation": r.get("variation") or "", "modifiers": r.get("modifiers") or []} for r in after]
        self.state = {"tray": m.get("tray") or {}, "reco": m.get("reco") or {}, "checkout": m.get("checkout") or {}}
        self.history += [{"role": "user", "content": text}, {"role": "assistant", "content": out["replyText"]}]
        return out


def adds(out):
    return [(o["itemId"], o.get("quantity"), o.get("variant"), tuple(o.get("choices") or []))
            for o in out["meta"]["cartOps"] if o["op"] == "add"]


def picker(out):
    return {p["itemId"]: (p["quantity"], p["variant"], p["choices"], p["missing"])
            for p in (out["meta"].get("decision") or {}).get("pickOptions") or []}


# ---------------------------------------------------------------- sold out

def test_every_sold_out_dish_is_named():
    out = Guest(sold_out=("or", "coke")).say("একটা ক্লাসিক স্ম্যাশ বার্গার, একটা অনিয়ন রিংস আর একটা কোকা-কোলা দেন",
                                             [add("smash"), add("or"), add("coke")])
    assert adds(out) == [("smash", 1, None, ())]
    assert "Onion Rings আর Coca-Cola এখন পাওয়া যাচ্ছে না" in out["replyText"], out["replyText"]


def test_sold_out_is_said_even_when_a_size_is_asked():
    out = Guest(sold_out=("or",)).say("একটা হট উইংস আর একটা অনিয়ন রিংস দেন", [add("hw"), add("or")])
    reply = out["replyText"]
    assert reply.startswith("দুঃখিত, Onion Rings এখন পাওয়া যাচ্ছে না।") and "6 pcs" in reply, reply


def test_a_bare_yes_to_either_or_asks_which():
    g = Guest(sold_out=("or",))
    g.say("দুইটা অনিয়ন রিংস দেন", [add("or", 2)])
    out = g.say("হ্যাঁ", [add("peri")])  # the model would pick one for the guest
    assert adds(out) == [] and out["replyText"].startswith("কোনটা দেব —"), out["replyText"]
    assert len(out["meta"]["decision"]["chooseOptions"]) == 2


# ---------------------------------------------------------------- several dishes waiting for their options

def test_another_dishs_name_is_not_an_answer():
    # "হট উইংস" made the Fried Chicken "Extra hot"
    out = Guest().say("একটা হট উইংস, একটা ফ্রাইড চিকেন আর একটা ক্লাসিক ফ্রাইজ দেন", [add("hw"), add("fc"), add("ff")])
    assert picker(out)["fc"] == (1, "", [], ["size", "Spice level"]), picker(out)


def test_an_answer_naming_one_dish_goes_to_that_dish_only():
    g = Guest()
    g.say("একটা হট উইংস আর একটা ফ্রাইড চিকেন দেন", [add("hw"), add("fc")])
    out = g.say("হট উইংস দশ পিস স্পাইসি")
    assert adds(out) == [("hw", 1, "10 pcs", ("Spicy",))], adds(out)
    assert picker(out)["fc"] == (1, "", [], ["size", "Spice level"]), picker(out)  # not Spicy too
    out = g.say("ফ্রাইড চিকেন চার পিস এক্সট্রা হট")
    assert adds(out) == [("fc", 1, "4 pcs", ("Extra hot",))], adds(out)


def test_regular_picks_the_spice_not_the_smallest_size():
    g = Guest()
    g.say("একটা ফ্রাইড চিকেন আর একটা ক্লাসিক ফ্রাইজ দেন", [add("fc"), add("ff")])
    out = g.say("রেগুলার")
    assert adds(out) == [("ff", 1, "Regular", ())], adds(out)
    assert picker(out)["fc"] == (1, "", ["Regular"], ["size"]), picker(out)


def test_one_answer_for_all_of_them():
    g = Guest()
    g.say("একটা হট উইংস আর একটা ফ্রাইড চিকেন দেন", [add("hw"), add("fc")])
    out = g.say("দুটোই স্পাইসি, ছয় পিস আর দুই পিস")
    assert sorted(adds(out)) == [("fc", 1, "2 pcs", ("Spicy",)), ("hw", 1, "6 pcs", ("Spicy",))], adds(out)


def test_dropping_a_waiting_dish():
    g = Guest()
    g.say("একটা হট উইংস দেন", [add("hw")])
    out = g.say("হট উইংস লাগবে না")
    assert out["replyText"] == "ঠিক আছে, Hot Wings বাদ দিলাম। আর কিছু লাগবে?", out["replyText"]
    assert not picker(out) and not (out["meta"]["tray"] or {}).get("pending")


def test_just_the_number_answers_the_size():
    g = Guest()
    g.say("একটা হট উইংস দেন", [add("hw")])
    out = g.say("দশটা")
    assert picker(out)["hw"] == (1, "10 pcs", [], ["Spice level"]) and "Hot Wings (10 pcs)" in out["replyText"], out["replyText"]


def test_ten_wings_is_the_ten_piece():
    out = Guest().say("দশটা হট উইংস দেন", [add("hw", 10)])
    assert picker(out)["hw"] == (1, "10 pcs", [], ["Spice level"]), picker(out)


def test_the_answer_and_a_new_dish_in_one_breath():
    g = Guest()
    g.say("একটা হট উইংস দেন", [add("hw")])
    out = g.say("দশ পিস স্পাইসি, আর একটা কোক দেন", [add("coke")])  # the Coke was lost
    assert adds(out) == [("hw", 1, "10 pcs", ("Spicy",)), ("coke", 1, None, ())], out["replyText"]


def test_a_plain_yes_repeats_the_question():
    g = Guest()
    first = g.say("একটা হট উইংস দেন", [add("hw")])
    out = g.say("হ্যাঁ")
    assert out["replyText"] == first["replyText"] and picker(out)


def test_size_said_up_front_even_when_the_model_drops_it():
    out = Guest().say("দুইটা হট উইংস দশ পিস স্পাইসি দেন", [add("hw", 2)])
    assert adds(out) == [("hw", 2, "10 pcs", ("Spicy",))]
    assert "প্রতিটা ৳490" in out["replyText"] and " each" not in out["replyText"], out["replyText"]


# ---------------------------------------------------------------- offers

def test_spicy_food_gets_the_cold_drink_before_a_side():
    out = Guest().say("দুইটা হট উইংস দশ পিস এক্সট্রা হট দেন", [add("hw", 2, variant="10 pcs", choices=["Extra hot"])])
    assert out["meta"]["upsellOffer"]["type"] == "drink" and "Mint Lemonade" in out["replyText"], out["replyText"]


def test_no_with_a_number_to_an_offer_is_how_many():
    g = Guest()
    g.say("দুইটা হট উইংস ছয় পিস স্পাইসি দেন", [add("hw", 2, variant="6 pcs", choices=["Spicy"])])
    out = g.say("না, দুইটা")
    assert adds(out) == [("mint", 2, None, ())], out["replyText"]


def test_the_meal_saving_is_priced_against_a_coke_even_with_one_in_the_tray():
    out = Guest(cart=[{"itemId": "coke", "quantity": 1, "price": 80}]).say("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", [add("smash")])
    assert "৳80 কম" in out["replyText"], out["replyText"]  # fries ৳150 + Coke ৳80 vs +৳150 (was ৳160: a lemonade)


def _ctx(cart, added, **kw):
    rows, _ = brain.cart_lines(IDX, cart)
    base = dict(index=IDX, orderable={}, rows=brain._tray.with_refs(rows), added=added, picks=[], stats=OrderStats(),
                profile=GuestProfile(), clash=lambda it: [], lang="bn", arm={"wording": "reason", "timing": "early"})
    base.update(kw)
    return offers.Ctx(**base)


def test_a_group_hears_make_it_four_before_the_meal_deal():
    o = offers.plan("first_add", _ctx([{"itemId": "ccb", "quantity": 1, "price": 360}],
                                      [{"op": "add", "itemId": "ccb", "quantity": 1}], profile=GuestProfile(party_size=4)))
    assert o.type == "more_food" and o.ops[0]["quantity"] == 4, o


def test_no_extra_the_dish_already_comes_with():
    o = offers.plan("first_add", _ctx([{"itemId": "tend", "quantity": 1, "price": 300}, {"itemId": "coke", "quantity": 1, "price": 80},
                                       {"itemId": "or", "quantity": 1, "price": 200}],
                                      [{"op": "add", "itemId": "tend", "quantity": 1}]))
    assert o.type == "addon" and "Garlic mayo" not in o.text and "BBQ sauce" in o.text, o.text


def test_dairy_is_known_in_desserts_and_shakes():
    contains = lambda n, c: dish_facts({"name": n, "category": c})["contains"]  # noqa: E731
    assert "dairy" in contains("Chocolate Brownie", "Desserts") and "dairy" in contains("Oreo Milkshake", "Shakes & Drinks")
    assert "dairy" not in contains("Mint Lemonade", "Shakes & Drinks") and "dairy" not in contains("Fish Cake", "Starter")
    # …so a guest allergic to milk is never offered the brownie at the end
    g = Guest(cart=[{"itemId": "tend", "quantity": 1, "price": 300}, {"itemId": "coke", "quantity": 1, "price": 80}])
    g.say("আমার দুধে এলার্জি আছে")
    out = g.say("এই হবে, আর কিছু না")
    assert "Brownie" not in out["replyText"] and not out["meta"].get("upsellOffer"), out["replyText"]


# ---------------------------------------------------------------- "আরও ৪টা" vs "মোট ৪টা" (asked only when unclear)

def _set(i, q):
    return {"op": "set", "item": IDX.ref(IDX.by_id[i]), "quantity": q}


def _coke(out_guest):
    return sum(c["quantity"] for c in out_guest.cart if c["itemId"] == "coke")


ONE_COKE = [{"itemId": "coke", "quantity": 1, "price": 80}]


def test_more_or_total_from_the_guests_words_whatever_op_the_model_chose():
    cases = [
        ("আরও ৪টা কোক দেন", add("coke", 4), 5), ("আরও ৪টা কোক দেন", _set("coke", 4), 5),
        ("মোট ৪টা কোক করেন", add("coke", 4), 4), ("total 4 ta coke koren", _set("coke", 4), 4),
        ("aro duita coke den", add("coke", 2), 3), ("coke 3 ta kore din", add("coke", 3), 3),
        ("two more cokes", add("coke", 2), 3), ("make it 3 cokes", add("coke", 3), 3),
    ]
    for said, op, want in cases:
        g = Guest(cart=ONE_COKE)
        out = g.say(said, [op])
        assert _coke(g) == want and "আগে থেকেই" not in out["replyText"], (said, _coke(g), out["replyText"])


def test_a_bare_number_for_a_dish_in_the_tray_is_asked_and_every_answer_is_read():
    for answer, want in [("হ্যাঁ", 5), ("আরও", 5), ("আরও ২টা", 3), ("মোট ৪টা", 4), ("না, ৪টা", 4), ("না", 1)]:
        g = Guest(cart=ONE_COKE)
        out = g.say("৪টা কোক দেন", [add("coke", 4)])
        assert "আরও 4টা যোগ করে মোট 5টা করব?" in out["replyText"] and _coke(g) == 1, out["replyText"]
        assert [b["label"] for b in out["meta"]["decision"]["chooseOptions"]] == ["হ্যাঁ, মোট 5টা", "না, মোট 4টা"]
        g.say(answer)
        assert _coke(g) == want, (answer, _coke(g))


def test_one_more_of_a_line_keeps_its_size_and_spice():
    g = Guest(cart=[{"itemId": "hw", "quantity": 1, "price": 490, "variation": "10 pcs",
                     "modifiers": [{"groupId": "spice", "optionId": "spicy", "name": "Spicy", "price": 0}]}])
    out = g.say("আরও একটা হট উইংস দেন", [add("hw", 1)])
    assert adds(out) == [("hw", 1, "10 pcs", ("Spicy",))] and not picker(out), out["replyText"]


def test_ordering_a_dish_by_name_is_not_placing_the_order():
    g = Guest(cart=[{"itemId": "smash", "quantity": 1, "price": 390}])
    out = g.say("একটা ক্লাসিক স্ম্যাশ বার্গার অর্ডার করেন", [add("smash", 1)])
    assert "আরও 1টা যোগ করে মোট 2টা করব?" in out["replyText"], out["replyText"]  # (was the read-back: burger lost)


def test_extra_hot_is_a_spice_not_more():
    g = Guest(cart=[{"itemId": "hw", "quantity": 1, "price": 490, "variation": "10 pcs",
                     "modifiers": [{"groupId": "spice", "optionId": "extra-hot", "name": "Extra hot", "price": 0}]}])
    out = g.say("দুইটা হট উইংস দশ পিস এক্সট্রা হট দেন", [add("hw", 2, variant="10 pcs", choices=["Extra hot"])])
    assert "আরও 2টা যোগ করে মোট 3টা করব?" in out["replyText"], out["replyText"]


def test_the_more_or_total_reader():
    from tray import qty_intent
    for t in ["আরও ৪টা দেন", "aro 4 ta den", "আর একটা কোক দেন", "arekta din", "4 more please", "ওটাই আরেকটা বানিয়ে দিন"]:
        assert qty_intent(t) == "more", t
    for t in ["মোট ৪টা করেন", "total 4 ta koren", "৪টা করে দিন", "mot 4ta", "make it 4", "শুধু একটা রাখেন",
              "ফ্রেঞ্চ ফ্রাই ডাবল করে দিন", "আরও দুইটা দিয়ে মোট চারটা করেন"]:
        assert qty_intent(t) == "total", t
    for t in ["৪টা কোক দেন", "4 ta coke den", "একটা বার্গার অর্ডার করেন", "দুইটা কোক যোগ করেন",
              "বার্গার আর একটা কোক দেন", "দুইটা হট উইংস এক্সট্রা হট দেন"]:
        assert qty_intent(t) is None, t


# ---------------------------------------------------------------- "cancel everything" and the conversation's flow

FULL_TRAY = [{"itemId": "smash", "quantity": 2, "price": 390}, {"itemId": "coke", "quantity": 3, "price": 80}]


def test_cancel_everything_is_always_asked_first_with_buttons():
    # the real turn (12:23): "অর্ডারগুলো ক্যান্সেল করুন, কিছু লাগবে না।" got "ঠিক আছে, কোনো সমস্যা নেই!" and kept ৳3290
    for said in ["অর্ডারগুলো ক্যান্সেল করুন, কিছু লাগবে না।", "সব ফাঁকা করেন", "shob faka koren", "ট্রে খালি করে দিন",
                 "নতুন করে শুরু করি", "cancel everything", "start over"]:
        g = Guest(cart=FULL_TRAY)
        out = g.say(said)
        assert out["meta"]["clearCart"] is False and len(g.cart) == 2, (said, out["replyText"])
        assert out["replyText"] == "আপনার ট্রেতে 5টা আইটেম আছে — সবগুলো বাদ দিয়ে দেব?", (said, out["replyText"])
        assert [b["label"] for b in out["meta"]["decision"]["chooseOptions"]] == ["হ্যাঁ, সব বাদ দিন", "না, রেখে দিন"]
    # "হ্যাঁ" (the pill) → emptied; "না" → kept; saying it again while asked = yes
    for answer, emptied in [("হ্যাঁ", True), ("হ্যাঁ, সব বাদ দিন", True), ("সব বাদ দিন", True), ("না", False)]:
        g = Guest(cart=FULL_TRAY)
        g.say("সব বাদ দিন")
        out = g.say(answer)
        assert (g.cart == []) is emptied, (answer, out["replyText"])
    # a tray of ONE thing is asked about too, when the model itself says "clear everything"
    TURN["clearCart"] = True
    try:
        g = Guest(cart=[{"itemId": "coke", "quantity": 1, "price": 80}])
        out = g.say("আর কিছুই রাখবেন না", reply="খালি করলাম।")
    finally:
        TURN["clearCart"] = False
    assert out["meta"]["clearCart"] is False and g.cart and "ট্রে খালি করে দেব?" in out["replyText"], out["replyText"]


def test_one_dish_or_nothing_more_is_not_cancel_everything():
    from brain import _CLEAR_ALL
    for said in ["হট উইংস বাদ দিন", "কোকটা বাদ দিন", "আর কিছু লাগবে না", "cancel the wings", "সব মিলিয়ে কত হলো?", "দুটোই স্পাইসি"]:
        assert not _CLEAR_ALL.search(said), said


def test_cancel_everything_while_a_question_is_waiting():
    g = Guest(cart=FULL_TRAY)
    g.say("একটা ফ্রাইড চিকেন দেন", [add("fc")])  # the size question is waiting
    out = g.say("সব বাদ দিন, লাগবে না")
    assert out["meta"]["tray"]["pending"]["kind"] == "clear", out["replyText"]  # asked first (the wings question lapses)
    out = g.say("হ্যাঁ")
    assert out["meta"]["clearCart"] is True and g.cart == [] and not (out["meta"]["tray"] or {}).get("pending")


def _after_closing_question():
    g = Guest(cart=[{"itemId": "smash", "quantity": 1, "price": 390}])
    first = g.say("একটা কোক দেন", [add("coke")])
    assert first["replyText"].endswith("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"), first["replyText"]
    return g


def test_nothing_more_after_anything_else_or_confirm_goes_to_confirming():
    for said in ["কিছু লাগবে না", "আর কিছু লাগবে না", "ar kichu lagbe na", "না"]:
        out = _after_closing_question().say(said)
        reply = out["replyText"]
        assert reply.startswith("ঠিক আছে, তাহলে") and not out["meta"].get("upsellOffer"), (said, reply)
        assert out["meta"]["decision"].get("showCheckout"), (said, out["meta"]["decision"])


def test_nothing_more_to_an_offer_is_a_no_then_confirming():
    g = Guest()
    g.say("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", [add("smash")])  # the meal offer
    out = g.say("কিছু লাগবে না")
    assert out["replyText"].startswith("ঠিক আছে, তাহলে") and out["meta"]["upsellOutcome"]["outcome"] == "declined"
    assert out["meta"]["reco"]["offer_declines"] == 1


def test_thats_all_unprompted_still_gets_the_one_end_of_meal_offer():
    g = Guest(cart=[{"itemId": "smash", "quantity": 1, "price": 390}, {"itemId": "coke", "quantity": 1, "price": 80}])
    out = g.say("এই হবে, আর কিছু না")
    assert out["meta"]["upsellOffer"]["moment"] == "wrap_up", out["replyText"]


def test_nothing_wanted_with_an_empty_tray_is_still_friendly():
    out = Guest().say("আজকে কিছু লাগবে না")
    assert out["replyText"].startswith("ঠিক আছে, কোনো সমস্যা নেই"), out["replyText"]


def test_removing_one_dish_never_asks_delete_everything():
    # "অর্ডার থেকে কোকটা বাদ দিন" / "সব কোক বাদ দিন" / naming the only two dishes all asked "সবগুলো বাদ দিয়ে দেব?"
    tray = [{"itemId": "smash", "quantity": 1, "price": 390}, {"itemId": "coke", "quantity": 3, "price": 80},
            {"itemId": "hw", "quantity": 2, "price": 490, "variation": "10 pcs"}]
    rm = lambda i: {"op": "remove", "item": IDX.ref(IDX.by_id[i])}  # noqa: E731
    cases = [("কোকটা বাদ দিন", "coke"), ("অর্ডার থেকে কোকটা বাদ দিন", "coke"), ("ট্রে থেকে বার্গারটা সরিয়ে দিন", "smash"),
             ("সব কোক বাদ দিন", "coke"), ("কোকগুলো বাদ দিন", "coke"), ("বার্গারটা ক্যান্সেল করেন", "smash"),
             ("অর্ডারে হট উইংস লাগবে না", "hw"), ("coke ta bad den", "coke"), ("cancel the coke", "coke"),
             ("remove the burger from my cart", "smash")]
    for said, gone in cases:
        g = Guest(cart=tray)
        out = g.say(said, [rm(gone)])
        assert "সবগুলো বাদ" not in out["replyText"] and not out["meta"]["clearCart"], (said, out["replyText"])
        assert gone not in {c["itemId"] for c in g.cart} and len(g.cart) == 2, (said, g.cart)
    g = Guest(cart=[{"itemId": "smash", "quantity": 1, "price": 390}, {"itemId": "coke", "quantity": 1, "price": 80}])
    out = g.say("বার্গার আর কোক বাদ দিন", [rm("smash"), rm("coke")])
    assert g.cart == [] and "সবগুলো বাদ" not in out["replyText"], out["replyText"]  # exactly what they asked


# ---------------------------------------------------------------- misheard / repeated answers keep the context

def test_a_misheard_answer_never_drops_the_open_question():
    # the real turns (13:40): meal offer → "মাফাক।" (না থাক, misheard) dropped the offer → "বললাম যে না থাক" got a pitch
    g = Guest()
    g.say("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", [add("smash")])  # the meal offer is open
    out = g.say("মাফাক।", reply="মাফাক বলতে কী বোঝাতে চেয়েছেন?")
    assert out["replyText"] == "ঠিক আছে! আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?", out["replyText"]  # heard as না থাক
    g = Guest()
    g.say("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", [add("smash")])
    out = g.say("পাখা", reply="পাখা বলতে কী বোঝাতে চেয়েছেন?")  # nothing like a no → the same question again
    assert out["replyText"].startswith("দুঃখিত, ঠিক বুঝতে পারিনি। Classic Smash Burger মিল করে") and out["meta"]["tray"]["pending"]
    assert [b["label"] for b in out["meta"]["decision"]["chooseOptions"]] == ["হ্যাঁ, দিন", "না, থাক"]
    assert "upsellOutcome" not in out["meta"]  # still open: no outcome yet
    out = g.say("বললাম যে না থাক।", reply="না হলে Hot Wings-ও নিতে পারেন।")
    assert out["replyText"] == "ঠিক আছে! আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?", out["replyText"]
    assert out["meta"]["upsellOutcome"]["outcome"] == "declined" and not out["meta"]["suggestions"]


def test_a_garble_that_sounds_like_yes_is_asked_again_never_added():
    g = Guest()
    g.say("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", [add("smash")])
    out = g.say("হাহ")
    assert out["replyText"].startswith("দুঃখিত, ঠিক বুঝতে পারিনি।") and not out["meta"]["cartOps"], out["replyText"]


def test_the_models_what_do_you_mean_asks_the_open_question_again():
    g = Guest()
    g.say("একটা ক্লাসিক স্ম্যাশ বার্গার দেন", [add("smash")])
    out = g.say("ওই যে ভাই বলছিলাম ওইটা", reply="কোনটার কথা বলছেন? একটু স্পষ্ট করে বলবেন?")
    assert "মিল করে" in out["replyText"] and out["meta"]["tray"]["pending"]["kind"] == "offer", out["replyText"]
    out = g.say("হ্যাঁ দেন")
    assert out["meta"]["cartOps"][0]["op"] == "edit", out["replyText"]  # the meal, exactly as offered


def test_every_kind_of_open_question_survives_a_garble():
    g = Guest()  # a size / spice question
    g.say("একটা হট উইংস দেন", [add("hw")])
    out = g.say("হাবিজাবি")
    assert out["meta"]["tray"]["pending"]["kind"] == "options" and picker(out), out["replyText"]
    out = g.say("আমি বলেছি দশ পিস স্পাইসি")
    assert adds(out) == [("hw", 1, "10 pcs", ("Spicy",))], out["replyText"]
    g = Guest(cart=FULL_TRAY)  # "delete everything?"
    g.say("সব বাদ দিন")
    out = g.say("উমম")
    assert out["meta"]["tray"]["pending"]["kind"] == "clear" and g.cart, out["replyText"]
    g = Guest(cart=ONE_COKE)  # "4 more or 4 in all?"
    g.say("৪টা কোক দেন", [add("coke", 4)])
    out = g.say("কাকা")
    assert "আরও 4টা যোগ করে মোট 5টা করব?" in out["replyText"] and _coke(g) == 1, out["replyText"]
    g.say("আমি বলেছি মোট ৪টা")
    assert _coke(g) == 4


def test_the_sounds_like_no_guess_is_narrow():
    from brain import _sounds_like_no, _strip_repeat_lead
    assert all(_sounds_like_no(w) for w in ["মাফাক", "নাথাক", "না থাক", "নাহ", "থাক", "লাগবেনা"])
    assert not any(_sounds_like_no(w) for w in ["পাখা", "কাকা", "হাহ", "হ্যাঁ", "উমম", "বাতাস", "দেন", "দুইটা"])
    assert _strip_repeat_lead("বললাম যে না থাক।") == "না থাক।" and _strip_repeat_lead("I said no") == "no"
    assert _strip_repeat_lead("না না, আমি বলেছিলাম দুইটা") == "দুইটা" and _strip_repeat_lead("মানে কি?") == "মানে কি?"


# ---------------------------------------------------------------- "which of these?" = what was just recommended

def test_these_means_what_the_waiter_just_recommended_not_an_older_list_on_screen():
    # the real turns (14:01–14:04): drinks on screen → "girlfriend" picks (in the tray) → "এগুলার মধ্যে কোনটা ভালো হবে?"
    # was judged against the old drinks, then replaced by a generic recommendation
    g = Guest()
    TURN["suggestions"] = [{"item": IDX.ref(IDX.by_id[i]), "reason": ""} for i in ("smash", "tend", "brownie")]
    try:
        g.say("আমার গার্লফ্রেন্ডের জন্যে এসেছি। ওর সাথে কি খাওয়া যেতে পারে?",
              reply="Classic Smash Burger, Chicken Tenders অথবা Chocolate Brownie নিতে পারেন।")
    finally:
        TURN["suggestions"] = []

    import asyncio as _a
    import json as _j
    stale = ["mint", "coke", "or"]  # what the app still said was on screen

    async def fake(messages):
        assert "Classic Smash Burger" in messages[-1]["content"].split("ON SCREEN")[-1] if "ON SCREEN" in messages[-1]["content"] else True
        return _j.dumps({**TURN, "replyText": "Hot Wings ট্রাই করতে পারেন।", "topic": "recommendation"})

    async def none(*a, **k):
        return None

    orig = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, none
    try:
        out = _a.run(brain.generate_reply(
            "এগুলার মধ্যে কোনটা ভালো হবে?", menu_snapshot={"items": g.items}, locale="bn", history=g.history,
            dialog_state=g.state, conversation_id="t", lock_language=True,
            context={"cartItems": [], "mealKinds": ["dinner"], "channel": "online", "shownItems": stale}))
    finally:
        brain._call_openai, brain._understand = orig
    # the screen showed the old drinks → the just-recommended dishes come back as the cards (the pick first, highlighted)
    assert {c["itemId"] for c in out["meta"]["suggestions"]} == {"smash", "tend", "brownie"}, out["meta"]["suggestions"]
    reply = out["replyText"]
    assert reply.startswith("এগুলোর মধ্যে") and any(n in reply for n in ("Classic Smash Burger", "Chicken Tenders", "Chocolate Brownie"))
    assert "Hot Wings" not in reply and out["meta"]["highlight"], (reply, out["meta"].get("highlight"))


def test_a_question_about_one_dish_ends_on_that_dish_not_a_pitch_for_another():
    # the real turn (14:40): "ট্রিপ্ল চিজ টাওআরটা কেমন হবে?" → described, then "…হট উইংস ট্রাই করতে চান?" + Hot Wings,
    # the Tower and Tenders as cards — and a "হ্যাঁ" would have added Hot Wings
    g = Guest()
    saved = dict(TURN)
    TURN.update(topic="item_question", intent="menu",
                suggestions=[{"item": IDX.ref(IDX.by_id["hw"]), "reason": "signature"}])
    try:
        out = g.say("Classic Smash Burger কেমন হবে?",
                    reply="Classic Smash Burger আমাদের জনপ্রিয়, স্ম্যাশ করা জুসি প্যাটি আর চিজ। হট উইংস ট্রাই করতে চান?")
    finally:
        TURN.clear()
        TURN.update(saved)
    reply = out["replyText"]
    assert "হট উইংস" not in reply and reply.endswith("এটা দেব?"), reply
    assert not out["meta"]["suggestions"], out["meta"]["suggestions"]
    assert "হট উইংস" not in (out["meta"].get("voiceReplyText") or "")
    # "হ্যাঁ" → the burger they asked about
    out = g.say("হ্যাঁ")
    assert [a[0] for a in adds(out)] == ["smash"] or (out["meta"].get("decision") or {}).get("pickOptions"), out["meta"]["cartOps"]


def test_asking_for_something_less_spicy_still_gets_the_alternative():
    g = Guest()
    saved = dict(TURN)
    TURN.update(topic="item_question", intent="menu")
    try:
        out = g.say("Hot Wings কি খুব ঝাল? কম ঝাল কিছু আছে?",
                    reply="Hot Wings বেশ ঝাল। কম ঝাল চাইলে Chicken Tenders নিতে পারেন?")
    finally:
        TURN.clear()
        TURN.update(saved)
    assert "Chicken Tenders" in out["replyText"] and "stayed_on_asked_dish" not in out["meta"]["guards"]
