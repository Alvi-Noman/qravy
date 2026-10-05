"""UNDERSTAND FIRST: the reading of what the guest means (intent.py) decides the answer's shape; the word patterns are
only the fallback. Here the reading is given (no model call) to show each shape follows the MEANING."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402
import intent  # noqa: E402

ITEMS = [
    {"id": "crs", "name": "Crispy Rice Soup", "price": 300, "category": "Soup"},
    {"id": "hss", "name": "Hot & Sour Soup", "price": 320, "category": "Soup"},
    {"id": "tts", "name": "Thai Thick Soup", "price": 310, "category": "Soup"},
    {"id": "brc", "name": "Beef with Red Curry", "price": 380, "category": "Beef"},
    {"id": "cco", "name": "Chicken Chili Onion", "price": 360, "category": "Chicken"},
    {"id": "cfr", "name": "Chicken Fried Rice", "price": 280, "category": "Rice"},
    {"id": "csz", "name": "Chicken Sizzling", "price": 500, "category": "Sizzling"},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "coke", "name": "Coca-Cola", "price": 60, "category": "Drinks"},
    {"id": "lassi", "name": "Mango Lassi", "price": 150, "category": "Drinks"},
    {"id": "firni", "name": "Firni", "price": 120, "category": "Dessert"},
]
BASE = {"topic": "other", "intent": "chitchat", "language": "bn", "mentionedItems": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "…", "cartOps": []}


def reading(intent_, **kw):
    return {"intent": intent_, "kind": "", "taste": "", "audience": "", "count": 0, "dishes": [], "confident": True, **kw}


def run(text, meaning, model=None, cart=()):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**BASE, **(model or {})})

    async def understood(*_a, **_k):
        return meaning

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, understood
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="bn",
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


def test_the_meaning_picks_the_shape():
    # the real turn: "ঝাল খাবারের মধ্যে কি আছে আপনাদের?" got the whole-menu tour; the reading says: spicy dishes
    out, calls = run("ঝাল খাবারের মধ্যে কি আছে আপনাদের?", reading("recommend", taste="spicy"))
    assert out["replyText"].startswith("ঝাল আইটেমের মধ্যে") and not calls, out["replyText"]
    # words no pattern knows, but the meaning is "what do you have?" → the menu page
    out, calls = run("আপনারা এখানে কী কী রান্না করেন বলেন তো", reading("menu_overview"))
    assert "open_menu" in out["meta"]["guards"] and not calls, out["replyText"]
    # "কি কি আছে" but about a KIND → that kind, never the whole menu
    out, _ = run("কি কি আছে আপনাদের স্যুপে?", reading("recommend", kind="soup"))
    assert "open_menu" not in out["meta"]["guards"], out["replyText"]
    assert {s["itemId"] for s in out["meta"]["suggestions"]} <= {"crs", "hss", "tts"}, out["meta"]["suggestions"]
    # the kind only the reading caught ("ঠান্ডা কিছু কী আছে" = drinks) → the drinks, plainly (Coke is ready-made)
    out, _ = run("ঠান্ডা কী কী পাওয়া যাবে", reading("recommend", kind="drinks"))
    assert out["replyText"].startswith("ড্রিংকসের মধ্যে আছে Mango Lassi"), out["replyText"]


def test_the_meaning_keeps_shortcuts_from_misfiring():
    # a pattern would call this a menu question — the reading says they're ordering → never the tour
    out, calls = run("কি কি আছে দেখি, আচ্ছা একটা চিকেন সিজলিং দিন", reading("order", dishes=[
        {"name": "Chicken Sizzling", "qty": 1, "size": "", "change": "add"}]),
        model={"topic": "order_change", "intent": "order", "replyText": "Chicken Sizzling যোগ করলাম।",
               "cartOps": [{"op": "add", "item": brain.MenuIndex(ITEMS).ref(ITEMS[6]), "quantity": 1}]})
    assert "open_menu" not in out["meta"]["guards"] and calls, out["replyText"]
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["csz"]
    # small-talk words, but the meaning is an order → no small-talk reply
    out, calls = run("হ্যালো ভাই, দুইটা ফ্রেঞ্চ ফ্রাই দেন", reading("order"))
    assert "small_talk" not in out["meta"]["guards"], out["replyText"]


def test_unclear_asks_again_without_the_big_model():
    out, calls = run("ক্ছ কম ধারের মান্থে কেছে", reading("unclear", confident=False))
    assert out["replyText"] == "দুঃখিত, স্পষ্ট শুনতে পারিনি। আরেকবার বলবেন, প্লিজ?" and not calls, out["replyText"]
    assert not out["meta"]["cartOps"]


def test_the_model_sees_the_reading():
    meaning = reading("dish_question", dishes=[{"name": "Chicken Sizzling", "qty": 0, "size": "", "change": "about"}])
    _, calls = run("চিকেন সিজলিং কি ঝাল?", meaning)
    assert calls and "WHAT THE GUEST MEANS (first reading)" in calls[0][-1]["content"]
    assert '"dish_question"' in calls[0][-1]["content"]


def test_no_reading_means_the_old_behaviour():
    out, _ = run("কি কি আছে আপনাদের?", None)
    assert "open_menu" in out["meta"]["guards"], out["replyText"]


def test_the_reading_is_cleaned_and_its_failures_are_harmless():
    assert intent._clean({"intent": "nonsense"}) is None
    r = intent._clean({"intent": "order", "kind": "", "taste": "x", "audience": "", "count": 99, "confident": True,
                       "dishes": [{"name": " Coke ", "qty": 500, "size": "", "change": "weird"}]})
    assert r["taste"] == "" and r["count"] == 10 and r["dishes"] == [{"name": "Coke", "qty": 99, "size": "", "change": "add"}]

    async def boom(_body):
        raise RuntimeError("network down")

    assert asyncio.run(intent.understand("দুইটা কোক দিন", items=ITEMS, last_waiter="", tray=[], post=boom,
                                         model="m")) is None


def test_a_short_answer_to_our_question_is_never_please_repeat():
    # the real turn: "…ছোটটা ৳15, বড়টা ৳25। কোনটা দিব?" → "ছোটোটা।" → the reading said unclear → "স্পষ্ট শুনতে পারিনি"
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**BASE, "replyText": "…"})

    async def understood(*_a, **_k):
        return reading("unclear", confident=False)

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, understood
    try:
        out = asyncio.run(brain.generate_reply(
            "ছোটোটা।", menu_snapshot={"items": ITEMS}, locale="bn",
            history=[{"role": "user", "content": "পানি দেন"},
                     {"role": "assistant", "content": "মিনারেল ওয়াটার — ছোটটা ৳15, বড়টা ৳25। কোনটা দিব?"}],
            context={"cartItems": [], "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    assert "স্পষ্ট শুনতে পারিনি" not in out["replyText"] and calls, out["replyText"]  # the model read it in context


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)


# ---------------------------------------------------------------- the rules never overrule the AI on a look-alike
def _ref(i):
    return brain.MenuIndex(ITEMS).ref(next(it for it in ITEMS if it["id"] == i))


def test_what_is_in_a_dish_is_a_dish_question_not_the_menu_page():
    # the real turn: "মিনি স্লাইডার ট্রিও এর মধ্যে কি কি আছে?" opened the menu ("কি কি আছে" looked like "what do you have")
    out, calls = run("ক্রিস্পি রাইস স্যুপ এর মধ্যে কি কি আছে?", reading("dish_question"),
                     model={"topic": "item_question", "replyText": "Crispy Rice Soup-এ মুচমুচে রাইস আর সবজি থাকে।"})
    assert calls and not out["meta"]["decision"].get("openMenu"), out["replyText"]
    # no reading at all → the dish named (in Bangla) still keeps it off the menu page
    out, calls = run("ক্রিস্পি রাইস স্যুপ এর মধ্যে কি কি আছে?", None,
                     model={"topic": "item_question", "replyText": "Crispy Rice Soup-এ মুচমুচে রাইস আর সবজি থাকে।"})
    assert calls and not out["meta"]["decision"].get("openMenu"), out["replyText"]
    # …and the general question still opens it
    out, _ = run("কি আছে তোমাদের মেনুতে?", reading("menu_overview"))
    assert out["meta"]["decision"].get("openMenu"), out["replyText"]


def test_what_goes_with_a_dish_keeps_the_ais_suggestions():
    # the real turn: "ক্লাসিক ফ্রাইজের সাথে কী খাওয়া যেতে পারে?" → everything cut but "কোনটা অর্ডার করবেন?"
    answer = "French Fry-এর সাথে Chicken Fried Rice অথবা Chicken Chili Onion খুব ভালো যায়। কোনটা দেব?"
    out, _ = run("ফ্রেঞ্চ ফ্রাইয়ের সাথে কী খাওয়া যেতে পারে?", reading("recommend"),
                 model={"topic": "recommendation", "replyText": answer})
    assert "Chicken Fried Rice" in out["replyText"] and "stayed_on_asked_dish" not in out["meta"]["guards"], out["replyText"]
    # the same without a reading — the words "সাথে … খাওয়া যেতে পারে" ask for other dishes
    out, _ = run("ফ্রেঞ্চ ফ্রাইয়ের সাথে কী খাওয়া যেতে পারে?", None,
                 model={"topic": "recommendation", "replyText": answer})
    assert "Chicken Fried Rice" in out["replyText"], out["replyText"]


def test_a_plain_question_about_a_dish_still_drops_an_unasked_pitch():
    out, _ = run("ক্রিস্পি রাইস স্যুপ কেমন?", reading("dish_question"),
                 model={"topic": "item_question",
                        "replyText": "Crispy Rice Soup হালকা আর মুচমুচে। Chicken Sizzling ট্রাই করতে চান?"})
    assert "Sizzling" not in out["replyText"] and out["replyText"].endswith("এটা দেব?"), out["replyText"]


def test_no_and_ask_for_something_else_gets_suggestions():
    # "না, অন্য কিছু সাজেস্ট করেন" starts with "না" — it once counted as a plain no: suggestions removed, "ঠিক আছে।"
    out, _ = run("না, অন্য কিছু সাজেস্ট করেন", reading("recommend"),
                 model={"topic": "recommendation", "replyText": "Chicken Sizzling অথবা Beef with Red Curry নিতে পারেন।",
                        "suggestions": [{"item": _ref("csz"), "reason": ""}, {"item": _ref("brc"), "reason": ""}]})
    assert "Sizzling" in out["replyText"] and "no_pitch_after_no" not in out["meta"]["guards"], out["replyText"]


def test_an_order_with_a_question_keeps_the_answer():
    # "একটা চিকেন সিজলিং দিন, সাথে কী ভালো যাবে?" — the answer about what goes with it is not a "pitch" to cut
    out, _ = run("একটা চিকেন সিজলিং দিন, সাথে কী ভালো যাবে?", reading("order"),
                 model={"topic": "order_change", "intent": "order",
                        "replyText": "Chicken Sizzling যোগ করলাম। সাথে Chicken Fried Rice খুব ভালো যায়।",
                        "cartOps": [{"op": "add", "item": _ref("csz"), "quantity": 1}]})
    assert "Chicken Fried Rice" in out["replyText"] and "model_pitch_removed" not in out["meta"]["guards"], out["replyText"]
