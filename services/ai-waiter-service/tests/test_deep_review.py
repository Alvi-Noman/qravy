"""What a night of real-model conversations on a Bengali rice house, a fast-food place, a Chinese-Thai restaurant and
a kacchi house found (2026-10-20): new orders swallowed by an open question ("আর ভাত" → "বুঝতে পারিনি"), dish names
with a bracket never matched ("রুই মাছ" ≠ রুই মাছ (গ্লাসি)), "মাছ খাই না" still offering চিংড়ি, tea as the "cold"
drink for a kebab, a Friday kacchi on a Tuesday, "What goes with it?" answered with a whole meal, an online guest told
"we don't deliver"…  Run: python -m pytest tests/test_deep_review.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability  # noqa: E402
import brain  # noqa: E402
import offers  # noqa: E402
import pairing  # noqa: E402
from recommender import GuestProfile, OrderStats, extract_prefs, violations  # noqa: E402
from waiter_knowledge import MenuIndex, is_dessert, reply_language  # noqa: E402

PERIODS = [{k: p[k] for k in ("id", "name", "start", "end")} for p in availability.DEFAULT_PERIODS]
TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}

HOUSE = [
    {"id": "bhat", "name": "সাদা ভাত", "price": 40, "category": "মাছে মাতাল বাঙালি", "categoryId": "f"},
    {"id": "sugondhi", "name": "সুগন্ধি ভাত (নাজিরশাইল)", "price": 60, "category": "মাছে মাতাল বাঙালি", "categoryId": "f"},
    {"id": "rui", "name": "রুই মাছ (গ্লাসি)", "price": 220, "category": "মাছে মাতাল বাঙালি", "categoryId": "f"},
    {"id": "ilish", "name": "সরষে ইলিশ", "price": 450, "category": "মাছে মাতাল বাঙালি", "categoryId": "f"},
    {"id": "chingri", "name": "চিংড়ি ষোল আনা (ভুনা)", "price": 380, "category": "মাছে মাতাল বাঙালি", "categoryId": "f"},
    {"id": "begun", "name": "বেগুন ভাজা", "price": 40, "category": "মাছে মাতাল বাঙালি", "categoryId": "f"},
    {"id": "lal", "name": "গরুর লাল ভুনা", "price": 250, "category": "কারির কাহিনী", "categoryId": "q"},
    {"id": "kala", "name": "গরুর কালা ভুনা", "price": 280, "category": "কারির কাহিনী", "categoryId": "q"},
    {"id": "jhol", "name": "দেশি মুরগির ঝোল ✓", "price": 260, "category": "কারির কাহিনী", "categoryId": "q"},
    {"id": "roast", "name": "মুরগির রোস্ট", "price": 280, "category": "কারির কাহিনী", "categoryId": "q"},
    {"id": "alu", "name": "আলু ভর্তা", "price": 30, "category": "ভর্তা ভাজির মাখামাখি", "categoryId": "v"},
    {"id": "ddal", "name": "ড - তে ডাল", "price": 40, "category": "ভর্তা ভাজির মাখামাখি", "categoryId": "v"},
    {"id": "dal", "name": "ডাল", "price": 30, "category": "ভোরের শহর", "categoryId": "o", "periods": ["breakfast"]},
    {"id": "porota", "name": "পরোটা", "price": 15, "category": "ভোরের শহর", "categoryId": "o", "periods": ["breakfast"]},
    {"id": "fri", "name": "মাটন কাচ্চি (শুক্রবার)", "price": 350, "category": "দিন দুপুরে", "categoryId": "l"},
    {"id": "biryani", "name": "চিকেন বিরিয়ানি", "price": 250, "category": "দিন দুপুরে", "categoryId": "l"},
    {"id": "xpolao", "name": "এক্সট্রা পোলাও রাইস", "price": 80, "category": "দিন দুপুরে", "categoryId": "l"},
    {"id": "shik", "name": "বিফ শিক কাবাব 🌶", "price": 180, "category": "ছ্যাঁকাখোর", "categoryId": "k"},
    {"id": "naan", "name": "গার্লিক নান", "price": 60, "category": "ছ্যাঁকাখোর", "categoryId": "k"},
    {"id": "coke", "name": "কোকা কোলা", "price": 25, "category": "কলিজা ঠাণ্ডা", "categoryId": "z"},
    {"id": "lassi", "name": "আদা লেবু লাচ্ছি", "price": 120, "category": "কলিজা ঠাণ্ডা", "categoryId": "z"},
    {"id": "cha", "name": "ষোল আনা স্পেশাল চা 🌶🌶", "price": 40, "category": "মিষ্টি বিলাস", "categoryId": "m"},
    {"id": "firni", "name": "নূর-ই-কেশর ফিরনি", "price": 120, "category": "মিষ্টি বিলাস", "categoryId": "m"},
    {"id": "doi", "name": "বগুড়ার বিখ্যাত সরা দই", "price": 150, "category": "মিষ্টি বিলাস", "categoryId": "m"},
]
FAST = [
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers", "categoryId": "b"},
    {"id": "brownie", "name": "Chocolate Brownie", "price": 220, "category": "Desserts", "categoryId": "d"},
    {"id": "sundae", "name": "Oreo Brownie Sundae", "price": 260, "category": "Desserts", "categoryId": "d"},
    {"id": "lemon", "name": "Mint Lemonade", "price": 160, "category": "Drinks", "categoryId": "x"},
    {"id": "cola", "name": "Coca-Cola", "price": 80, "category": "Drinks", "categoryId": "x"},
    {"id": "fries", "name": "Classic Fries", "price": 150, "category": "Sides", "categoryId": "s"},
]


def run(text, items=HOUSE, at="Tue 13:30", history=None, cart=None, state=None, model=None, channel=None, ctx=None):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, **(model or {})})

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        minute = int(at[-5:-3]) * 60 + int(at[-2:])
        now = set(availability.periods_at(minute, {"periods": PERIODS}))
        snap = [dict(it, available=False) if it.get("periods") is not None and not set(it["periods"]) & now else it
                for it in items]
        c = {"cartItems": cart or [], "localTime": at, **(ctx or {})}
        if channel != "online":
            c["table"] = "5"
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": snap, "periods": PERIODS}, locale="bn",
                                               history=history or [], dialog_state=state, channel=channel,
                                               restaurant={"staffAlerts": False}, context=c, conversation_id="t"))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


def added(out):
    return sorted((o["itemId"], o.get("quantity")) for o in out["meta"].get("cartOps") or [] if o["op"] == "add")


def line(iid, qty=1, price=None):
    it = next(i for i in HOUSE + FAST if i["id"] == iid)
    return {"itemId": iid, "quantity": qty, "price": price if price is not None else it["price"]}


def state_of(out):
    m = out["meta"]
    return {"tray": m.get("tray"), "reco": m.get("reco"), "checkout": m.get("checkout") or {},
            "focus": [{"id": x["itemId"], "name": x.get("name")} for x in m.get("mentionedItems") or []]}


# ------------------------------------------------------------------ hearing the dish

def test_a_bracket_is_how_its_made_not_part_of_what_its_called():
    idx = MenuIndex(HOUSE)
    for said in ("রুই মাছ একটা দিন", "রুইমাছ এক্টা দেন"):
        out, calls = run(said)
        assert added(out) == [("rui", 1)] and not calls, (said, out["replyText"])
    assert [i["id"] for i in brain._dishes_named("মাটন কাচ্চি দিন", idx)] == ["fri"]


def test_bhat_alone_is_the_plain_rice_and_dal_is_the_one_on_now():
    out, calls = run("শুধু ডাল আর ভাত খাবো")  # lunch: the breakfast ডাল is off, ড - তে ডাল is on
    assert added(out) == [("bhat", 1), ("ddal", 1)] and not calls, out["replyText"]


def test_a_short_bangla_word_is_never_a_near_miss():
    # "চা" is no near-miss of "চান?" — ষোল আনা স্পেশাল চা is not in "…স্পেশাল কাবাব নিতে চান?"
    idx = MenuIndex(HOUSE + [{"id": "sk", "name": "ষোল আনা স্পেশাল কাবাব", "price": 300, "category": "ছ্যাঁকাখোর"}])
    from waiter_knowledge import find_mentions
    hits = [i["id"] for i in find_mentions("ষোল আনা স্পেশাল কাবাব নিতে চান?", idx, limit=4)]
    assert "cha" not in hits and "sk" in hits, hits


# ------------------------------------------------------------------ an open question never swallows a new order

def _bread_offer_state():
    out, _ = run("বিফ শিক কাবাব দুইটা দেন", at="Tue 20:30")
    assert "offer_bread" in out["meta"]["guards"], out["replyText"]
    return out


def test_a_new_dish_while_a_question_is_open_is_ordered():
    out = _bread_offer_state()
    st, cart = state_of(out), [line("shik", 2)]
    nxt, _ = run("আর ভাত", at="Tue 20:30", cart=cart, state=st, history=[{"role": "assistant", "content": out["replyText"]}])
    assert "বুঝতে পারিনি" not in nxt["replyText"] and "reasked_open_question" not in nxt["meta"]["guards"], nxt["replyText"]


def test_food_the_menu_lacks_is_no_yes_to_the_offer():
    # "সাথে একটা চা নেবেন?" → "আর একটা বোরহানি" (none on this menu) never adds the tea
    st = {"tray": {"pending": {"kind": "offer", "ops": [{"op": "add", "itemId": "cha", "name": "ষোল আনা স্পেশাল চা 🌶🌶",
                                                         "quantity": 1}], "clear": False,
                               "offer": {"type": "drink", "text": "সাথে একটা চা নেবেন?", "item_ids": ["cha"], "moment": "first_add"}}},
          "reco": {}, "checkout": {}}
    out, _ = run("আর একটা বোরহানি", cart=[line("biryani")], state=st)
    assert ("cha", 1) not in added(out) and "offer_accepted" not in out["meta"]["guards"], out["replyText"]


def test_no_make_it_one_changes_the_dish_not_the_rice():
    out, _ = run("দুইটা গরুর লাল ভুনা দেন")
    assert "offer_rice" in out["meta"]["guards"], out["replyText"]
    nxt, _ = run("না একটা করেন", cart=[line("lal", 2)], state=state_of(out),
                 history=[{"role": "assistant", "content": out["replyText"]}])
    ops = nxt["meta"]["cartOps"]
    assert ops == [{"op": "set", "itemId": "lal", "name": "গরুর লাল ভুনা", "lineKey": ops[0].get("lineKey"), "quantity": 1}], ops


def test_one_word_answer_to_which_one_is_the_order():
    hist = [{"role": "assistant", "content": "ড্রিংকের মধ্যে আছে Mint Lemonade অথবা Coca-Cola — কোনটা দেব?"}]
    out, calls = run("কোক", items=FAST, history=hist)
    assert added(out) == [("cola", 1)] and not calls, out["replyText"]


def test_a_number_after_is_there_X_is_that_many():
    first, _ = run("ফিরনি আছে?", model={"replyText": "জি, নূর-ই-কেশর ফিরনি আছে — ৳120। দেব?", "mentionedItems": ["i1"]})
    st = state_of(first)
    st["reco"] = {**(st["reco"] or {}), "last_offered": ["firni"], "last_offer_turn": (st["reco"] or {}).get("turn", 1)}
    out, _ = run("দুইটা দেন", state=st, history=[{"role": "assistant", "content": "জি, নূর-ই-কেশর ফিরনি আছে — ৳120। দেব?"}])
    assert added(out) == [("firni", 2)], out["replyText"]


# ------------------------------------------------------------------ what the guest doesn't eat

def test_no_fish_means_no_prawn_too_and_every_way_of_saying_it():
    for said in ("আমি মাছ খাই না", "মাছ খাবো না", "মাছ না, মাংস", "ও মাছ খেতে পারে না"):
        assert "fish" in extract_prefs(said).avoid, said
    assert "prawn/shrimp" in extract_prefs("প্রন খায় না একজন").avoid
    assert "মাছ না মাংস কোনটা ভালো?" and not extract_prefs("মাছ না মাংস কোনটা ভালো?").avoid  # "X না Y?" asks which
    chingri = next(i for i in HOUSE if i["id"] == "chingri")
    assert violations(chingri, extract_prefs("আমি মাছ খাই না"))


def test_asking_for_veg_is_vegetarian():
    assert "vegetarian" in extract_prefs("ভেজ বার্গার আছে?").diet


# ------------------------------------------------------------------ food sense

def test_tea_is_a_drink_not_a_dessert_and_never_the_cold_one():
    cha = next(i for i in HOUSE if i["id"] == "cha")
    assert not is_dessert(cha) and is_dessert(next(i for i in HOUSE if i["id"] == "firni"))
    idx = MenuIndex(HOUSE)
    c = offers.Ctx(index=idx, orderable={}, rows=[{"itemId": "shik", "name": "বিফ শিক কাবাব 🌶", "quantity": 2, "price": 180}],
                   added=[], picks=[], stats=OrderStats(), profile=GuestProfile(), clash=lambda _it: [], lang="bn",
                   arm={"wording": "reason", "timing": "early"}, meal_kinds=["dinner"])
    drink = offers._best("drink", c, {"shik"}, spicy=True)
    assert drink and drink["id"] != "cha", drink


def test_a_day_dish_is_off_on_other_days():
    items = brain._day_dishes(HOUSE, "Tue 13:30")
    fri = next(i for i in items if i["id"] == "fri")
    assert fri["available"] is False and "শুক্রবার" in fri["unavailableReason"]
    assert next(i for i in brain._day_dishes(HOUSE, "Fri 13:30") if i["id"] == "fri").get("available") is not False
    assert brain._named_days("Beef Tehari (Sun)") == {6} and brain._named_days("রবিবার স্পেশাল") == {6}
    assert not brain._named_days("রবি মাছ")  # (a stem outside brackets is no day)


def test_extras_are_said_after_the_dishes():
    assert brain._period_role(next(i for i in HOUSE if i["id"] == "xpolao")) == "side"


def test_what_goes_with_it_by_what_it_is():
    idx = MenuIndex(HOUSE)
    lal = next(i for i in HOUSE if i["id"] == "lal")
    shape, groups = pairing.partners(lal, idx, {}, ["lal"], lambda _x: True)
    g = {k: [x["id"] for x in v] for k, v in groups}
    assert shape == "curry_bhaat" and g["rice"] == ["bhat"] and g["side"][0] == "ddal", g
    biryani = next(i for i in HOUSE if i["id"] == "biryani")
    shape, groups = pairing.partners(biryani, idx, {}, ["biryani"], lambda _x: True)
    g = {k: [x["id"] for x in v] for k, v in groups}
    assert shape == "rice_dish" and g["drink"] == ["lassi"] and "roast" in g["beside"] and "firni" in g["after"], g
    shik = next(i for i in HOUSE if i["id"] == "shik")
    shape, groups = pairing.partners(shik, idx, {}, ["shik"], lambda _x: True)
    assert shape == "kebab" and [x["id"] for x in dict(groups)["bread"]] == ["porota", "naan"]  # (the plain one first)
    shape, groups = pairing.partners(shik, idx, {"porota": False}, ["shik"], lambda _x: True)  # (porota: breakfast only)
    assert [x["id"] for x in dict(groups)["bread"]] == ["naan"]
    out, calls = run("সাথে কি নেওয়া যায়?", cart=[line("kala")])
    assert out["meta"]["guards"] == ["pairing"] and not calls and out["replyText"].startswith("গরুর কালা ভুনার সাথে সাদা ভাত"), \
        out["replyText"]


def test_a_rice_dish_is_never_asked_about_rice():
    cut = brain._strip_pitches("একটা মিক্স চিকেন খিচুড়ি যোগ করলাম। সাথে কি ভাত নেবেন?", set(), MenuIndex(HOUSE))
    assert cut == "একটা মিক্স চিকেন খিচুড়ি যোগ করলাম।", cut


def test_one_of_its_kind_is_said_plainly():
    out, _ = run("চা আছে?", at="Tue 08:30")
    assert out["replyText"].startswith("জি, ষোল আনা স্পেশাল চা আছে — ৳40। দেব?"), out["replyText"]


# ------------------------------------------------------------------ talking

def test_banglish_short_lines_are_bangla():
    for said in ("koto hoilo?", "koto", "bhai ekta den"):
        assert reply_language(said, "bn") == "bn", said
    assert reply_language("What can I get?", "bn") == "en"


def test_one_question_at_a_time():
    assert brain._one_last_question("Firni মিষ্টি। এটা খেতে চান? অর্ডার করতে চান?") == "Firni মিষ্টি। অর্ডার করতে চান?"
    assert brain._one_last_question("ভাতও অর্ডার করতে চান? অর্ডার অর্ডার করবেন?") == "অর্ডার করবেন?"


def test_the_model_knows_an_online_guest_is_online():
    _out, calls = run("দুইটা বিরিয়ানি ডেলিভারি দিবেন?", channel="online", ctx={"fulfillment": "delivery"})
    sent = json.dumps(calls[-1], ensure_ascii=False)
    assert "Channel: online — delivery" in sent and "Channel: dine-in" not in sent


# ------------------------------------------------------------------ the other kinds of restaurant

def test_a_birthday_is_no_alcohol():
    from waiter_knowledge import missing_kinds
    idx = MenuIndex([{"id": "c", "name": "Chocolate Cake 1 lb", "price": 900, "category": "Cakes"}])
    assert "alcohol" not in " ".join(missing_kinds("জন্মদিনের কেক আছে?", idx))
    assert missing_kinds("মদ আছে?", idx)


def test_one_dish_many_spellings():
    idx = MenuIndex([{"id": "p", "name": "Paratha", "price": 15, "category": "Nashta"},
                     {"id": "pd", "name": "Porota with Dal", "price": 40, "category": "Nashta"},
                     {"id": "db", "name": "Dal Bhaji", "price": 30, "category": "Nashta"}])
    assert [i["id"] for i in brain._dishes_named("দুইটা পরোটা", idx)] == ["p"]
    # a count for every dish, no verb: an order
    ops = brain._clean_order("দুইটা পরোটা আর একটা ডাল ভাজি", idx, {}, {})
    assert [(o["item"], o["quantity"]) for o in ops] == [(idx.ref(idx.by_id["p"]), 2), (idx.ref(idx.by_id["db"]), 1)], ops


def test_a_bracket_still_counts_when_another_dish_is_called_that():
    idx = MenuIndex([{"id": "d", "name": "ড - তে ডাল", "price": 40, "category": "x"},
                     {"id": "dp", "name": "ড - তে ডাল (পাসেল)", "price": 60, "category": "x"}])
    assert [i["id"] for i in brain._dishes_named("ড - তে ডাল দেন", idx)] == ["d"]


def test_a_taste_wish_while_a_question_is_open_is_a_note_not_noise():
    st = {"tray": {"pending": {"kind": "offer", "ops": [{"op": "add", "itemId": "lassi", "name": "আদা লেবু লাচ্ছি",
                                                         "quantity": 1}], "clear": False,
                               "offer": {"type": "drink", "text": "সাথে একটা লাচ্ছি নেবেন?", "item_ids": ["lassi"],
                                         "moment": "first_add"}}}, "reco": {}, "checkout": {}}
    out, _ = run("টক বেশি দিয়েন", cart=[line("lal")], state=st)
    assert "reasked_open_question" not in out["meta"]["guards"], out["replyText"]


def test_a_dish_the_menu_lacks_is_no_kind_list():
    juice = [{"id": "mj", "name": "Mango Juice", "price": 120, "category": "Juice"},
             {"id": "ml", "name": "Mango Lassi", "price": 150, "category": "Lassi"},
             {"id": "bs", "name": "Banana Shake", "price": 160, "category": "Shake"},
             {"id": "cs", "name": "Chocolate Shake", "price": 170, "category": "Shake"}]
    out, calls = run("ম্যাঙ্গো শেক আছে?", items=juice)
    assert out["meta"]["guards"] == ["not_on_menu"] and "reco_kind" not in out["meta"]["guards"], out["replyText"]
    assert "Mango Juice" in out["replyText"] and "Banana Shake" not in out["replyText"], out["replyText"]


def test_what_goes_with_a_curry_elsewhere():
    indian = [{"id": "bc", "name": "Butter Chicken", "price": 380, "category": "Curry"},
              {"id": "jr", "name": "Jeera Rice", "price": 160, "category": "Rice"},
              {"id": "bn", "name": "Butter Naan", "price": 60, "category": "Bread"},
              {"id": "ml", "name": "Mango Lassi", "price": 150, "category": "Drinks"}]
    out, calls = run("সাথে কি নেব?", items=indian, cart=[{"itemId": "bc", "quantity": 1, "price": 380}], at="Tue 20:30")
    assert out["meta"]["guards"] == ["pairing"] and not calls, out["replyText"]
    assert "Jeera Rice" in out["replyText"] and "Butter Naan" in out["replyText"], out["replyText"]


# ------------------------------------------------------------------ what's in the tray / what's off (a real chat, 2026-10-20)

def _breakfast_house():
    items = [dict(i) for i in HOUSE]
    items.append({"id": "but", "name": "বুটের ডাল", "price": 30, "category": "ভোরের শহর", "categoryId": "o",
                  "periods": ["breakfast"]})
    items.append({"id": "mug", "name": "মুগ ডাল", "price": 40, "category": "ভোরের শহর", "categoryId": "o",
                  "periods": ["breakfast"], "hidden": True, "status": "hidden", "available": False})
    for it in items:
        if it["id"] == "dal":  # the old ডাল, switched off
            it.update(hidden=True, status="hidden", available=False, category="ভর্তা ভাজির মাখামাখি", periods=None)
    return items


def test_whats_there_never_repeats_the_tray_nor_lists_whats_off():
    items = _breakfast_house()
    out, calls = run("সকালের খাবারে কি কি আছে?", items=items, at="Tue 09:30", cart=[{"itemId": "but", "quantity": 1, "price": 30}],
                     state={"checkout": {"stage": "readback"}})  # (while the order waits for its yes, too)
    assert "period_menu" in out["meta"]["guards"] and not calls, out["replyText"]
    assert "বুটের ডাল" not in out["replyText"] and "মুগ ডাল" not in out["replyText"] and "পরোটা" in out["replyText"], out["replyText"]
    later, _ = run("সকালের খাবারে কি কি আছে?", items=items, at="Tue 15:00")  # off hours: still never the switched-off ones
    assert "মুগ ডাল" not in later["replyText"] and "বুটের ডাল" in later["replyText"], later["replyText"]


def test_an_off_dish_in_the_tray_is_said_as_the_trays_with_the_one_that_is_on():
    items = _breakfast_house()
    idx = MenuIndex(items)
    orderable = {idx.item_id(i): i.get("available") is not False for i in idx.items}
    text = brain._gone_from_tray({"itemId": "dal", "name": "ডাল"}, idx, orderable, set(), "bn")
    assert text == "খেয়াল করবেন: আপনার ট্রের ডাল এখন পাওয়া যাচ্ছে না — বদলে ড - তে ডাল বা বুটের ডাল দেব?", text
    assert brain._reason_bn([{"reason": "not available right now"}]) == ""
