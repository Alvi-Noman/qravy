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
    {"id": "csz", "name": "Chicken Sizzling", "price": 400, "category": "Sizzling"},
    {"id": "bsz", "name": "Beef Sizzling", "price": 450, "category": "Sizzling"},
    {"id": "psz", "name": "Prawn Sizzling", "price": 430, "category": "Sizzling"},
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
        out, _ = run(said, {"topic": "recommendation", "replyText": "Beef with Red Curry দারুণ — দেব?"})
        assert not out["meta"]["decision"].get("openMenu") and out["meta"]["suggestions"], said  # a pick, as cards
    # "কী কী আছে আমার?" = what is in MY tray — never the menu
    out, _ = run("কী কী আছে আমার?", {"topic": "order_review", "replyText": "…"}, cart=TRAY)
    assert not out["meta"]["decision"].get("openMenu")


LISTED = ("আজকে কী ভালো হবে? Crispy Rice Soup, Chicken Corn Soup, Special Fried Prawn আর Beef with Red Curry — "
          "আপনার জন্য কোনটা দেব?")


def test_a_reply_that_lists_dishes_becomes_cards_and_is_asked_to_stop_reading_them_out():
    real = {"topic": "recommendation", "replyText": LISTED, "suggestions": [{"item": ref("crs"), "reason": "light"}]}
    out, calls = run("আজকে হালকা কী ভালো হবে?", real)  # (plain "what's good" has a fixed shape)
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
    out, _ = run("দুপুরে হালকা কী খাওয়া যায়?", real)  # (plain "what can I eat" has a fixed shape)
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
        assert not calls and out["meta"]["notes"] == "menu_overview", said  # the fixed format (see below)
        m = out["meta"]
        assert not m["decision"].get("openMenu"), said
        assert m["decision"]["showSuggestionsModal"] is True and len(m["suggestions"]) >= 3, said


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


def test_sizzling_alone_asks_which_even_if_chicken_was_said_earlier():
    # the real turns: "চিকেন ফ্রাইড রাইস" … later "সাথে সুজার সিজলিং দিয়েছেন" (misheard) → it added Chicken Sizzling
    history = [{"role": "user", "content": "চিকেন ফ্রাইড রাইস"},
               {"role": "assistant", "content": "Chicken Corn Soup দারুণ। অর্ডার করতে চান?"},
               {"role": "user", "content": "মিনারেল ওয়াটার ছোটটা দিয়েন"},
               {"role": "assistant", "content": "যোগ করলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"}]
    model = {"topic": "order_change", "intent": "order", "replyText": "Chicken Sizzling যোগ করলাম।",
             "cartOps": [{"op": "add", "item": ref("csz"), "line": "", "quantity": 1, "variant": "", "note": "",
                          "removeNote": False, "choices": []}]}
    out, _ = run("সাথে সুজার সিজলিং দিয়েছেন।", model, history=history)
    assert out["meta"]["cartOps"] == [], out["replyText"]
    assert "Beef Sizzling" in out["replyText"] and "Prawn Sizzling" in out["replyText"], out["replyText"]
    # …and answering the question works: "চিকেনটা" right after "Chicken, Beef or Prawn Sizzling?"
    history2 = history + [{"role": "user", "content": "সাথে সুজার সিজলিং দিয়েছেন।"}, {"role": "assistant", "content": out["replyText"]}]
    out2, _ = run("চিকেনটা", model, history=history2)
    assert [(o["op"], o["itemId"]) for o in out2["meta"]["cartOps"]] == [("add", "csz")], out2["replyText"]


def test_fried_rice_is_never_bhat_and_chowmein_is_not_noodles():
    real = {"topic": "recommendation",
            "replyText": "Choice of 2 Curry-তে ভাত আর সবজির সঙ্গে দুই ধরনের কারি পাবেন, আর ভাতের সাথে Beef with Red Curry দারুণ। কোনটা অর্ডার করতে চান?",
            "suggestions": [{"item": ref("brc"), "reason": "signature"}]}
    out, calls = run("আজকে হালকা কী ভালো হবে?", real)  # (plain "what's good" has a fixed shape)
    assert "ভাত" not in out["replyText"] and "ফ্রাইড রাইস আর সবজির" in out["replyText"] and "ফ্রাইড রাইসের সাথে" in out["replyText"]
    assert "never lump them" in calls[0][0]["content"]
    # a menu WITH plain rice keeps "ভাত"
    import brain as b
    assert b._HAS_PLAIN_RICE(b.MenuIndex([{"id": "r", "name": "Plain Rice", "price": 60}]))


