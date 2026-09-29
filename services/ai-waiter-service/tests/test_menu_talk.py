"""Replays of real conversations (fine_tuning/review_transcripts-20260929.jsonl):
  - "কতক্ষণ লাগবে?" with a full tray must answer the time — never pitch another dish
  - "কি কি আছে আপনার রেস্টুরেন্টে?" is a menu tour shown as cards
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


def test_what_do_you_have_is_a_tour_shown_as_cards():
    real = {"topic": "restaurant_info",
            "replyText": "আমাদের অনেক ধরনের খাবার আছে, যেমন Crispy Rice Soup, Chicken Corn Soup, Special Fried Prawn, "
                         "Beef with Red Curry। আপনার জন্য কোনটা দেব?",
            "suggestions": [{"item": ref("crs"), "reason": "great for breakfast"}]}
    out, calls = run("কি কি আছে আপনার রেস্টুরেন্টে?", real)
    assert "RECOMMENDATION MODE: OVERVIEW" in calls[0][-1]["content"]
    m = out["meta"]
    assert m["intent"] == "suggestions" and m["decision"]["showSuggestionsModal"] is True
    assert len(m["suggestions"]) >= 3 and m["suggestions"][0]["title"] == "Crispy Rice Soup"
    return out


def test_which_is_good_after_the_tour_is_about_those_dishes_and_shows_them():
    tour = test_what_do_you_have_is_a_tour_shown_as_cards()
    history = [{"role": "user", "content": "কি কি আছে আপনার রেস্টুরেন্টে?"},
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
    assert [s["itemId"] for s in m["suggestions"]] == ["ccs"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
