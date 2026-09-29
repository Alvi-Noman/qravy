"""Offline tests for wait-time estimation: the engine (same vectors as auth-service waitTime.test.ts), the waiter's
wording, and the brain answering time questions from real numbers — without a model call.
Run: python tests/test_wait_time.py"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import checkout  # noqa: E402
import wait_talk  # noqa: E402
import wait_time as wt  # noqa: E402
from recommender import GuestProfile, rank  # noqa: E402

NOW = datetime(2026, 9, 29, 12, 0, 0)


def at(minutes):
    return NOW + timedelta(minutes=minutes)


# ------------------------------------------------------------------ engine (mirrors waitTime.ts)


def test_dish_and_line_minutes():
    pizza = {"prepMinutes": 15, "variations": [{"name": "Small"}, {"name": "Large", "prepMinutes": 22}]}
    assert wt.dish_minutes(pizza, "Large") == (22, False)
    assert wt.dish_minutes(pizza, "small") == (15, False)
    assert wt.dish_minutes({}, None, 12) == (12, True)
    assert wt.dish_range(pizza) == (15, 22)
    assert [wt.clamp_prep(v) for v in (7.6, "20", 0, -3, 999, None)] == [8, 20, None, None, 240, None]
    assert [wt.line_minutes(20, 1), wt.line_minutes(20, 3), wt.line_minutes(10, 20), wt.line_minutes(2, 4)] == [20, 28, 20, 4]
    assert wt.order_prep_minutes([]) == 0
    assert wt.order_prep_minutes([(18, 1), (3, 2), (10, 1)]) == 20
    assert wt.order_prep_minutes([(5, 1)] * 9) == 10


def test_kitchen_queue():
    assert wt.queue_minutes([], 3, NOW) == 0
    ahead = [
        {"status": "preparing", "prepMinutes": 20, "readyAt": at(8)},
        {"status": "placed", "prepMinutes": 15},
        {"status": "accepted", "prepMinutes": 12},
    ]
    assert wt.queue_minutes(ahead, 3, NOW) == 8
    assert wt.queue_minutes(ahead, 2, NOW) == 15
    assert wt.queue_minutes(ahead, 1, NOW) == 35
    assert wt.queue_minutes([{"status": "ready", "prepMinutes": 30},
                             {"status": "preparing", "prepMinutes": 20, "readyAt": at(-5)}], 1, NOW) == 0
    e = wt.estimate([({"prepMinutes": 18}, None, 2), ({}, None, 1)],
                    [{"status": "preparing", "prepMinutes": 10, "readyAt": at(6)}],
                    {"defaultPrepMinutes": 15, "parallelOrders": 1}, NOW)
    assert e == {"prepMinutes": 23, "queueMinutes": 6, "totalMinutes": 29, "estimated": True}
    assert wt.kitchen_settings(None) == {"defaultPrepMinutes": 15, "parallelOrders": 3}
    assert wt.kitchen_settings({"kitchen": {"parallelOrders": 0}})["parallelOrders"] == 3
    assert [wt.busy_level(q) for q in (0, 10, 25)] == ["quiet", "normal", "busy"]
    assert wt.minutes_left(at(4.2), NOW) == 5 and wt.minutes_left(at(-3), NOW) == 0


def test_how_a_waiter_rounds():
    assert [wt.round_for_guest(m) for m in (1, 7, 10, 11, 23, 26)] == [1, 7, 10, 15, 25, 30]
    assert wt.say_minutes(23, "en") == "about 25 minutes"
    assert wt.say_minutes(8, "bn") == "8 মিনিটের মতো"
    assert wt.say_range(12, 22, "en") == "15–25 minutes"


def test_time_questions_are_recognised():
    for q in ("how long will it take?", "How long does the kacchi take", "when will my food come?", "কতক্ষণ লাগবে?",
              "খাবার কখন আসবে?", "আর কত সময় লাগবে", "koto khon lagbe", "is it quick?", "where's my food"):
        assert wt.asks_time(q), q
    for q in ("what's the quickest dish?", "something fast please", "we're in a hurry", "সবচেয়ে তাড়াতাড়ি কী হবে?", "তাড়া আছে"):
        assert wt.asks_quickest(q), q
    for q in ("is it spicy?", "2 kacchi please", "what's in the soup?", "কাচ্চি দিন"):
        assert not wt.asks_time(q) and not wt.asks_quickest(q), q


# ------------------------------------------------------------------ the waiter's words

KITCHEN_QUIET = {"queueMinutes": 0, "busy": "quiet", "ordersInKitchen": 0, "myOrders": [],
                 "settings": {"defaultPrepMinutes": 15, "parallelOrders": 3}}
KITCHEN_BUSY = {**KITCHEN_QUIET, "queueMinutes": 12, "busy": "normal", "ordersInKitchen": 5}


def test_placed_order_replies():
    k = {**KITCHEN_QUIET, "myOrders": [{"orderNumber": 7, "status": "preparing", "minutesLeft": 6, "late": False,
                                        "hasEta": True, "items": ["Kacchi Biryani"]}]}
    assert wait_talk.placed_order_reply(k, "en") == "Your food is being prepared — about 6 minutes to go."
    k["myOrders"][0].update(late=True, minutesLeft=0)
    assert "longer than expected" in wait_talk.placed_order_reply(k, "en")
    k["myOrders"][0].update(status="ready")
    assert "ready" in wait_talk.placed_order_reply(k, "en")
    assert wait_talk.placed_order_reply(KITCHEN_QUIET, "en") is None
    k2 = {**KITCHEN_QUIET, "myOrders": [{"orderNumber": 8, "status": "placed", "minutesLeft": 22, "late": False,
                                         "hasEta": True, "items": []}]}
    assert "২" not in wait_talk.placed_order_reply(k2, "bn") and "25 মিনিটের মতো" in wait_talk.placed_order_reply(k2, "bn")


def test_read_back_and_confirmation_carry_the_eta():
    rows = [{"itemId": "kb", "name": "Kacchi Biryani", "quantity": 1, "price": 420}]
    text = checkout.readback_text(rows, "12", "en", "", wait_talk.eta_hint({"totalMinutes": 18}, "en"))
    assert text.endswith("It'll be ready in about 20 minutes. Shall I place it?")
    placed = checkout.placed_text({}, "en", wait_talk.placed_hint({"eta": {"minutesLeft": 18}}, "en"))
    assert placed.startswith("Your order is confirmed.") and "about 20 minutes" in placed
    # no ETA (older auth-service) → the old sentence
    assert checkout.placed_text({}, "en", wait_talk.placed_hint({}, "en")).startswith("Your order is confirmed. Please sit back")


# ------------------------------------------------------------------ the brain, end to end (no model)

ITEMS = [
    {"id": "sr", "name": "Spring Roll", "price": 230, "category": "Appetizer", "prepMinutes": 8},
    {"id": "cs", "name": "Chicken Corn Soup", "price": 280, "category": "Soup", "prepMinutes": 10},
    {"id": "kb", "name": "Kacchi Biryani", "price": 420, "category": "Biryani", "prepMinutes": 10,
     "variations": [{"name": "Half", "price": 420}, {"name": "Full", "price": 780, "prepMinutes": 14}]},
    {"id": "wf", "name": "Whole Fish Sizzling", "price": 950, "category": "Sizzling", "prepMinutes": 28},
    {"id": "pf", "name": "Prawn Fried Rice", "price": 320, "category": "Rice"},  # no time set → default 15
    {"id": "ck", "name": "Coke", "price": 60, "category": "Beverage", "prepMinutes": 1},
]
TURN = {"topic": "other", "intent": "menu", "language": "en", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}


def run(text, cart=(), kitchen=KITCHEN_QUIET, locale="en", state=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(TURN)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale=locale, dialog_state=state,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["lunch"], "kitchen": kitchen}))
    finally:
        brain._call_openai = orig
    return out, calls


def test_how_long_does_a_dish_take():
    out, calls = run("How long does the Kacchi Biryani take?")
    assert not calls, "answered from the numbers, no model"
    assert out["replyText"].startswith("The Kacchi Biryani takes 10–15 minutes to make, depending on the size.")
    assert out["replyText"].endswith("Shall I add it?") and out["meta"]["topic"] == "wait_time"
    # busy kitchen → how long if ordered now
    out, _ = run("how long for the whole fish sizzling?", kitchen=KITCHEN_BUSY)
    assert "if you order now it'd be ready in about 40 minutes" in out["replyText"]


def test_yes_after_the_time_answer_adds_the_dish():
    out, _ = run("how long does the spring roll take?")
    history = [{"role": "user", "content": "how long does the spring roll take?"},
               {"role": "assistant", "content": out["replyText"]}]
    state = {"reco": out["meta"]["reco"]}

    async def fake(messages):
        return json.dumps(TURN)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        yes = asyncio.run(brain.generate_reply("yes please", menu_snapshot={"items": ITEMS}, locale="en",
                                               history=history, dialog_state=state,
                                               context={"cartItems": [], "mealKinds": ["lunch"], "kitchen": KITCHEN_QUIET}))
    finally:
        brain._call_openai = orig
    assert [(o["op"], o["itemId"]) for o in yes["meta"]["cartOps"]] == [("add", "sr")]


def test_how_long_for_my_tray():
    cart = [{"itemId": "kb", "quantity": 2, "price": 780, "variation": "Full"}, {"itemId": "sr", "quantity": 1, "price": 230}]
    out, calls = run("how long will my order take?", cart=cart, kitchen=KITCHEN_BUSY)
    assert not calls
    # Full kacchi 14 min × 2 → 17, +1 for the second dish = 18 prep, +12 queue = 30
    assert out["replyText"].startswith("If you order now, your food should be ready in about 30 minutes — the Kacchi Biryani")
    assert "orders ahead" in out["replyText"] and out["meta"]["cartOps"] == []


def test_wheres_my_food_after_ordering():
    k = {**KITCHEN_QUIET, "myOrders": [{"orderNumber": 4, "status": "preparing", "minutesLeft": 7, "late": False,
                                        "hasEta": True, "items": ["Kacchi Biryani"]}]}
    out, calls = run("খাবার কখন আসবে?", kitchen=k, locale="bn")
    assert not calls and "আর 7 মিনিটের মতো লাগবে" in out["replyText"]
    out, _ = run("where's my food?", kitchen=k)
    assert out["replyText"] == "Your food is being prepared — about 7 minutes to go."


def test_lagbe_means_takes_in_a_time_question_but_need_in_an_order():
    # "কতক্ষণ লাগবে?" = how long will it take → answered from the numbers
    out, calls = run("Kacchi Biryani হতে কতক্ষণ লাগবে?", locale="bn")
    assert not calls and "Kacchi Biryani তৈরি হতে" in out["replyText"] and out["replyText"].endswith("দেব?")
    out, calls = run("koto khon lagbe?", cart=[{"itemId": "sr", "quantity": 1, "price": 230}], locale="bn")
    assert not calls and out["meta"]["notes"] == "wait_cart"
    # "২টা কাচ্চি লাগবে, কতক্ষণ?" = I need 2 kacchi (an order) + a time question → the model does both
    out, calls = run("২টা Kacchi Biryani লাগবে, কতক্ষণ হবে?", locale="bn")
    assert calls, "an order in the same breath goes to the model"


def test_whats_quickest_respects_the_guest():
    out, calls = run("what's the quickest thing you have?")
    assert not calls
    names = [s["title"] for s in out["meta"]["suggestions"]]
    assert names == ["Spring Roll", "Chicken Corn Soup", "Kacchi Biryani"]  # drinks aren't a meal; untimed dishes can't be ranked
    assert out["meta"]["decision"]["showSuggestionsModal"] is True
    assert out["replyText"].startswith("Quickest right now: the Spring Roll (about 8 minutes)")
    # "the first one" / "yes" next turn refers to these
    assert out["meta"]["reco"]["last_offered"] == ["sr", "cs", "kb"]


def test_order_and_time_in_one_breath_goes_to_the_model_with_the_numbers():
    out, calls = run("add 2 kacchi biryani full, how long will it take?")
    assert calls, "an order in the same breath is the model's job"
    turn = calls[0][-1]["content"]
    assert "WAIT TIMES (real numbers" in turn and "Kacchi Biryani: 10–14 min to make" in turn
    assert "prep 10-14 min" in calls[0][1]["content"]  # the catalog shows the kitchen time
    assert "prep ~" not in calls[0][1]["content"].split("Prawn Fried Rice")[1].split("\n")[0]  # no time set → not shown


def test_general_question_and_no_kitchen_view():
    out, calls = run("how long does food usually take here?")
    assert not calls
    # food times 8, 10, 10, 15 (default), 28 → the middle half: 10–15
    assert out["replyText"].startswith("Most dishes take 10–15 minutes to make. The kitchen is quiet right now")
    # evals / older servers without a kitchen view: the model answers (no WAIT TIMES block)
    out, calls = run("is it spicy?", kitchen=None)
    assert calls and "WAIT TIMES" not in calls[0][-1]["content"]


def test_in_a_hurry_ranks_fast_dishes_first():
    import waiter_knowledge
    idx = waiter_knowledge.MenuIndex(ITEMS)
    orderable = {i["id"]: True for i in ITEMS}
    picks, _ = rank(idx, orderable, ["lunch"], GuestProfile(mood=["quick"]))
    names = [p.item["name"] for p in picks]
    assert names.index("Spring Roll") < names.index("Whole Fish Sizzling")
    assert any("ready in about 8 min" in r for p in picks for r in p.reasons)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