def test_sounds_like_a_real_waiter_not_a_menu_being_read():
    real = {"topic": "recommendation",
            "replyText": "আমাদের মেনুতে আছে বিফ সেলেক্টিওন, চিকেন সেলেক্টিওন, স্যুপ আর সিজলিং। Crispy Rice Soup খুব চলছে। "
                         "কোনটা অর্ডার করবেন?",
            "suggestions": [{"item": ref("crs"), "reason": "popular"}]}
    out, calls = run("নতুন কি আছে আপনাদের রেস্টুরেন্টে?", real)  # (the plain question has a fixed answer)
    assert "সেলেক্টিওন" not in out["replyText"] and "বিফ, চিকেন" in out["replyText"], out["replyText"]
    turn, playbook = calls[0][-1]["content"], calls[0][0]["content"]
    assert "SOUND LIKE A REAL WAITER" in playbook and "মুডে আছেন" in playbook  # named only as what NOT to ask
    assert "in the mood" not in turn
    # a dish that really has the word keeps it
    import brain as b
    assert b._no_filler("Chef's Selection Platter দারুণ") == "Chef's Selection Platter দারুণ"


def test_what_do_you_have_opens_with_the_cuisine_and_the_kinds_of_dishes():
    from menu_profile import glance_line, menu_glance

    def menu(*names, cat=""):
        return [{"name": n, "category": cat} for n in names]

    chinese = (menu("Crispy Rice Soup", "Hot & Sour Soup", "Thai Soup", cat="Soup")
               + menu("Chicken Fried Rice", "Egg Fried Rice", "Chowmein Chicken", "Special Chowmein", cat="Rice & Noodles Selection")
               + menu("Chicken Chili Onion", "Chicken Cashew Nut", "Chicken with Oyster Sauce", cat="Chicken Selection")
               + menu("Beef with Red Curry", "Beef Chili Onion", "Beef Oyster", cat="Beef Selection")
               + menu("Chicken Sizzling", "Beef Sizzling", cat="Sizzling"))
    g = menu_glance(chinese)
    assert g["cuisine"][0][1] == "চাইনিজ", g
    assert g["kinds_bn"][0] == "চিকেন-বিফের আইটেম" and "চাওমিন" in g["kinds_bn"] and "নুডলস" not in g["kinds_bn"], g
    assert not any("Selection" in k or "সেলে" in k for k in g["kinds_bn"])
    fast = menu("Beef Burger", "Chicken Burger", "Cheese Burger", "Pepperoni Pizza", "BBQ Pizza", "French Fries",
                "Club Sandwich", "Chicken Wings")
    assert menu_glance(fast)["cuisine"][0][1] == "ফাস্ট ফুড" and menu_glance(fast)["kinds_bn"][0] == "বার্গার"
    bangla = menu("Kacchi Biryani", "Beef Tehari", "Morog Polao", "Shorshe Ilish", "Aloo Bhorta", "Dal", "Chicken Rezala")
    assert menu_glance(bangla)["cuisine"][0][1] == "বাংলা"
    # it reaches the waiter only for "what do you have?"
    real = {"topic": "recommendation", "replyText": "Crispy Rice Soup খুব চলছে। কোনটা অর্ডার করবেন?",
            "suggestions": [{"item": ref("crs"), "reason": "popular"}]}
    _, calls = run("আমরা চারজন, কি কি আছে আপনাদের?", real)  # with details → the model, given the facts
    assert "MENU AT A GLANCE" in calls[0][-1]["content"] and "স্যুপ" in glance_line(ITEMS, "bn")
    _, calls = run("আজকে হালকা কী ভালো হবে?", real)
    assert "MENU AT A GLANCE" not in calls[0][-1]["content"]


