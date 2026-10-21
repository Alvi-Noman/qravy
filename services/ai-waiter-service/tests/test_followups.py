"""The second suggestion (followups.py): after a list, "আর কি আছে?" is more of the same ask with nothing repeated,
"ঝাল কিছু?" / "মুরগির?" / "হালকা" narrow it (and add up), "আপনি কোনটা বলবেন?" is ONE of the dishes just said.
Run: python -m pytest tests/test_followups.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import followups  # noqa: E402
import session_ctx  # noqa: E402

TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}

CHINESE = [
    {"id": "ts", "name": "Thai Soup", "price": 280, "category": "Soup"},
    {"id": "cs", "name": "Corn Soup", "price": 260, "category": "Soup"},
    {"id": "hs", "name": "Hot & Sour Soup", "price": 280, "category": "Soup"},
    {"id": "ws", "name": "Wonton Soup", "price": 300, "category": "Soup"},
    {"id": "tc", "name": "Thai Clear Soup", "price": 260, "category": "Soup"},
    {"id": "vs", "name": "Vegetable Soup", "price": 220, "category": "Soup"},
    {"id": "ty", "name": "Tom Yum Soup", "price": 320, "category": "Soup"},
    {"id": "cfr", "name": "Chicken Fried Rice", "price": 320, "category": "Rice"},
    {"id": "cco", "name": "Chicken Chili Onion", "price": 380, "category": "Chicken"},
    {"id": "cm", "name": "Chicken Masala", "price": 380, "category": "Chicken"},
    {"id": "cca", "name": "Chicken Cashew Nut", "price": 400, "category": "Chicken"},
    {"id": "bco", "name": "Beef Chili Onion", "price": 420, "category": "Beef"},
    {"id": "pm", "name": "Prawn Masala", "price": 480, "category": "Prawn"},
    {"id": "mv", "name": "Mixed Vegetable", "price": 260, "category": "Vegetable"},
]
KIDS = [
    {"id": "combo", "name": "Burger & Fries Combo", "price": 490, "category": "Burgers"},
    {"id": "fc", "name": "Fried Chicken", "price": 280, "category": "Chicken"},
    {"id": "ten", "name": "Chicken Tenders", "price": 300, "category": "Chicken"},
    {"id": "tower", "name": "Triple Cheese Tower", "price": 590, "category": "Burgers", "signature": True},
    {"id": "naga", "name": "Naga Burger", "price": 420, "category": "Burgers"},
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers"},
]


def chat(turns, items, replies=None, at="Tue 20:30"):
    """The turns through the waiter, the state carried as the server carries it; replies[i] = the model's answer."""
    sid, hist, state, outs = f"f-{os.getpid()}-{id(turns)}", [], None, []

    async def no_reading(*a, **k):
        return None

    for n, said in enumerate(turns):
        model = dict(TURN, **((replies or {}).get(n) or {}))

        async def fake(messages, model=model):
            return json.dumps(model)

        orig = brain._call_openai, brain._understand
        brain._call_openai, brain._understand = fake, no_reading
        try:
            out = asyncio.run(brain.generate_reply(said, menu_snapshot={"items": items}, locale="bn", history=hist,
                                                   dialog_state=state, restaurant={"staffAlerts": False},
                                                   context={"cartItems": [], "table": "5", "localTime": at}))
        finally:
            brain._call_openai, brain._understand = orig
        session_ctx.update_state("f", sid, meta=out["meta"], user_text=said)
        state = session_ctx.get_state("f", sid)
        hist += [{"role": "user", "content": said}, {"role": "assistant", "content": out["replyText"]}]
        outs.append(out)
    return outs


def cards(out):
    return [s["itemId"] for s in out["meta"].get("suggestions") or []]


def test_what_the_guest_asks_is_read_right():
    k = followups.ask_kind
    assert [k("আর কি আছে?"), k("অন্য কিছু দেখান"), k("আর কোনটা?"), k("এগুলো ভালো লাগছে না, অন্য কিছু বলেন")] == ["more"] * 4
    assert [k("ঝাল কিছু?"), k("ঝাল কম"), k("একটু হালকা কিছু"), k("মুরগির কিছু আছে?"), k("বার্গার ছাড়া কিছু?"),
            k("আরেকটু কম দামে")] == ["refine"] * 6
    assert [k("আপনি কোনটা বলবেন?"), k("এর মধ্যে কোনটা সবচেয়ে ভালো?"), k("একটা বলেন")] == ["pick"] * 3
    # not follow-ups: done ordering, an order, a long sentence with more in it
    assert [k("আর কিছু না"), k("আর একটা কোক দিন"), k("না, প্লেটার খাবো না, অন্য কিছু দিয়ে পেট ভরবো")] == [None] * 3


