"""A Bengali rice-and-curry restaurant with odd category names (the real turns of 2026-10-19): the menu card, calling
a waiter, "ভাত" never turned into fried rice, "খাবার" / "আপনার" never read as a kind of dish, আলুর পরোটা when only
পরোটা is on the menu, "এটা…?" with nothing to point at, a kind listed ("মাছের মধ্যে কি কি আছে?"), and the meal
completed (ডাল → ভাত → মাছ / মাংস; কাবাব → পরোটা / নান).  Run: python -m pytest tests/test_bangla_house_fixes.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402

FISH, CURRY, SIDES, SNACKS, MORNING, COLD = ("মাছে মাতাল বাঙালি", "কারির কাহিনী", "ভর্তা ভাজির মাখামাখি",
                                             "ছ্যাঁকাখোর (বিকালের নাস্তা)", "ভোরের শহর", "কলিজা ঠাণ্ডা")
ITEMS = [
    {"id": "rice", "name": "সাদা ভাত", "price": 40, "category": FISH},
    {"id": "frice", "name": "সুগন্ধি ভাত (নাজিরশাইল)", "price": 60, "category": FISH},
    {"id": "rui", "name": "রুই মাছ (গ্লাসি)", "price": 250, "category": FISH},
    {"id": "boal", "name": "হাওরের বোয়াল মাছ", "price": 320, "category": FISH},
    {"id": "ilish", "name": "সরষে ইলিশ", "price": 450, "category": FISH},
    {"id": "chingri", "name": "চিংড়ি ষোল আনা (ভুনা)", "price": 380, "category": FISH},
    {"id": "begun", "name": "বেগুন ভাজা", "price": 60, "category": FISH},
    {"id": "beef", "name": "গরুর লাল ভুনা", "price": 300, "category": CURRY},
    {"id": "mutton", "name": "মাটন দোপেয়াজা", "price": 380, "category": CURRY},
    {"id": "murgi", "name": "দেশি মুরগির ঝোল", "price": 280, "category": CURRY},
    {"id": "dal", "name": "ডাল", "price": 50, "category": MORNING},
    {"id": "alu", "name": "আলু ভর্তা", "price": 40, "category": SIDES},
    {"id": "macher_vorta", "name": "মাছ ভর্তা", "price": 80, "category": SIDES},
    {"id": "porota", "name": "পরোটা", "price": 15, "category": MORNING},
    {"id": "naan_b", "name": "বাটার পাতলা নান", "price": 60, "category": SNACKS},
    {"id": "naan_g", "name": "গার্লিক নান", "price": 70, "category": SNACKS},
    {"id": "naan_k", "name": "কাশ্মীরি নান", "price": 90, "category": SNACKS},
    {"id": "shik", "name": "বিফ শিক কাবাব 🌶", "price": 220, "category": SNACKS},
    {"id": "boti", "name": "চিকেন বটি কাবাব 🌶", "price": 200, "category": SNACKS},
    {"id": "reshmi", "name": "রেশমি কাবাব", "price": 210, "category": SNACKS},
    {"id": "special", "name": "ষোল আনা স্পেশাল কাবাব", "price": 260, "category": SNACKS},
    {"id": "coke", "name": "কোকা কোলা", "price": 25, "category": COLD},
]
IDX = brain.MenuIndex(ITEMS)
TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}


def ref(i):
    return IDX.ref(IDX.by_id[i])


def run(text, model=None, *, cart=(), state=None, table="7", channel=None, shown=None, reading=None, restaurant=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **(model or {})})

    async def read(*a, **k):
        return reading

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, read
    try:
        ctx = {"cartItems": [dict(c) for c in cart], "mealKinds": ["lunch"]}
        if table:
            ctx["table"] = table
        if channel:
            ctx["channel"] = channel
        if shown:
            ctx["shownItems"] = shown
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": ITEMS}, locale="bn", history=[],
                                               dialog_state=state, context=ctx, restaurant=restaurant,
                                               conversation_id="s-early"))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


def state_of(out):
    m = out["meta"]
    return {"tray": m["tray"], "reco": m["reco"], "checkout": m.get("checkout") or {}}


def line(i, qty=1):
    it = IDX.by_id[i]
    return {"itemId": i, "id": i, "name": it["name"], "price": it["price"], "qty": qty}


def added(out):
    return [(o.get("itemId"), o.get("quantity")) for o in out["meta"].get("cartOps") or [] if o.get("op") == "add"]


# ------------------------------------------------------------------ the menu card

def test_asking_for_the_menu_card_opens_the_menu():
    for said in ("মেনু কাটটা দাও।", "মেনু কার্ডটা দাও", "আপনার মেনু দেখতে চাই.", "কিয় আপনার মেনুতে?", "কি আছে তোমাদের খাবার?"):
        out, calls = run(said)
        assert "open_menu" in out["meta"]["guards"] and not calls, (said, out["replyText"])
        assert out["replyText"].startswith("এই যে আমাদের মেনু"), out["replyText"]
    # the reading said "recommend" — but nothing to recommend by, and the words ask for the menu
    out, calls = run("আপনার মেনু দেখতে চাই", reading={"intent": "recommend", "kind": "", "taste": "", "audience": "",
                                                      "count": 0, "dishes": [], "confident": True})
    assert "open_menu" in out["meta"]["guards"] and not calls, out["replyText"]
    # a dish in it is still about the dish
    out, _ = run("মেনু দেখান, একটা কোকা কোলা দিন", {"cartOps": [{"op": "add", "item": ref("coke"), "quantity": 1}]})
    assert "open_menu" not in out["meta"]["guards"]


def test_everyday_words_are_never_a_kind_of_dish():
    # "খাবার" sounded like "কাবাব", "আপনার" like "আনা" → "খাবা আইটেমের মধ্যে…", "আপনা আইটেমের মধ্যে…"
    assert not brain._kind_ids_in("কি আছে তোমাদের খাবার?", IDX)
    assert not brain._kind_ids_in("আপনার মেনুতে", IDX)
    assert brain._kind_ids_in("কাবাব কি কি আছে", IDX) >= {"shik", "boti", "reshmi", "special"}


# ------------------------------------------------------------------ calling a waiter

def test_a_vague_service_ask_points_at_the_bell_even_during_checkout():
    for st in (None, {"checkout": {"stage": "readback", "table": "7"}}, {"checkout": {"stage": "table"}}):
        out, calls = run("আপনারা কি কিছু সার্ভিস করবেন?", cart=[line("dal")], state=st)
        assert not calls and "উপরে বাঁ দিকে ঘণ্টার বোতাম" in out["replyText"], (st, out["replyText"])
        yes, _ = run("হ্যাঁ", cart=[line("dal")], state={**(st or {}), **state_of(out)})
        assert yes["meta"]["decision"].get("openServiceSheet") is True, yes["replyText"]


def test_a_clear_call_opens_the_options():
    for said in ("ওয়েটার ডাকেন", "একটু ওয়েটারকে ডেকে দিন", "বিলটা দিন", "টেবিলটা একটু পরিষ্কার করে দিন", "call the waiter"):
        out, calls = run(said)
        assert not calls and out["meta"]["decision"].get("openServiceSheet") is True, (said, out["replyText"])
        assert "কোন সার্ভিসের জন্য ওয়েটার চাচ্ছেন" in out["replyText"] or said == "call the waiter", out["replyText"]
    online, _ = run("ওয়েটার ডাকেন", table="", channel="online")
    assert "অনলাইন অর্ডারে" in online["replyText"] and not online["meta"]["decision"].get("openServiceSheet")
    no_table, _ = run("ওয়েটার ডাকেন", table="")
    assert "QR কোড" in no_table["replyText"]
    # automatic paging on: the model records it and the staff are paged (as before)
    _, calls = run("ওয়েটার ডাকেন", {"serviceRequest": {"type": "call_staff", "note": ""}}, restaurant={"staffAlerts": True})
    assert calls


# ------------------------------------------------------------------ "ভাত" is rice here

def test_bhaat_stays_bhaat_on_a_menu_with_plain_rice():
    out, _ = run("ডাল কি একা খায়?", {"replyText": "সাধারণত ডালের সাথে ভাত খাওয়া হয়। ভাত নেবেন?"})
    assert "ফ্রাইড রাইস" not in out["replyText"] and "ভাত" in out["replyText"], out["replyText"]
    assert brain._HAS_PLAIN_RICE(IDX)
    chinese = brain.MenuIndex([{"id": "efr", "name": "Egg Fried Rice", "price": 200, "category": "Rice"},
                               {"id": "cc", "name": "Chicken Chowmein", "price": 250, "category": "Noodles"}])
    assert not brain._HAS_PLAIN_RICE(chinese)  # (there "ভাত" still means the fried rice)


# ------------------------------------------------------------------ a version the menu doesn't have

def test_alur_porota_is_not_porota():
    out, calls = run("আলুর পরোটা আছে?", {"replyText": "হ্যাঁ, আলুর পরোটা আছে।", "answerItems": [ref("porota")]})
    assert not calls and out["replyText"] == "আলুর পরোটা নেই, তবে পরোটা আছে — দেব?", out["replyText"]
    assert out["meta"]["decision"]["chooseOptions"][0]["say"] == "একটা পরোটা দিন"
    for said in ("পরোটা আছে?", "চিকেন বটি কাবাব আছে?", "দুইটা পরোটা দিন", "বড় পরোটা আছে?"):
        out, _ = run(said, {"replyText": "আছে।"})
        assert "version_missing" not in out["meta"]["guards"], (said, out["replyText"])


# ------------------------------------------------------------------ "এটা…?" with nothing to point at

def test_pointing_at_nothing_asks_again():
    out, calls = run("এটা আপনার মেনুতে?")
    assert not calls and "pointing_unclear" in out["meta"]["guards"] and "আরেকবার বলবেন" in out["replyText"]
    # something on the screen / in the tray: "এটা" means it → the usual answer
    out, _ = run("এটা কি ঝাল?", {"replyText": "একটু ঝাল।"}, shown=["shik"])
    assert "pointing_unclear" not in out["meta"]["guards"]
    out, _ = run("এটা কি ঝাল?", {"replyText": "একটু ঝাল।"}, cart=[line("shik")])
    assert "pointing_unclear" not in out["meta"]["guards"]


# ------------------------------------------------------------------ a kind, listed

def test_what_fish_is_there_lists_every_fish_dish():
    out, calls = run("মাছের মধ্যে কি কি আছে?")
    assert not calls and "kind_list" in out["meta"]["guards"], out["replyText"]
    assert out["replyText"].startswith("মাছের মধ্যে আছে রুই মাছ"), out["replyText"]
    cards = {s["itemId"] for s in out["meta"]["suggestions"]}
    assert cards == {"rui", "boal", "ilish", "chingri"}, cards  # not the rice, the বেগুন ভাজা or the মাছ ভর্তা
    # a dish this menu doesn't have is the model's to answer ("burger নেই…") — never "here are our chicken dishes"
    for said in ("চিকেন বার্গার কি অভেলেবল আছে?", "ডাইনামাইট শ্রিম্প কেমন হবে?", "বার্বিকিউ চিকেন আইটেম আছে"):
        out, calls = run(said, {"replyText": "MODEL"})
        assert calls and not {"kind_list", "reco_kind"} & set(out["meta"]["guards"]), (said, out["replyText"])
    meat, _ = run("গরুর কি কি আছে?")
    assert {s["itemId"] for s in meat["meta"]["suggestions"]} == {"beef", "shik"}  # (the beef kebab is beef too)


def test_a_kind_and_a_word_nobody_knows_asks_which():
    out, calls = run("মাছ পটিকিয়া।")
    assert not calls and "kind_unheard" in out["meta"]["guards"], out["replyText"]
    assert out["replyText"].startswith("দুঃখিত, মাছের কোনটা বললেন?"), out["replyText"]


# ------------------------------------------------------------------ the meal completed

def test_dal_then_rice_then_fish_or_meat():
    out, _ = run("ডাল", {"intent": "order", "topic": "order_change", "replyText": "ডাল যোগ করলাম। এখন ভাত খেতে পারেন। আর কিছু লাগবে?",
                         "cartOps": [{"op": "add", "item": ref("dal"), "quantity": 1}]})
    assert "সাথে ভাত দেব" in out["replyText"] and out["replyText"].count("ভাত খেতে") == 0, out["replyText"]
    yes, _ = run("হ্যাঁ", cart=[line("dal")], state=state_of(out))
    assert added(yes) == [("rice", 1)] and "মাছ নেবেন, নাকি মাংস" in yes["replyText"], yes["replyText"]
    fish, calls = run("মাছ", cart=[line("dal"), line("rice")], state=state_of(yes))
    assert not calls and fish["replyText"].startswith("কোন মাছ দেব"), fish["replyText"]
    ilish, _ = run("ইলিশ", cart=[line("dal"), line("rice")], state=state_of(fish))
    assert added(ilish) == [("ilish", 1)], ilish["replyText"]
    # rice already there → no rice question
    out, _ = run("ডাল", {"intent": "order", "replyText": "ডাল যোগ করলাম। আর কিছু লাগবে?",
                         "cartOps": [{"op": "add", "item": ref("dal"), "quantity": 1}]}, cart=[line("rice")])
    assert "সাথে ভাত দেব" not in out["replyText"], out["replyText"]


def test_kebab_then_porota_or_naan_then_which_naan():
    out, _ = run("বিফ শিক কাবাব দিন", {"intent": "order", "replyText": "বিফ শিক কাবাব যোগ করলাম। আর কিছু লাগবে?",
                                       "cartOps": [{"op": "add", "item": ref("shik"), "quantity": 1}]})
    assert out["replyText"].endswith("সাথে পরোটা নেবেন, নাকি নান?"), out["replyText"]
    labels = [b["label"] for b in out["meta"]["decision"]["chooseOptions"]]
    assert labels[:2] == ["পরোটা", "নান"], labels
    naan, calls = run("নান", cart=[line("shik")], state=state_of(out))
    assert not calls and naan["replyText"].startswith("কোন নান দেব"), naan["replyText"]
    garlic, _ = run("গার্লিক", cart=[line("shik")], state=state_of(naan))
    assert added(garlic) == [("naan_g", 1)], garlic["replyText"]
    porota, _ = run("পরোটা", cart=[line("shik")], state=state_of(out))
    assert added(porota) == [("porota", 1)], porota["replyText"]


def test_kebabs_suggested_ask_porota_or_naan():
    out, _ = run("কাবাব কি কি আছে?")
    assert "kind_list" in out["meta"]["guards"] and out["replyText"].endswith("কাবাবের সাথে পরোটা নেবেন, নাকি নান?"), \
        out["replyText"]
    # bread in the tray already → not asked
    out, _ = run("কাবাব কি কি আছে?", cart=[line("naan_g")])
    assert "পরোটা নেবেন" not in out["replyText"], out["replyText"]