def test_every_kind_of_bangladeshi_restaurant_gets_its_cuisine_and_dishes_right():
    from bd_menus import BD_MENUS, as_items
    from menu_profile import menu_glance

    bad = []
    for kind, want_c, want_k, m in BD_MENUS:
        g = menu_glance(as_items(m))
        c = [x[1] for x in g["cuisine"]]
        if c[:len(want_c)] != want_c or not all(any(k in x for x in g["kinds_bn"]) for k in want_k):
            bad.append((kind, c, g["kinds_bn"]))
        # never a category name, and sides/sweets/drinks never lead where there's main food
        assert not any("Selection" in x or "সেলে" in x for x in g["kinds_bn"]), kind
    assert not bad, "\n".join(map(str, bad))

    # nothing is a fixed list: a kind the menu doesn't have — or has only sold out today — is never said
    chinese = as_items(BD_MENUS[0][3])
    no_chowmein = [it for it in chinese if "Chowmein" not in it["name"]]
    assert "চাওমিন" not in menu_glance(no_chowmein)["kinds_bn"]
    soups_sold_out = [it for it in chinese if "Soup" not in it["name"]]
    g = menu_glance(chinese, available=soups_sold_out)
    assert "স্যুপ" not in g["kinds_bn"] and g["cuisine"][0][1] == "চাইনিজ", g
    assert "স্যুপ" in menu_glance(chinese)["kinds_bn"]


def test_the_ai_reads_the_menu_once_and_the_waiter_uses_it():
    import menu_profile as mp
    from bd_menus import BD_MENUS, as_items

    items = as_items(BD_MENUS[0][3])  # the Dhaka Chinese-Thai menu
    idx = {it["name"]: i for i, it in enumerate(items)}
    soups = [i for n, i in idx.items() if "Soup" in n]
    calls = []

    async def fake_ai(messages):
        calls.append(messages)
        return json.dumps({"cuisine_bn": "চাইনিজ আর থাই", "cuisine_en": "Chinese and Thai", "kinds": [
            {"bn": "স্যুপ", "en": "soups", "dishes": soups},
            {"bn": "ফ্রাইড রাইস", "en": "fried rice", "dishes": [idx["Egg Fried Rice"], idx["Thai Fried Rice"]]},
            {"bn": "চাওমিন", "en": "chowmein", "dishes": [idx["Chicken Chowmein"], 999]},  # 999: not a dish → dropped
            {"bn": "Chicken Selection", "en": "Chicken Selection", "dishes": [idx["Chicken Masala"]]},  # filler → dropped
            {"bn": "মিল্কশেক", "en": "milkshakes", "dishes": []},  # nothing on the menu → dropped
        ]})

    mp._AI.clear()
    got = asyncio.run(mp.learn_menu(items, fake_ai))
    assert [k["bn"] for k in got["kinds"]] == ["স্যুপ", "ফ্রাইড রাইস", "চাওমিন"], got
    asyncio.run(mp.learn_menu(items, fake_ai))
    assert len(calls) == 1, "read once per menu, then remembered"
    line = mp.glance_line(items, "bn")
    assert "চাইনিজ আর থাই" in line and "স্যুপ, ফ্রাইড রাইস, চাওমিন" in line, line
    # still tied to what can be ordered: every soup sold out → no "স্যুপ"
    line = mp.glance_line(items, "bn", available=[it for it in items if "Soup" not in it["name"]])
    assert "স্যুপ" not in line and "ফ্রাইড রাইস" in line, line
    # the menu changed → not the old answer: the word lists until the AI has read the new one
    new_menu = items + [{"name": "Beef Burger", "category": "Burgers"}]
    assert mp.ai_glance(new_menu) is None and "MENU AT A GLANCE" in mp.glance_line(new_menu, "bn")

    # the AI failing (or answering nonsense) never breaks the reply
    async def broken(messages):
        raise RuntimeError("timeout")

    async def nonsense(messages):
        return json.dumps({"kinds": [{"bn": "x", "dishes": [0]}]})

    mp._AI.clear()
    mp._AI_FAILED.clear()

    async def warm_and_wait(call):
        mp.warm(items, call)
        await asyncio.sleep(0.05)

    asyncio.run(warm_and_wait(broken))
    assert mp.ai_glance(items) is None and "চাইনিজ" in mp.glance_line(items, "bn")
    mp._AI_FAILED.clear()
    asyncio.run(warm_and_wait(nonsense))
    assert mp.ai_glance(items) is None
    mp._AI_FAILED.clear()
    # the guest never waits: warm() returns at once, the answer arrives in the background
    asyncio.run(warm_and_wait(fake_ai))
    assert mp.ai_glance(items) is not None
    mp._AI.clear()


