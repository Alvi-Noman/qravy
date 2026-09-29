"""Replays of real conversations (fine_tuning/review_transcripts-20260929.jsonl):
  - "কতক্ষণ লাগবে?" with a full tray must answer the time — never pitch another dish
  - "কি কি আছে আপনার রেস্টুরেন্টে?" opens the menu; a reply that lists dishes shows them as cards
  - "ভালো কোনটা হবে?" right after that is about the dishes just named — answered by what's GOOD (not heat), as cards
Run: python tests/test_menu_talk.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402

ITEMS = [
    {"id": "crs", "name": "Crispy Rice Soup", "price": 300, "category": "Soup", "prepMinutes": 10},
    {"id": "hss", "name": "Hot & Sour Soup", "price": 320, "category": "Soup", "prepMinutes": 10},
    {"id": "szs", "name": "Szu-Chuan Soup", "price": 320, "category": "Soup", "prepMinutes": 10},
    {"id": "ccs", "name": "Chicken Corn Soup", "price": 280, "category": "Soup", "prepMinutes": 8},
    {"id": "cns", "name": "Chicken Cashew Nut Salad (regular)", "price": 350, "category": "Salad", "prepMinutes": 8},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer", "prepMinutes": 7},
    {"id": "sfp", "name": "Special Fried Prawn", "price": 480, "category": "Prawn", "prepMinutes": 15},
    {"id": "brc", "name": "Beef with Red Curry", "price": 450, "category": "Beef", "prepMinutes": 18, "signature": True},
    {"id": "onr", "name": "Onion Ring", "price": 180, "category": "Appetizer", "prepMinutes": 9},
    {"id": "cco", "name": "Chicken Chili Onion", "price": 380, "category": "Chicken", "prepMinutes": 15},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": ""}
KITCHEN = {"queueMinutes": 0, "busy": "quiet", "ordersInKitchen": 0, "myOrders": [],
           "settings": {"defaultPrepMinutes": 15, "parallelOrders": 3}}
TRAY = [{"itemId": "hss", "quantity": 2, "price": 320}, {"itemId": "cns", "quantity": 2, "price": 350}]


def ref(item_id):
    return IDX.ref(IDX.by_id[item_id])


def run(text, model, cart=(), kitchen=KITCHEN, state=None, history=None, shown=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **model})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        ctx = {"cartItems": [dict(c) for c in cart], "mealKinds": ["breakfast"], "kitchen": kitchen}
        if shown:
            ctx["shownItems"] = shown
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": ITEMS}, locale="bn", history=history,
                                               dialog_state=state, context=ctx))
    finally:
        brain._call_openai = orig
    return out, calls


def test_how_long_with_a_tray_answers_the_time_and_pitches_nothing():
    out, calls = run("কতক্ষণ লাগবে?", {}, cart=TRAY)
    assert not calls, "answered from the real numbers"
    assert "মিনিট" in out["replyText"] and "Szu-Chuan" not in out["replyText"]
    assert out["meta"]["suggestions"] == [] and out["meta"]["cartOps"] == []
    # a long, rambling time question goes to the model — in QUIET mode, and a pitch it adds anyway is dropped
    real = {"topic": "item_question", "replyText": "সাধারণত ১৫-২০ মিনিট সময় লাগে। এর মধ্যে Szu-Chuan Soup নিতে পারেন।",
            "suggestions": [{"item": ref("szs"), "reason": "breakfast এর জন্য দারুণ"}]}
    long_q = ("ভাই একটা কথা জিজ্ঞেস করি, আমরা যেগুলো নিলাম সেগুলো টেবিলে আসতে মোটামুটি কতক্ষণ লাগবে "
              "বলে আপনার মনে হয় একটু বলবেন ভাই")
    out, calls = run(long_q, real, cart=TRAY)
    assert "RECOMMENDATION MODE: QUIET" in calls[0][-1]["content"]
    assert out["meta"]["suggestions"] == [] and not out["meta"]["decision"]["showSuggestionsModal"]
    assert out["meta"]["cartOps"] == []


def test_whats_on_the_menu_opens_the_menu_instead_of_reading_it_out():
    for said in ("মেনুতে কি কি খাবারের তালিকা আছে একটু বিস্তারিত জানাবেন?", "মেনুটা দেখান", "মেনুতে কী আছে?",
                 "show me the menu", "what's on your menu?"):
        out, calls = run(said, {"replyText": "MODEL"})
        assert not calls, said
        assert out["meta"]["decision"]["openMenu"] is True and out["meta"]["intent"] == "menu", said
        assert "মেনু" in out["replyText"] or "menu" in out["replyText"], said
        assert out["meta"]["suggestions"] == []
    # asking for a pick, or about one kind of food, is not "show me the menu"
    for said in ("কি কি আছে, ভালো কোনটা?",):
        _, calls = run(said, {"topic": "recommendation", "replyText": "Beef with Red Curry দারুণ — দেব?"})
        assert calls, said
    # "কী কী আছে আমার?" = what is in MY tray — never the menu
    out, _ = run("কী কী আছে আমার?", {"topic": "order_review", "replyText": "…"}, cart=TRAY)
    assert not out["meta"]["decision"].get("openMenu")


LISTED = ("আজকে কী ভালো হবে? Crispy Rice Soup, Chicken Corn Soup, Special Fried Prawn আর Beef with Red Curry — "
          "আপনার জন্য কোনটা দেব?")


def test_a_reply_that_lists_dishes_becomes_cards_and_is_asked_to_stop_reading_them_out():
    real = {"topic": "recommendation", "replyText": LISTED, "suggestions": [{"item": ref("crs"), "reason": "light"}]}
    out, calls = run("আজকে কী ভালো হবে?", real)
    assert len(calls) == 1  # the waiter's own words are kept as they are — no rewrite to make it shorter
    m = out["meta"]
    assert m["intent"] == "suggestions" and m["decision"]["showSuggestionsModal"] is True
    assert len(m["suggestions"]) == 4 and m["suggestions"][0]["title"] == "Crispy Rice Soup"
    return out


def test_which_is_good_after_the_tour_is_about_those_dishes_and_shows_them():
    tour = test_a_reply_that_lists_dishes_becomes_cards_and_is_asked_to_stop_reading_them_out()
    history = [{"role": "user", "content": "আজকে কী ভালো হবে?"},
               {"role": "assistant", "content": tour["replyText"]}]
    listed = [s["itemId"] for s in tour["meta"]["suggestions"]]
    real = {"topic": "recommendation", "answerItems": [ref("brc")],
            "replyText": "আমি বলব Beef with Red Curry — এটা আমাদের সিগনেচার ডিশ। নেবেন?"}
    out, calls = run("ভালো কোনটা হবে?", real, state={"reco": tour["meta"]["reco"]}, history=history)
    turn = calls[0][-1]["content"]
    assert "RECOMMENDATION MODE: COMPARE" in turn and "NOT heat" in turn
    m = out["meta"]
    # nothing was on screen → the dishes just named come back as cards, the pick first and highlighted
    assert m["decision"]["showSuggestionsModal"] is True and m["intent"] == "suggestions"
    assert m["suggestions"][0]["itemId"] == "brc" and {s["itemId"] for s in m["suggestions"]} <= set(listed) | {"brc"}
    assert m["highlight"] == ["brc"] and "onScreen" not in m


def test_which_is_good_about_cards_on_screen_keeps_that_list():
    real = {"topic": "recommendation", "answerItems": [ref("ccs")], "replyText": "Chicken Corn Soup ভালো হবে।"}
    out, _ = run("এগুলোর মধ্যে ভালো কোনটা?", real, shown=["crs", "ccs", "ff"])
    m = out["meta"]
    assert m["suggestions"] == [] and m["highlight"] == ["ccs"] and m["onScreen"] == ["crs", "ccs", "ff"]


def test_a_craving_is_a_recommendation_and_opens_the_cards():
    from recommender import asks_for_recommendation

    for said in ("আমি হালকা কিছু খেতে যাচ্ছি।", "আমি ঝাল কিছু খেতে যাচ্ছি।", "কিছু খেতে চাই", "halka kichu khabo"):
        assert asks_for_recommendation(said), said
    # the model named one dish (as it did in the real transcript) → still shown as a card
    real = {"topic": "recommendation", "replyText": "হালকা কিছু চাইলে Chicken Corn Soup খুব ভালো হবে।",
            "suggestions": [{"item": ref("ccs"), "reason": "light"}]}
    out, calls = run("আমি হালকা কিছু খেতে যাচ্ছি।", real)
    assert "RECOMMENDATION MODE: FULL" in calls[0][-1]["content"]
    m = out["meta"]
    assert m["intent"] == "suggestions" and m["decision"]["showSuggestionsModal"] is True
    assert m["suggestions"][0]["itemId"] == "ccs" and len(m["suggestions"]) == 3  # its pick first, topped up to 3


def test_how_long_to_make_a_dish_in_bangla_with_an_order_already_in_the_kitchen():
    # the real transcript: order #6 was in the kitchen, and the guest asked about a dish by its Bangla name
    k = {**KITCHEN, "myOrders": [{"orderNumber": 6, "status": "placed", "minutesLeft": 0, "late": False,
                                  "hasEta": False, "items": ["Hot & Sour Soup"]}]}
    out, calls = run("অনিয়ন রিং বানাতে কতক্ষণ লাগবে?", {}, kitchen=k)
    assert not calls and out["meta"]["notes"] == "wait_dish", out["replyText"]
    assert out["replyText"].startswith("Onion Ring তৈরি হতে 9 মিনিটের মতো লাগে")
    out, _ = run("স্পেশাল ফ্রাইড প্রন বানাতে কতক্ষণ লাগবে?", {}, kitchen=k)
    assert out["replyText"].startswith("Special Fried Prawn তৈরি হতে 15 মিনিটের মতো লাগে")
    # plural as said: "রিংস" → Onion Ring, answered from the numbers (not the AI guessing from the queue)
    busy = {**k, "queueMinutes": 19, "busy": "busy", "ordersInKitchen": 3}
    out, calls = run("অনিয়ন রিংস বানাতে কতক্ষণ লাগবে?", {}, kitchen=busy)
    assert not calls and out["replyText"].startswith("Onion Ring তৈরি হতে 9 মিনিটের মতো লাগে"), out["replyText"]
    assert "30 মিনিটের মতো" in out["replyText"]  # 9 to make + 19 waiting ≈ 30
    # a dish we can't make out → the model (with the menu's prep times), never the order status
    out, calls = run("ওই জিনিসটা বানাতে কতক্ষণ লাগবে?", {"topic": "wait_time", "replyText": "কোন খাবারটার কথা বলছেন?"}, kitchen=k)
    assert calls and "অর্ডার কিচেনে" not in out["replyText"]
    assert "NOT a dish's cooking time" in calls[0][-1]["content"]
    # "where's my food?" is still the order status
    out, calls = run("আমার খাবার কখন আসবে?", {}, kitchen=k)
    assert not calls and out["meta"]["notes"] == "wait_placed_order"


def test_leaning_towards_a_dish_is_offered_and_yes_adds_it():
    # "আমার জন্য বিফ উইথ রেড কারিটা ভালো হয় মনে হয়" → "…দেব?" (not "আর কিছু জানতে চান?")
    real = {"topic": "item_question", "replyText": "Beef with Red Curry একটু ঝাল আর দারুণ স্বাদের। দেব?"}
    out, calls = run("আমার জন্য Beef with Red Curry-টা ভালো হয় মনে হয়।", real)
    assert "never end with" in calls[0][0]["content"]  # the playbook rule
    assert out["meta"]["reco"]["last_offered"][0] == "brc"
    history = [{"role": "user", "content": "আমার জন্য Beef with Red Curry-টা ভালো হয় মনে হয়।"},
               {"role": "assistant", "content": out["replyText"]}]
    yes, _ = run("হ্যাঁ, দিন", {}, state={"reco": out["meta"]["reco"]}, history=history)
    assert [(o["op"], o["itemId"]) for o in yes["meta"]["cartOps"]] == [("add", "brc")]


def test_confirm_with_an_empty_tray_offers_the_dish_just_talked_about():
    real = {"topic": "item_question", "replyText": "Beef with Red Curry একটু ঝাল আর দারুণ স্বাদের। দেব?"}
    first, _ = run("আমার জন্য Beef with Red Curry-টা ভালো হয় মনে হয়।", real)
    out, calls = run("আমি এটা অর্ডার কনফার্ম করতে চাচ্ছি।", {}, state={"reco": first["meta"]["reco"]})
    assert not calls and out["replyText"] == "আপনার ট্রে এখনো খালি — Beef with Red Curry দেব?"
    history = [{"role": "assistant", "content": out["replyText"]}]
    yes, _ = run("হ্যাঁ", {}, state={"reco": out["meta"]["reco"]}, history=history)
    assert [(o["op"], o["itemId"]) for o in yes["meta"]["cartOps"]] == [("add", "brc")]


def test_a_recommendation_is_at_least_three_cards_and_never_talks_about_the_screen():
    # the real turn: one dish named, "বাকিগুলো স্ক্রিনে দিলাম" said — but only one card
    real = {"topic": "recommendation",
            "replyText": "আপনি Crispy Rice Soup ট্রাই করতে পারেন, এটা দুপুরের জন্য দারুণ। বাকিগুলো স্ক্রিনে দিলাম — কোনটা নিতে চান, বলুন?",
            "suggestions": [{"item": ref("crs"), "reason": "light"}]}
    out, _ = run("দুপুরে কী খাওয়া যায়?", real)
    m = out["meta"]
    assert len(m["suggestions"]) == 3 and m["suggestions"][0]["itemId"] == "crs", m["suggestions"]
    assert m["decision"]["showSuggestionsModal"] is True
    assert "স্ক্রিনে" not in out["replyText"] and out["replyText"].endswith("কোনটা অর্ডার করতে চান, বলুন?"), out["replyText"]
    # the real turn after that: "…আপনি এটা নিতে চান?" → the waiter's own sentence, with "অর্ডার করতে চান"
    real2 = {"topic": "recommendation", "replyText": "আজ রাতে Beef with Red Curry খুব ভালো অপশন। আপনি এটা নিতে চান?",
             "suggestions": [{"item": ref("brc"), "reason": "signature"}]}
    out2, calls2 = run("আমি কি আজ খাবো?", real2)
    assert out2["replyText"].endswith("খুব ভালো অপশন। আপনি এটা অর্ডার করতে চান?"), out2["replyText"]
    # never "নেবেন" / "দেব" — and a question already about ordering is left exactly as the waiter said it
    assert brain._order_wording("দারুণ হবে। নেবেন কি?", "bn") == "দারুণ হবে। অর্ডার করবেন কি?"
    assert brain._order_wording("এগুলো ভালো। কোনটা দেব আপনাকে?", "bn") == "এগুলো ভালো। কোনটা অর্ডার করবেন?"
    assert brain._order_wording("দারুণ। এর মধ্যে কোনটা অর্ডার করবেন?", "bn") == "দারুণ। এর মধ্যে কোনটা অর্ডার করবেন?"
    assert brain._order_wording("Great picks. Which one would you like?", "en") == "Great picks. Which one would you like to order?"
    # the brevity rules are gone — the waiter recommends in its own words, as before
    prompt = calls2[0][0]["content"] + calls2[0][-1]["content"]
    assert "TALK THROUGH" not in prompt and "2–4 sentences" not in prompt and "at most TWO" not in prompt
    # same kind first: the top-ups start with the other soups
    assert (brain.MenuIndex(ITEMS).by_id[m["suggestions"][1]["itemId"]]).get("category") == "Soup"
    # asked for exactly one → one card
    one = {"topic": "recommendation", "replyText": "Crispy Rice Soup দারুণ হবে — দেব?",
           "suggestions": [{"item": ref("crs"), "reason": "light"}]}
    out, _ = run("একটা স্যুপ সাজেস্ট করেন", one)
    assert [s["itemId"] for s in out["meta"]["suggestions"]] == ["crs"]


def test_what_do_you_have_is_recommendation_cards_not_the_menu_page():
    # the real turn: "হ্যালো কি আছো আপনাদের?" (আছো = misheard আছে) — was a plain hello with one dish inline
    real = {"topic": "greeting", "replyText": "হ্যালো! আপনাকে স্বাগতম। আজকে Beef with Red Curry খুব ভালো হবে। কোনটা নিতে চান, বলুন?",
            "suggestions": [{"item": ref("brc"), "reason": "signature"}]}
    for said in ("হ্যালো কি আছো আপনাদের?", "কি কি আছে আপনার রেস্টুরেন্টে?", "what do you have?", "আপনাদের এখানে কী পাওয়া যায়?"):
        out, calls = run(said, real)
        assert calls and "RECOMMENDATION MODE: OVERVIEW" in calls[0][-1]["content"], said
        m = out["meta"]
        assert not m["decision"].get("openMenu"), said
        assert m["decision"]["showSuggestionsModal"] is True and len(m["suggestions"]) >= 3, said
        assert m["suggestions"][0]["itemId"] == "brc", said


def test_any_suggested_dish_opens_the_cards_but_a_dish_asked_about_does_not():
    # a greeting that pitches one dish, with nothing in suggestions → cards, topped up to 3
    real = {"topic": "greeting", "replyText": "হ্যালো! আজকে Beef with Red Curry খুব ভালো হবে। কী দেব?"}
    out, _ = run("হ্যালো", real)
    assert out["meta"]["decision"]["showSuggestionsModal"] is True and len(out["meta"]["suggestions"]) == 3
    # asking about one dish (in Bangla script) is an answer about THAT dish, not a pitch → no cards
    real = {"topic": "item_question", "replyText": "Beef with Red Curry সাধারণত একটু ঝাল হয়।"}
    out, _ = run("বিফ উইথ রেড কারি কি ঝাল?", real)
    assert not out["meta"]["decision"]["showSuggestionsModal"] and out["meta"]["suggestions"] == []


def test_six_pm_is_not_lunch():
    from waiter_knowledge import meal_kinds
    assert meal_kinds(["Afternoon"], 17) == ["afternoon"]  # "afternoon" contains "noon" — it is not lunch
    assert meal_kinds(["Lunch"], 13) == ["lunch"]
    assert meal_kinds(["Dinner"], 18) == ["dinner"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
