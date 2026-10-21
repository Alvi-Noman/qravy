"""The phase-by-phase review (2026-10-20, afternoon): price, availability, "not on the menu", categories, follow-ups and
upsells answered from the menu itself — exact, never a stupid substitute.  Run: python -m pytest tests/test_phase_answers.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
import menu_answers as ma  # noqa: E402
import offers  # noqa: E402
from recommender import GuestProfile, OrderStats, extract_prefs  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

TURN = {"topic": "other", "intent": "menu", "language": "bn", "mentionedItems": [], "cartOps": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": "MODEL"}

HOUSE = [
    {"id": "bhat", "name": "সাদা ভাত", "price": 40, "category": "মাছে মাতাল বাঙালি"},
    {"id": "rui", "name": "রুই মাছ (গ্লাসি)", "price": 220, "category": "মাছে মাতাল বাঙালি"},
    {"id": "ilish", "name": "সরষে ইলিশ", "price": 450, "category": "মাছে মাতাল বাঙালি", "available": False,
     "unavailableReason": "আজ শেষ হয়ে গেছে"},
    {"id": "rup", "name": "রূপসী রূপচাঁদা (ভুনা)", "price": 400, "category": "মাছে মাতাল বাঙালি"},
    {"id": "ilish_b", "name": "ইলিশ ভর্তা", "price": 120, "category": "ভর্তা ভাজির মাখামাখি"},
    {"id": "alu", "name": "আলু ভর্তা", "price": 30, "category": "ভর্তা ভাজির মাখামাখি"},
    {"id": "dal", "name": "ড - তে ডাল", "price": 40, "category": "ভর্তা ভাজির মাখামাখি"},
    {"id": "lal", "name": "গরুর লাল ভুনা", "price": 250, "category": "কারির কাহিনী"},
    {"id": "roast", "name": "মুরগির রোস্ট", "price": 280, "category": "কারির কাহিনী"},
    {"id": "jhal", "name": "চিকেন ঝাল ফ্রাই", "price": 260, "category": "কারির কাহিনী"},
    {"id": "biryani", "name": "চিকেন বিরিয়ানি", "price": 250, "category": "দিন দুপুরে", "available": False,
     "unavailableReason": "আজ শেষ হয়ে গেছে"},
    {"id": "polao", "name": "চিকেন শাহী পোলাও", "price": 250, "category": "দিন দুপুরে"},
    {"id": "bpolao", "name": "বিফ পোলাও", "price": 300, "category": "দিন দুপুরে"},
    {"id": "xpolao", "name": "এক্সট্রা পোলাও রাইস", "price": 80, "category": "দিন দুপুরে"},
    {"id": "coke", "name": "কোকা কোলা", "price": 25, "category": "কলিজা ঠাণ্ডা"},
    {"id": "lassi", "name": "আদা লেবু লাচ্ছি", "price": 120, "category": "কলিজা ঠাণ্ডা"},
    {"id": "firni", "name": "নূর-ই-কেশর ফিরনি", "price": 120, "category": "মিষ্টি বিলাস"},
]
FAST = [
    {"id": "smash", "name": "Classic Smash Burger", "price": 390, "category": "Burgers"},
    {"id": "tower", "name": "Triple Cheese Tower", "price": 590, "category": "Burgers", "available": False,
     "unavailableReason": "আজ শেষ হয়ে গেছে"},
    {"id": "stack", "name": "Beef Bacon Stack", "price": 520, "category": "Burgers"},
    {"id": "fc", "name": "Fried Chicken", "price": 280, "category": "Chicken"},
    {"id": "fries", "name": "Classic Fries", "price": 150, "category": "Sides"},
    {"id": "cola", "name": "Coca-Cola", "price": 80, "category": "Drinks"},
]
CAFE = [
    {"id": "capp", "name": "Cappuccino", "price": 240, "category": "Coffee"},
    {"id": "brownie", "name": "Brownie", "price": 150, "category": "Bakery"},
    {"id": "water", "name": "Mineral Water", "price": 30, "category": "Drinks"},
]


def run(text, items=HOUSE, history=None, cart=None, state=None, at="Tue 13:30"):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(TURN)

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": items}, locale="bn", history=history or [],
                                               dialog_state=state, restaurant={"staffAlerts": False},
                                               context={"cartItems": cart or [], "table": "5", "localTime": at}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    return out, calls


# ------------------------------------------------------------------ availability: which one, and what instead

def test_sold_out_offers_the_same_kind_never_a_side():
    out, calls = run("সরষে ইলিশ দিন")
    assert not calls and out["replyText"].startswith("দুঃখিত, সরষে ইলিশ আজ শেষ হয়ে গেছে।"), out["replyText"]
    assert "রূপসী রূপচাঁদা" in out["replyText"] and "ইলিশ ভর্তা" not in out["replyText"], out["replyText"]
    out, _ = run("চিকেন বিরিয়ানি আছে?")
    assert "চিকেন শাহী পোলাও" in out["replyText"] and "এক্সট্রা" not in out["replyText"], out["replyText"]
    out, _ = run("ট্রিপল চিজ টাওয়ার দেন", items=FAST)
    assert "Beef Bacon Stack" in out["replyText"] and "Fried Chicken" not in out["replyText"], out["replyText"]


def test_not_on_the_menu_is_said_so_never_today():
    out, calls = run("বিফ তেহারি দেন")
    assert not calls and out["replyText"].startswith("দুঃখিত, বিফ তেহারি আমাদের মেনুতে নেই।"), out["replyText"]
    assert "বিফ পোলাও" in out["replyText"] and "আজ" not in out["replyText"], out["replyText"]
    out, _ = run("চিকেন ফ্রাইড রাইস আছে?", items=FAST)  # no fried rice: never "Fried Chicken" for it
    assert "মেনুতে নেই" in out["replyText"] and "Fried Chicken" not in out["replyText"], out["replyText"]


# ------------------------------------------------------------------ price

def test_price_from_the_menu():
    out, calls = run("রুই মাছের দাম কত?")
    assert not calls and out["replyText"] == "রুই মাছ ৳220। দেব?", out["replyText"]
    out, _ = run("সবচেয়ে দামি কোনটা?", items=FAST)
    assert out["replyText"].startswith("সবচেয়ে দামি হলো Beef Bacon Stack"), out["replyText"]  # (the Tower is off today)
    out, _ = run("পিজ্জার দাম কত?")
    assert out["replyText"].startswith("দুঃখিত, পিজ্জা আমাদের মেনুতে নেই।") and "৳" not in out["replyText"].split("।")[0]
    out, _ = run("সরষে ইলিশের দাম কত?")
    assert out["replyText"].startswith("সরষে ইলিশ ৳450 — তবে আজ শেষ হয়ে গেছে।"), out["replyText"]


# ------------------------------------------------------------------ categories

def test_categories_are_the_sections():
    out, calls = run("কি কি ক্যাটাগরি আছে?")
    assert not calls and out["replyText"].startswith("আমাদের মেনুতে আছে") and "কারির কাহিনী" in out["replyText"], out["replyText"]


# ------------------------------------------------------------------ follow-ups

def test_ordinals_and_say_again():
    state = {"reco": {"turn": 3, "last_offered": ["lal", "rui", "roast"], "last_offer_turn": 3}}
    out, _ = run("দ্বিতীয়টার দাম কত?", state=state)
    assert out["replyText"].startswith("রুই মাছ ৳220"), out["replyText"]
    hist = [{"role": "assistant", "content": "রুই মাছ ৳220। দেব?"}]
    out, calls = run("আবার বলেন তো", history=hist)
    assert not calls and out["replyText"] == "রুই মাছ ৳220। দেব?", out["replyText"]


def test_budget_and_party_in_words():
    p = extract_prefs("দুইজন, পাঁচশো টাকার মধ্যে কি খাওয়া যায়?")
    assert (p.party_size, p.budget) == (2, 500)
    assert extract_prefs("তিনজন খাবো, দেড় হাজার").budget == 1500
    assert not extract_prefs("প্রন খায় না একজন").party_size


# ------------------------------------------------------------------ upsells that make sense

def _ctx(items, rows, added, kinds=("lunch",)):
    idx = MenuIndex(items)
    return offers.Ctx(index=idx, orderable={idx.item_id(i): i.get("available") is not False for i in idx.items},
                      rows=rows, added=added, picks=[], stats=OrderStats(), profile=GuestProfile(), clash=lambda _x: [],
                      lang="bn", arm={"wording": "reason", "timing": "early"}, meal_kinds=list(kinds))


def test_coffee_gets_a_bite_and_roast_gets_polao():
    o = offers.plan("first_add", _ctx(CAFE, [{"itemId": "capp", "quantity": 1, "price": 240}],
                                      [{"op": "add", "itemId": "capp", "quantity": 1}]))
    assert o and o.type == "bite" and "Brownie" in o.text, o and o.text
    o = offers.plan("first_add", _ctx(HOUSE, [{"itemId": "roast", "quantity": 1, "price": 280}],
                                      [{"op": "add", "itemId": "roast", "quantity": 1}]))
    assert o and o.type == "rice" and "পোলাও" in o.text, o and o.text


def test_bhaat_curry_with_rice_gets_dal_or_bhorta():
    rows = [{"itemId": "lal", "quantity": 1, "price": 250}, {"itemId": "bhat", "quantity": 1, "price": 40}]
    o = offers.plan("first_add", _ctx(HOUSE, rows, [{"op": "add", "itemId": "lal", "quantity": 1},
                                                    {"op": "add", "itemId": "bhat", "quantity": 1}]))
    # (the bhortas on this menu — no bhaji: "সাথে ভর্তা কিছু নেবেন?"; a "ভর্তা" answer lists them, ডাল adds the dal)
    assert o and o.type == "side" and o.text == "সাথে ভর্তা কিছু নেবেন?", o and o.text
    assert [ch["label"] for ch in o.choices] == ["ভর্তা", "ডাল"], o.choices
    assert set(o.choices[0]["items"]) == {"ilish_b", "alu"}, o.choices


def test_upsell_timing_is_never_late():
    os.environ["UPSELL_AB"] = "on"
    try:
        assert all(offers.arm_for("t", f"s{i}")["timing"] == "early" for i in range(20))
    finally:
        os.environ["UPSELL_AB"] = "off"


def test_alternatives_by_kind():
    idx = MenuIndex(HOUSE)
    o = {idx.item_id(i): i.get("available") is not False for i in idx.items}
    ilish = idx.by_id["ilish"]
    assert [a["id"] for a in ma.alternatives(ilish, idx, o, skip={"ilish"})][:1] == ["rup"]
    assert ma.course(idx.by_id["xpolao"]) == "side" and ma.course(idx.by_id["coke"]) == "drink"


# ------------------------------------------------------------------ the second pass (same day)

def test_a_kind_word_the_dish_lacks_is_not_that_dish():
    out, _ = run("বিফ তেহারি আছে?")  # বিফ is বিফ পোলাও's own word — but তেহারি is not it
    assert out["replyText"].startswith("দুঃখিত, বিফ তেহারি আমাদের মেনুতে নেই।"), out["replyText"]
    out, _ = run("চিকেন ফ্রাইড রাইস আছে?", items=FAST)  # never "জি, Fried Chicken আছে"
    assert "মেনুতে নেই" in out["replyText"] and "Fried Chicken আছে" not in out["replyText"], out["replyText"]
    out, _ = run("একটা বড় কাচ্চি দিন", items=[{"id": "kb", "name": "Kacchi Biryani", "price": 380, "category": "Biryani"}])
    assert out["meta"]["guards"] != ["not_on_menu"], out["replyText"]  # a size is not part of the dish


def test_size_after_the_prices_and_one_dish_twice():
    items = [{"id": "kf", "name": "Kacchi (Full)", "price": 380, "category": "Biryani"},
             {"id": "kh", "name": "Kacchi (Half)", "price": 280, "category": "Biryani"},
             {"id": "b1", "name": "Borhani", "price": 120, "category": "Sides"},
             {"id": "b2", "name": "Borhani", "price": 120, "category": "Drinks"}]
    state = {"reco": {"turn": 2, "last_offered": ["kf", "kh"], "last_offer_turn": 2}, "focus": ["kf"]}
    hist = [{"role": "assistant", "content": "Kacchi — Full ৳380, Half ৳280। কোনটা দেব?"}]
    out, _ = run("হাফ কত?", items=items, history=hist, state=state)
    assert "৳280" in out["replyText"] and "৳380" not in out["replyText"], out["replyText"]
    out, _ = run("বোরহানি কত?", items=items)
    assert out["replyText"] == "Borhani ৳120। দেব?", out["replyText"]


def test_off_hours_say_when_in_bangla():
    import availability
    assert availability.format_windows([{"start": "07:00", "end": "11:00"}], "bn") == "সকাল ৭টা–১১টা"
    assert availability.format_windows([{"start": "17:00", "end": "22:00"}], "bn") == "বিকাল ৫টা–রাত ১০টা"
    it = {"name": "চিকেন শর্মা", "category": "ছ্যাঁকাখোর", "unavailableReason": "ছ্যাঁকাখোর পাওয়া যায় বিকাল ৫টা–রাত ১০টা।"}
    assert ma.off_line(it, "bn") == "চিকেন শর্মা পাওয়া যায় বিকাল ৫টা–রাত ১০টা"


def test_roasts_get_a_plate_of_polao_each():
    o = offers.plan("first_add", _ctx(HOUSE, [{"itemId": "roast", "quantity": 4, "price": 280}],
                                      [{"op": "add", "itemId": "roast", "quantity": 4}], kinds=("dinner",)))
    assert o and o.type == "rice" and o.ops[0]["itemId"] == "xpolao" and o.ops[0]["quantity"] == 4, o and o.text


def test_an_order_without_the_model_is_never_a_price_list():
    async def down(messages):
        raise RuntimeError("insufficient_quota")

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = down, no_reading
    try:
        out = asyncio.run(brain.generate_reply("একটা ক্লাসিক স্মাশ বার্গার, পেঁয়াজ ছাড়া", menu_snapshot={"items": FAST},
                                               locale="bn", history=[], restaurant={"staffAlerts": False},
                                               context={"cartItems": [], "table": "5", "localTime": "Tue 20:30"}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u
    assert "৳" not in out["replyText"] and "মেনু থেকে" in out["replyText"], out["replyText"]


def test_without_fish_then_cheaper_holds_both():
    import session_ctx
    sid, hist, state, outs = f"t-{os.getpid()}-nofish", [], None, []
    items = [dict(i) for i in HOUSE] + [
        {"id": "muri", "name": "মুড়ি ঘন্ট", "price": 80, "category": "মাছে মাতাল বাঙালি"},
        {"id": "anaras", "name": "প্রকৃত আনারস", "price": 100, "category": "কলিজা ঠাণ্ডা"},
        {"id": "chap", "name": "চিকেন চাপ", "price": 160, "category": "কারির কাহিনী"}]
    for said in ("ভালো কি খাওয়া যায়?", "মাছ ছাড়া", "আরেকটু কম দামে"):
        out, _ = run(said, items=items, history=hist, state=state)
        session_ctx.update_state("t", sid, meta=out["meta"], user_text=said)
        state = session_ctx.get_state("t", sid)
        hist += [{"role": "user", "content": said}, {"role": "assistant", "content": out["replyText"]}]
        outs.append(out)
    no_fish = outs[1]["replyText"]
    assert outs[1]["meta"]["guards"][0].startswith(("reco_", "thread_")) and "আনারস" not in no_fish and "রূপচাঁদা" not in no_fish and "রুই" not in no_fish, no_fish
    cheaper = outs[2]["replyText"]
    assert outs[2]["meta"]["guards"] == ["reco_cheaper"], cheaper
    assert "মুড়ি ঘন্ট" not in cheaper and "আনারস" not in cheaper and "৳" in cheaper, cheaper


INDIAN = [{"id": "bc", "name": "Butter Chicken", "price": 380, "category": "Curry"},
          {"id": "dm", "name": "Dal Makhani", "price": 300, "category": "Curry"},
          {"id": "jr", "name": "Jeera Rice", "price": 160, "category": "Rice"},
          {"id": "bn", "name": "Butter Naan", "price": 60, "category": "Bread"},
          {"id": "gn", "name": "Garlic Naan", "price": 70, "category": "Bread"},
          {"id": "ml", "name": "Mango Lassi", "price": 150, "category": "Drinks"}]


def test_thanks_and_place_questions_get_no_pitch():
    out, calls = run("thanks", items=FAST)
    assert not calls and "Hot Wings" not in out["replyText"] and out["meta"]["guards"] == ["small_talk"], out["replyText"]
    pitch = dict(TURN, replyText="ওয়াশরুমের জন্য স্টাফকে ডাকুন। এখন ভাত খেতে পারেন। গরুর লাল ভুনা নিতে পারেন।")
    orig = TURN.copy()
    TURN.update(pitch)
    try:
        out, _ = run("ওয়াশরুম কোথায়?")
    finally:
        TURN.clear(); TURN.update(orig)
    assert "ভুনা" not in out["replyText"] and "স্টাফ" in out["replyText"] and not out["meta"].get("suggestions"), out["replyText"]


def test_bread_pairing_and_a_question_with_an_order():
    out, calls = run("বাটার নানের সাথে কি নেব?", items=INDIAN, at="Tue 20:30")
    assert not calls and out["meta"]["guards"] == ["pairing"] and "Butter Chicken" in out["replyText"], out["replyText"]
    orig = TURN.copy()
    TURN.update(intent="order", cartOps=[{"op": "add", "itemId": "bc", "quantity": 1}],
                replyText="একটা Butter Chicken যোগ করলাম। সাথে Chicken Biryani নিতে পারেন।")
    try:
        out, _ = run("একটা বাটার চিকেন দিন, সাথে কী ভালো যাবে?", items=INDIAN, at="Tue 20:30")
    finally:
        TURN.clear(); TURN.update(orig)
    assert "pairing_after_add" in out["meta"]["guards"], (out["meta"]["guards"], out["replyText"])
    assert "Biryani" not in out["replyText"], out["replyText"]
    assert "Jeera Rice" in out["replyText"] and "Butter Naan" in out["replyText"], out["replyText"]


def test_a_kind_ordered_asks_which_one():
    out, calls = run("একটা নান দেন", items=INDIAN, at="Tue 20:30")
    assert not calls and out["meta"]["guards"] == ["which_one"], out["replyText"]
    assert [o["label"] for o in out["meta"]["decision"]["chooseOptions"]] == ["Butter Naan", "Garlic Naan"]


def test_the_second_one_after_a_question_about_the_first():
    import session_ctx
    sid, hist, state = f"t-{os.getpid()}-ord", [], None
    for said in ("কি সাজেস্ট করবেন?", "প্রথমটা কেমন?"):
        out, _ = run(said, history=hist, state=state)
        session_ctx.update_state("t", sid, meta=out["meta"], user_text=said)
        state = session_ctx.get_state("t", sid)
        hist += [{"role": "user", "content": said}, {"role": "assistant", "content": out["replyText"]}]
    listed = state["reco"]["last_list"]
    out, _ = run("দ্বিতীয়টার দাম কত?", history=hist, state=state)
    second = bangla_meal_name = __import__("bangla_meal").said_name(MenuIndex(HOUSE).by_id[listed[1]])
    assert out["replyText"].startswith(second), (out["replyText"], second)


CHINESE = [{"id": "ts", "name": "Thai Soup", "price": 280, "category": "Soup"},
           {"id": "cfr", "name": "Chicken Fried Rice", "price": 320, "category": "Rice"},
           {"id": "efr", "name": "Egg Fried Rice", "price": 300, "category": "Rice"},
           {"id": "mv", "name": "Mixed Vegetable", "price": 260, "category": "Vegetable"},
           {"id": "pt", "name": "Prawn Tempura", "price": 450, "category": "Appetizer"}]


def test_healthy_is_said_honestly():
    out, calls = run("হেলদি কিছু আছে?", items=CHINESE, at="Tue 20:30")
    assert not calls and out["meta"]["guards"] == ["healthy"], out["replyText"]
    assert "Thai Soup" in out["replyText"] and "Tempura" not in out["replyText"] and "Fried Rice" not in out["replyText"]
    out, _ = run("হেলদি কিছু আছে?", items=FAST, at="Tue 20:30")
    assert out["meta"]["guards"] == ["healthy_none"] and "Fries" not in out["replyText"], out["replyText"]


def test_a_nearly_heard_dish_is_checked_once():
    pz = [{"id": "pp", "name": "Pepperoni Pizza", "price": 650, "category": "Pizza"},
          {"id": "mg", "name": "Margherita Pizza", "price": 550, "category": "Pizza"}]
    out, calls = run("একটা পেপারনি পিজ্জা দিন", items=pz, at="Tue 20:30")
    assert not calls and out["replyText"] == "Pepperoni Pizza (৳650) — এটাই দেব?", out["replyText"]
    assert [o["label"] for o in out["meta"]["decision"]["chooseOptions"]] == ["হ্যাঁ, দিন", "না, থাক"]
    out, _ = run("একটা Margherita Pizza দিন", items=pz, at="Tue 20:30")  # its name as on the menu → no check
    assert "confirm_heard" not in out["meta"]["guards"], out["meta"]["guards"]


def test_a_model_reading_never_invents_a_diet():
    orig = TURN.copy()
    TURN.update(guestPrefs={"diet": ["vegetarian"]})
    try:
        out, _ = run("হেলদি খাবার কোনটা ভালো হবে বলেন তো", items=FAST)
    finally:
        TURN.clear(); TURN.update(orig)
    assert "vegetarian" not in (out["meta"]["reco"]["profile"].get("diet") or []), out["meta"]["reco"]["profile"]


def test_is_it_spicy_is_about_the_dishes_just_said():
    items = [{"id": "hw", "name": "Hot Wings", "price": 320, "category": "Chicken"},
             {"id": "ms", "name": "Mini Slider Trio", "price": 450, "category": "Burgers"},
             {"id": "fc", "name": "Fried Chicken", "price": 280, "category": "Chicken"},
             {"id": "nb", "name": "Naga Burger", "price": 380, "category": "Burgers"}]
    state = {"reco": {"turn": 2, "last_offered": ["hw", "ms", "fc"], "last_offer_turn": 2}}
    out, calls = run("ওইটা ঝাল?", items=items, state=state, at="Tue 20:30")
    assert not calls and out["meta"]["guards"] == ["taste_of_shown"], out["replyText"]
    assert "Hot Wings" in out["replyText"] and "Naga" not in out["replyText"], out["replyText"]