def test_what_do_you_have_is_one_fixed_format_with_three_to_try():
    for said in ("কি কি আছে আপনাদের?", "কি আছে আপনাদের?", "কি কি আছে আপনার রেস্টুরেন্টে?", "what do you have?"):
        out, calls = run(said, {"replyText": "MODEL"})
        assert not calls, (said, "a fixed answer — no model")
        text, rows = out["replyText"], out["meta"]["suggestions"]
        assert len(rows) == 3 and out["meta"]["decision"]["showSuggestionsModal"], said
        if "what" in said:
            assert text.startswith("We have") and "If you'd like something special, you could try" in text, text
        else:
            assert "আছে —" in text and "স্পেশাল কিছু খেতে চাইলে" in text and text.endswith("ট্রাই করতে পারেন।"), text
            assert "স্যুপ" in text.split("।")[0], text  # the kinds of dishes come first
            assert out["meta"]["voiceReplyText"] and "Soup" not in out["meta"]["voiceReplyText"]
        # the three said are exactly the three cards, in order
        names = [r["title"].split(" (")[0] for r in rows]
        spots = [text.find(n) for n in names]
        assert all(s >= 0 for s in spots) and spots == sorted(spots), (text, names)
        assert out["meta"]["reco"]["last_offered"] == [r["itemId"] for r in rows]

    # star-marked dishes come first, the rest keep their ranking (and the time of day)
    import brain as b
    starred = [dict(it, signature=True) if it["id"] in ("ccs", "crs") else dict(it, signature=False) for it in ITEMS]
    calls2 = []

    async def fake(messages):
        calls2.append(messages)
        return json.dumps({**TURN, "replyText": "MODEL"})

    orig, b._call_openai = b._call_openai, fake
    try:
        out = asyncio.run(b.generate_reply("কি কি আছে আপনাদের?", menu_snapshot={"items": starred}, locale="bn",
                                           context={"cartItems": [], "mealKinds": ["breakfast"], "kitchen": KITCHEN}))
    finally:
        b._call_openai = orig
    assert {r["itemId"] for r in out["meta"]["suggestions"][:2]} == {"ccs", "crs"}, out["meta"]["suggestions"]

    # anything more specific is still the model's
    for said in ("নতুন কি আছে আপনাদের?", "ড্রিংকসে কি কি আছে?"):  # ("ভালো কি আছে", a kind: the reco shapes)
        _, calls = run(said, {"topic": "recommendation", "replyText": "Crispy Rice Soup ভালো। কোনটা অর্ডার করবেন?",
                              "suggestions": [{"item": ref("crs"), "reason": "x"}]})
        assert calls, said
    # English, and a menu with nothing orderable right now, still read well
    from menu_profile import overview_text
    assert overview_text("", [], [], "bn") == "আমাদের অনেক রকম খাবার আছে। কী খেতে চান, বলুন?"
    assert overview_text("Chinese", ["soups"], ["A", "B"], "en") == \
        "We have all kinds of Chinese items — soups. If you'd like something special, you could try A or B."