def test_more_soups_after_the_soups_never_the_same_ones():
    outs = chat(["স্যুপ কোনটা ভালো?", "আর কোনটা?", "আর কোনটা?", "অন্য কিছু?"], CHINESE)
    first, second = cards(outs[0]), outs[1]
    assert len(first) == 5 and second["meta"]["guards"] == ["thread_more"], (first, second["replyText"])
    assert cards(second) and not set(cards(second)) & set(first), (first, cards(second))  # the soups not yet said
    assert all("Soup" in brain.MenuIndex(CHINESE).by_id[i]["name"] for i in cards(second)), cards(second)
    assert second["replyText"].startswith("স্যুপের মধ্যে আরও আছে"), second["replyText"]
    assert outs[2]["meta"]["guards"] == ["thread_all_said"], outs[2]["replyText"]  # every soup said: honest
    # "অন্য কিছু" is something different: out of the soups
    other = outs[3]
    assert other["meta"]["guards"] == ["thread_more"] and other["replyText"].startswith("অন্যগুলোর মধ্যে আছে"), other["replyText"]
    assert not any("Soup" in brain.MenuIndex(CHINESE).by_id[i]["name"] for i in cards(other)), cards(other)


def test_refinements_add_up_and_the_pick_is_one_of_them():
    first = {"suggestions": [{"item": i} for i in ("bco", "pm", "cfr")], "replyText": "Beef Chili Onion, Prawn Masala…"}
    outs = chat(["এখন খাওয়ার মত কি আছে?", "চিকেনের কিছু?", "ঝাল কম", "এর মধ্যে কোনটা নেব?"], CHINESE, {0: first})
    chicken, mild, pick = outs[1], outs[2], outs[3]
    assert set(cards(chicken)) <= {"cfr", "cco", "cm", "cca"} and chicken["replyText"].startswith("মুরগির মধ্যে আছে")
    assert mild["replyText"].startswith("মুরগির মধ্যে ঝাল কম আছে"), mild["replyText"]
    assert set(cards(mild)) <= {"cfr", "cca"} and cards(mild), cards(mild)  # (chili onion / masala are spicy)
    assert pick["meta"]["guards"] == ["thread_pick"] and cards(pick)[0] in cards(mild), (pick["replyText"], cards(mild))
    assert pick["replyText"].startswith("এগুলোর মধ্যে আমি বলব"), pick["replyText"]


def test_kids_more_stays_kid_friendly():
    first = {"suggestions": [{"item": i} for i in ("combo", "fc")], "replyText": "Burger & Fries Combo বা Fried Chicken।"}
    outs = chat(["বাচ্চার জন্য কি ভালো?", "আর কিছু?"], KIDS, {0: first}, at="Tue 13:30")
    more = cards(outs[1])
    assert more and "tower" not in more and "naga" not in more, outs[1]["replyText"]


def test_a_kind_left_out_stays_out():
    first = {"suggestions": [{"item": i} for i in ("tower", "smash", "combo")], "replyText": "…"}
    outs = chat(["এখন খাওয়ার মত কি আছে?", "বার্গার ছাড়া কিছু?"], KIDS, {0: first})
    assert outs[1]["meta"]["guards"] == ["thread_refine"] and set(cards(outs[1])) <= {"fc", "ten"}, outs[1]["replyText"]
    assert outs[1]["replyText"].startswith("বার্গার ছাড়া আছে"), outs[1]["replyText"]


def test_a_classic_burger_and_a_chocolate_brownie_are_no_drinks():
    import menu_answers
    c = menu_answers.course
    assert c({"name": "Classic Smash Burger", "category": "Burgers"}) == "main"
    assert c({"name": "Chocolate Brownie", "category": "Desserts"}) == "dessert"
    assert c({"name": "Classic Fries", "category": "Sides"}) == "side"
    assert c({"name": "Mango Lassi", "category": "Drinks"}) == "drink" and c({"name": "Coca-Cola", "category": "Drinks"}) == "drink"