def test_recommendations_use_the_waiters_two_shapes():
    def ask(said, **kw):
        out, calls = run(said, {"topic": "recommendation", "replyText": "MODEL", "suggestions": [{"item": ref("crs"), "reason": "x"}]}, **kw)
        return out, calls

    # a KIND: "{ঝাল} আইটেমের মধ্যে A, B অথবা C খুবই …, এছাড়াও আপনি D কিংবা E-ও নিতে পারেন।"
    out, calls = ask("ঝাল কিছু আছে?")
    text, rows = out["replyText"], out["meta"]["suggestions"]
    assert not calls and text.startswith("ঝাল আইটেমের মধ্যে") and "এছাড়াও আপনি" in text, text
    assert all(IDX.by_id[r["itemId"]]["id"] in ("brc", "hss", "cco", "szs") for r in rows), rows  # only spicy dishes
    assert [text.find(r["title"].split(" (")[0]) for r in rows] == sorted(text.find(r["title"].split(" (")[0]) for r in rows)
    out, _ = ask("স্যুপের মধ্যে ভালো কোনটা?")
    assert out["replyText"].startswith("স্যুপ আইটেমের মধ্যে"), out["replyText"]
    assert {IDX.by_id[r["itemId"]]["category"] for r in out["meta"]["suggestions"]} == {"Soup"}
    # fewer dishes → a shorter sentence, never an empty slot
    out, _ = ask("টক কী আছে?")
    assert out["replyText"] == "টক আইটেমের মধ্যে Hot & Sour Soup খুবই ভালো।", out["replyText"]
    # WHO: "আপনার {বাচ্চাদের} জন্য A, B অথবা C নিতে পারেন, এছাড়াও D কিংবা E-ও নিতে পারেন।"
    out, calls = ask("বাচ্চাদের জন্য কী ভালো হবে?")
    assert not calls and out["replyText"].startswith("আপনার বাচ্চাদের জন্য") and "নিতে পারেন" in out["replyText"]
    assert not {"brc", "hss", "cco", "szs"} & {r["itemId"] for r in out["meta"]["suggestions"]}, "nothing spicy for kids"
    out, _ = ask("what do you suggest for my family?")
    assert out["replyText"].startswith("For your family, you could get"), out["replyText"]
    # "খুবই জনপ্রিয়" only with evidence (a "popular" tag / real orders) — otherwise "খুবই ভালো"
    assert "জনপ্রিয়" not in ask("ঝাল কিছু আছে?")[0]["replyText"]

    # STAR-MARKED dishes lead only when they suit the time: Beef with Red Curry is starred
    out, _ = ask("ভালো কি আছে আপনাদের?")
    assert out["replyText"].startswith("স্পেশাল আইটেমের মধ্যে Beef with Red Curry"), out["replyText"]
    import brain as b
    # the only star is a sizzler — not a breakfast dish
    sizzler_star = [dict(it, signature=(it["id"] == "csz")) for it in ITEMS]

    async def fake(messages):
        return json.dumps({**TURN, "replyText": "MODEL"})

    def ask_at(meal):
        orig, b._call_openai = b._call_openai, fake
        try:
            return asyncio.run(b.generate_reply("ভালো কি আছে আপনাদের?", menu_snapshot={"items": sizzler_star}, locale="bn",
                                                context={"cartItems": [], "mealKinds": [meal], "kitchen": KITCHEN}))
        finally:
            b._call_openai = orig

    out = ask_at("breakfast")
    assert "csz" not in {r["itemId"] for r in out["meta"]["suggestions"]}, out["meta"]["suggestions"]
    assert out["replyText"].startswith("সকালের নাস্তায়"), out["replyText"]  # no special now → the meal period leads
    out = ask_at("dinner")  # at dinner the star suits → it leads
    assert out["replyText"].startswith("স্পেশাল আইটেমের মধ্যে Chicken Sizzling"), out["replyText"]
    assert out["meta"]["suggestions"][0]["itemId"] == "csz"

    # anything more is still the model's
    for said in ("কম ঝাল কিছু আছে?", "আমরা চারজন, ভালো কি আছে?", "বাচ্চাদের জন্য মিষ্টি কিছু আছে?", "আর কী আছে?",
                 "একটা ভালো স্যুপ সাজেস্ট করেন", "মিষ্টি কিছু আছে?", "৫০০ টাকার মধ্যে ভালো কী আছে?"):
        assert ask(said)[1], said


def test_asking_within_a_category_recommends_only_that_category():
    # the real turn: "স্যুপের মধ্যে কি নেওয়া যেতে পারে?" → Crispy Rice Soup + Set Menu + Vegetable Sizzling
    real = {"topic": "recommendation", "intent": "suggestions",
            "replyText": "ক্রিস্পি রাইস স্যুপ খুবই জনপ্রিয়। এগুলো থেকে কোনটা অর্ডার করবেন?",
            "suggestions": [{"item": ref("crs"), "reason": "a guest favourite"}]}
    for said, want in (("স্যুপের মধ্যে কি নেওয়া যেতে পারে?", "Soup"), ("which soup is good?", "Soup"),
                       ("সিজলিং এর মধ্যে কোনটা ভালো?", "Sizzling"), ("স্যুপের মধ্যে কি কি আছে?", "Soup"),
                       ("সিজলিংয়ের মধ্যে কী আছে?", "Sizzling")):
        # the category itself is recognised (not just cards that happen to be topped up with the same kind)
        assert {IDX.by_id[i]["category"] for i in brain._named_kind_ids(said, IDX)} == {want}, said
        out, calls = run(said, real)
        cats = {IDX.by_id[s["itemId"]]["category"] for s in out["meta"]["suggestions"]}
        assert cats == {want} and len(out["meta"]["suggestions"]) >= 3, (said, out["meta"]["suggestions"])
    # a general question still spreads across the menu
    import contextlib
    import io
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        run("আজকে কী ভালো হবে?", real)
    picks = log.getvalue().split("picks=")[1].split("\n")[0]
    assert any(n in picks for n in ("Beef with Red Curry", "French Fry", "Onion Ring", "Chicken Cashew Nut Salad"))


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
