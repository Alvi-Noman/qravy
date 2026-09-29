"""Offline tests for the waiter's deterministic layer — run: python -m pytest tests  (or: python tests/test_waiter_brain.py)"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from waiter_knowledge import (  # noqa: E402
    MenuIndex,
    find_mentions,
    is_affirmative,
    is_done_ordering,
    is_explicit_confirm,
    item_hints,
    last_assistant_asked_to_confirm,
    render_catalog,
    render_restaurant,
    reply_language,
)

ITEMS = [
    {"id": "a1", "name": "Spring Roll", "price": 230, "category": "Appetizer"},
    {"id": "a2", "name": "Special Spring Roll", "price": 300, "category": "Appetizer"},
    {"id": "s1", "name": "Hot & Sour Soup", "price": 320, "category": "Soup", "tags": ["Spicy"]},
    {"id": "s2", "name": "Chicken Corn Soup", "price": 300, "category": "Soup"},
    {"id": "v1", "name": "Vegetable Sizzling", "price": 320, "category": "Sizzling", "tags": ["Vegetarian"]},
    {"id": "n1", "name": "Chicken with Cashew nut", "price": 350, "category": "Chicken Selection"},
    {"id": "x1", "name": "Sold Out Prawn", "price": 380, "category": "Prawn Selection", "available": False,
     "unavailableReason": "Sorry, Sold Out Prawn is sold out right now."},
    {
        "id": "c2", "name": "Choice of 2 Curry", "price": 320, "category": "Choice of Curry",
        "modifierGroups": [{"id": "g", "name": "Choose 2 Curries", "min": 2, "max": 2, "options": [
            {"id": "o1", "name": "Beef Chili Onion", "price": 0},
            {"id": "o2", "name": "Szu-Chuan Chicken", "price": 0},
            {"id": "o3", "name": "Beef Hot Sauce", "price": 0},
        ]}],
    },
]
IDX = MenuIndex(ITEMS)
EMPTY_TURN = {
    "topic": "item_question", "intent": "menu", "language": "en", "mentionedItems": [], "cartOps": [],
    "clearCart": False, "confirmOrder": False, "serviceRequest": None, "suggestions": [], "voiceReplyText": "",
}


# ------------------------------------------------------------------ detectors

def test_affirmative_only_for_real_yes():
    for yes in ["yes", "Yes please", "ok", "yes, confirm the order", "sure go ahead", "জি", "হ্যাঁ কনফার্ম করুন", "ঠিক আছে"]:
        assert is_affirmative(yes), yes
    for no in ["you have any desserts?", "yellow curry", "ok add fries", "হাফ প্লেট দেন", "no", "yes but no onions",
               "okay what's spicy?", "not yet", "না"]:
        assert not is_affirmative(no), no


def test_explicit_confirm_ignores_questions_and_negation():
    assert is_explicit_confirm("confirm my order")
    assert is_explicit_confirm("please place the order")
    assert is_explicit_confirm("অর্ডার কনফার্ম করুন")
    assert not is_explicit_confirm("can you confirm my order has no nuts?")
    assert not is_explicit_confirm("don't confirm yet")
    assert not is_explicit_confirm("কনফার্ম করব না")


def test_done_ordering():
    for t in ["No, that's all", "that's it", "nothing else thanks", "আর কিছু লাগবে না", "না"]:
        assert is_done_ordering(t), t
    for t in ["no onions please", "2 nuggets", "নাগেটস দিন"]:
        assert not is_done_ordering(t), t


def test_last_assistant_asked_to_confirm():
    assert last_assistant_asked_to_confirm([{"role": "assistant", "content": "Anything else, or shall I confirm your order?"}])
    assert last_assistant_asked_to_confirm([{"role": "assistant", "content": "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"}])
    assert not last_assistant_asked_to_confirm([{"role": "assistant", "content": "The Spring Roll is ৳230."}])


def test_garbled_speech_gets_a_polite_repeat_request():
    # live: "নিউবদ্র সাস্কর ভাব্য়া পাসি" → "আপনার অর্ডার দারুণ হয়েছে" (invented, confusing)
    obj = {**EMPTY_TURN, "topic": "other", "intent": "chitchat", "language": "bn", "understood": False,
           "replyText": "আপনার অর্ডার দারুণ হয়েছে। আর কিছু জানতে বা নিতে চান?"}

    async def fake(messages):
        return json.dumps(obj)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply("নিউবদ্র সাস্কর ভাব্য়া পাসি।", menu_snapshot={"items": ITEMS}, locale="bn",
                                               context={"cartItems": [{"itemId": "a1", "quantity": 1}]}))
    finally:
        brain._call_openai = orig
    assert out["replyText"] == "দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন, প্লিজ?"
    assert out["meta"]["cartOps"] == [] and not out["meta"]["suggestions"] and "not_understood" in out["meta"]["guards"]


def test_chosen_language_is_locked_on_the_storefront():
    # the restaurant (or the guest's switch) chose Bangla: English speech still gets a Bangla reply;
    # without the lock the waiter mirrors the guest (evals, older clients)
    seen = []

    async def fake(messages):
        seen.append(messages[-1]["content"])
        return json.dumps({**EMPTY_TURN, "language": "bn", "replyText": "Spring Roll এর দাম ৳230।"})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        locked = asyncio.run(brain.generate_reply("How much is the spring roll?", menu_snapshot={"items": ITEMS},
                                                  locale="bn", lock_language=True))
        mirrored = asyncio.run(brain.generate_reply("How much is the spring roll?", menu_snapshot={"items": ITEMS},
                                                    locale="bn"))
    finally:
        brain._call_openai = orig
    assert locked["meta"]["language"] == "bn"
    assert mirrored["meta"]["language"] == "en"


def test_thanda_means_drinks():
    from waiter_knowledge import kind_items, missing_kinds

    idx = MenuIndex(ITEMS + [
        {"id": "d1", "name": "Choice of Soft Drinks (Served in a glass)", "price": 35, "category": "Drinks"},
        {"id": "d2", "name": "Mineral Water (small)", "price": 20, "category": "Drinks"},
    ])
    for asked in ["ঠান্ডার মধ্যে কী কী আছে আপনার হোটেলে?", "thanda ki ache?", "কোল্ড ড্রিংকস কী আছে?", "any cold drinks?"]:
        kinds = dict(kind_items(asked, idx))
        assert "drinks" in kinds, asked
        assert any(i["id"] == "d1" for i in kinds["drinks"]), asked
    # a menu without soft drinks says so honestly
    assert "drinks" in missing_kinds("ঠান্ডা কী আছে?", IDX)


def test_listing_answer_shows_cards_and_only_see_menu_opens_the_menu():
    items = ITEMS + [
        {"id": "d1", "name": "Choice of Soft Drinks (Served in a glass)", "price": 30, "category": "Drinks"},
        {"id": "d2", "name": "Mineral Water (small)", "price": 15, "category": "Drinks"},
        {"id": "d3", "name": "Mineral Water (large)", "price": 25, "category": "Drinks"},
    ]
    live = {**EMPTY_TURN, "topic": "availability", "intent": "menu", "language": "bn",
            "replyText": "আমাদের ড্রিংকসের মধ্যে Choice of Soft Drinks (Served in a glass) ৳30, Mineral Water (small) ৳15, "
                         "এবং Mineral Water (large) ৳25 আছে। কোনটা নিতে চান?"}

    def run(text, obj):
        async def fake(messages):
            return json.dumps(obj)

        orig = brain._call_openai
        brain._call_openai = fake
        try:
            return asyncio.run(brain.generate_reply(text, menu_snapshot={"items": items}, locale="bn"))
        finally:
            brain._call_openai = orig

    out = run("ঠান্ডার মধ্যে কী কী আছে?", live)
    m = out["meta"]
    assert m["intent"] == "suggestions" and m["decision"]["showSuggestionsModal"] is True
    assert {s["itemId"] for s in m["suggestions"]} == {"d1", "d2", "d3"}
    assert not m["decision"].get("openMenu")
    # a plain question about one dish stays a question — no cards, no menu page
    one = {**EMPTY_TURN, "topic": "item_question", "intent": "menu", "replyText": "The Spring Roll is ৳230."}
    m = run("How much is the Spring Roll?", one)["meta"]
    assert not m["decision"].get("showSuggestionsModal") and not m["decision"].get("openMenu")
    # an explicit request opens the menu page
    for ask in ["মেনুটা দেখান", "show me the menu", "menu dekhan"]:
        m = run(ask, {**EMPTY_TURN, "topic": "restaurant_info", "replyText": "Sure, here's our menu."})["meta"]
        assert m["decision"].get("openMenu") is True, ask


def test_reply_language_mirrors_guest():
    assert reply_language("Is the soup spicy?", "bn") == "en"
    assert reply_language("স্প্রিং রোল এর দাম কত?", "en") == "bn"
    assert reply_language("ekta beef sizzling ar duita onion ring den", "en") == "bn"
    assert reply_language("koto taka?", "en") == "bn"
    assert reply_language("ok", "bn") == "bn"
    assert reply_language("Price ৳230?", "bn") == "en"  # taka sign isn't Bangla speech
    # live: a Bangla speaker ordering by dish names — transcribed in English letters, still a Bangla guest
    live = "Crispy rice soup, lemon doita, choice of two curry with fried rice and vegetable given, chapta."
    assert reply_language(live, "bn") == "bn"
    assert reply_language(live, "en") == "en"  # an English-mode guest stays English
    assert reply_language("Can I get two spring rolls please", "bn") == "en"
    assert reply_language("What do you recommend with the beef?", "bn") == "en"


# ------------------------------------------------------------------ knowledge

def test_menu_index_resolves_refs_ids_and_names():
    ref = IDX.ref(ITEMS[3])
    assert IDX.resolve(ref)["id"] == "s2"
    assert IDX.resolve("s2")["name"] == "Chicken Corn Soup"
    assert IDX.resolve(None, "chicken corn soup")["id"] == "s2"
    assert IDX.resolve(None, "Chiken Corn Soup")["id"] == "s2"  # small typo
    assert IDX.resolve("i999", "pizza") is None


def test_hints_and_catalog():
    assert item_hints(ITEMS[2])["heat"] == "spicy"
    assert "nuts" in item_hints(ITEMS[5])["contains"]
    assert item_hints(ITEMS[4])["diet"] == "vegetarian"
    cat = render_catalog(IDX)
    assert "[Soup]" in cat and "Hot & Sour Soup — ৳320" in cat
    assert 'must pick 2' in cat and "Szu-Chuan Chicken" in cat
    assert "has: chicken, nuts" in cat


def test_vegetarian_hints_need_positive_evidence():
    def diet(name, cat="Other"):
        return item_hints({"name": name, "category": cat})["diet"]
    assert diet("Chinese Mixed Vegetable") == "likely vegetarian"
    assert diet("French Fry") == "likely vegetarian"
    assert diet("Special Cashew Nut Salad (regular)", "Salad") == ""        # "special" = mixed meats
    assert diet("Fried Won Thon", "Appetizer") == ""                         # wontons usually have filling
    assert diet("Thai Mixed Vegetable with Oyster Sauce") == ""
    assert diet("Egg Fried Rice") == ""
    assert diet("Special Corn Soup", "Soup") == ""


def test_find_mentions_ignores_near_twins_of_exact_hits():
    idx = MenuIndex([{"id": "a1", "name": "Set Menu A-01", "price": 295}, {"id": "a2", "name": "Set Menu A-02", "price": 350}])
    assert [i["name"] for i in find_mentions("I'd go for the Set Menu A-01 tonight", idx)] == ["Set Menu A-01"]
    assert [i["name"] for i in find_mentions("Set Menu A-01 and Set Menu A-02", idx)] == ["Set Menu A-01", "Set Menu A-02"] or \
        sorted(i["name"] for i in find_mentions("Set Menu A-01 and Set Menu A-02", idx)) == ["Set Menu A-01", "Set Menu A-02"]


def test_find_mentions_prefers_specific_names():
    names = [i["name"] for i in find_mentions("one special spring roll please", IDX)]
    assert names == ["Special Spring Roll"]
    assert [i["name"] for i in find_mentions("is the hot & sour soup spicy", IDX)] == ["Hot & Sour Soup"]


def test_restaurant_facts_and_paging_honesty():
    txt = render_restaurant({"name": "Burger House", "address": "101/4 Crescent road", "menuNotes": ["All Food Are Exclusive of 5% VAT"]})
    assert "Crescent" in txt and "5% VAT" in txt and "NOT available" in txt and "not published" in txt


# ------------------------------------------------------------------ op validation

def test_validate_ops_guards_the_cart():
    orderable = {IDX.item_id(i): i.get("available") is not False for i in IDX.items}
    cart = {"a1": 1}
    ops, problems = brain._validate_ops(
        [
            {"op": "set", "item": IDX.ref(ITEMS[0]), "quantity": 3},              # 1 → 3
            {"op": "add", "item": "pizza", "quantity": 1},                        # not on menu
            {"op": "add", "item": IDX.ref(ITEMS[6]), "quantity": 1},              # sold out
            {"op": "add", "item": IDX.ref(ITEMS[7]), "quantity": 1},              # needs curry choices
            {"op": "remove", "item": IDX.ref(ITEMS[3])},                          # not in cart → no-op
            {"op": "add", "item": "Chicken Corn Soup", "quantity": "২টা"},         # Bangla qty
        ],
        IDX, dict(cart), orderable,
    )
    assert [(o["op"], o["itemId"], o.get("quantity")) for o in ops] == [("set", "a1", 3), ("add", "s2", 2)]
    assert len(problems) == 3

    ops, problems = brain._validate_ops(
        [{"op": "add", "item": IDX.ref(ITEMS[7]), "quantity": 1, "choices": ["beef chili onion", "Szu-Chuan Chicken", "Pizza"]}],
        IDX, {}, orderable,
    )
    assert ops[0]["choices"] == ["Beef Chili Onion", "Szu-Chuan Chicken"] and not problems


def test_cart_change_reply_states_the_truth():
    ops = [{"op": "add", "itemId": "s2", "name": "Chicken Corn Soup", "quantity": 2}]
    text = brain._cart_change_reply(ops, False, IDX, {"s2": 2}, "en", {"menuNotes": ["All Food Are Exclusive of 5% VAT"]})
    # short, like a waiter: what changed + "anything else?" — the tray and its total are on screen, and the full
    # read-back (with VAT) comes once, at confirmation
    assert text == "Added 2 × Chicken Corn Soup. Anything else, or shall I confirm your order?", text
    bn = brain._cart_change_reply(ops, False, IDX, {"s2": 2}, "bn", None)
    assert bn == "2টা Chicken Corn Soup যোগ করলাম। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?", bn


def test_price_slips_flag_misquoted_prices_only():
    assert brain._price_slips("স্প্রিং রোলের দাম ৳২৩৫।", IDX, [], 0) == [235]
    assert brain._price_slips("Spring Roll is 235 taka", IDX, [], 0) == [235]
    assert brain._price_slips("Spring Roll is ৳230, two are ৳460.", IDX, [], 0) == []
    assert brain._price_slips("Together that's about ৳1,170 for four.", IDX, [], 0) == []  # a total, not a slip


def test_meal_kinds_from_periods_and_clock():
    from waiter_knowledge import meal_kinds
    assert meal_kinds(["Lunch"], 13) == ["lunch"]
    assert meal_kinds(["Dinner", "Late night"], 22) == ["dinner", "late"]
    assert meal_kinds([], 8) == ["breakfast"]
    assert meal_kinds([], 23) == ["late"]


def test_recommendation_pool_respects_time_and_availability():
    from waiter_knowledge import explicitly_asked, recommendation_pool, time_fit
    menu = ITEMS + [
        {"id": "z1", "name": "Beef Sizzling", "price": 450, "category": "Sizzling"},
        {"id": "z2", "name": "Fried Whole Red Snapper with Hot Sauce", "price": 2500, "category": "Whole Fish Selection"},
        {"id": "z3", "name": "Thai Fried Rice Chicken", "price": 300, "category": "Rice & Noodles Selection"},
    ]
    idx = MenuIndex(menu)
    orderable = {idx.item_id(i): i.get("available") is not False for i in idx.items}

    pool, suited, unsuited = recommendation_pool(idx, orderable, ["breakfast"])
    assert "z1" in unsuited and "z2" in unsuited          # heavy dishes don't suit breakfast
    assert "x1" not in suited and "x1" not in unsuited     # sold out: never recommendable
    assert pool[0]["category"] in ("Soup", "Appetizer")    # light things first in the morning

    _, suited_dinner, unsuited_dinner = recommendation_pool(idx, orderable, ["dinner"])
    assert "z1" in suited_dinner and not unsuited_dinner
    assert time_fit(idx.by_id["z3"], ["lunch"])[1] > time_fit(idx.by_id["a1"], ["lunch"])[1]  # rice > spring roll at lunch
    assert "z2" in recommendation_pool(idx, orderable, ["late"])[2]  # no whole fish at midnight

    assert explicitly_asked(idx.by_id["z1"], "can you recommend a sizzler?")
    assert not explicitly_asked(idx.by_id["z1"], "what do you recommend?")


def test_signature_ranks_first_but_never_overrides_time_or_availability():
    from waiter_knowledge import recommendation_pool, render_catalog
    menu = [dict(i) for i in ITEMS] + [
        {"id": "z1", "name": "Beef Sizzling", "price": 450, "category": "Sizzling", "signature": True},
        {"id": "z3", "name": "Thai Fried Rice Chicken", "price": 300, "category": "Rice & Noodles Selection"},
    ]
    for it in menu:
        if it["id"] == "a1":
            it["signature"] = True  # Spring Roll starred
        if it["id"] == "x1":
            it["signature"] = True  # starred but sold out
    idx = MenuIndex(menu)
    orderable = {idx.item_id(i): i.get("available") is not False for i in idx.items}

    dinner, _, _ = recommendation_pool(idx, orderable, ["dinner"])
    assert dinner[0]["name"] == "Beef Sizzling"                  # star + suits dinner → first
    breakfast, _, unsuited = recommendation_pool(idx, orderable, ["breakfast"])
    assert "z1" in unsuited and all(p["id"] != "z1" for p in breakfast)  # star doesn't beat time
    assert all(p["id"] != "x1" for p in dinner + breakfast)       # star doesn't beat sold out
    assert "SIGNATURE" in render_catalog(idx)


def test_reco_fallback_uses_pool_or_explains_closure():
    pool = [ITEMS[3], ITEMS[0]]
    assert brain._reco_fallback(pool, "en", {"mealPeriod": "Lunch (12pm–3pm)"}) == (
        "Right now for lunch, I'd suggest Chicken Corn Soup or Spring Roll. Would you like to order?"  # prices are on the cards
    )
    closed = {"unavailableNow": [{"name": "x", "reason": "We're closed right now — we open at 11am."}]}
    assert brain._reco_fallback([], "en", closed) == "We're closed right now — we open at 11am."


def test_false_unavailability_is_challenged():
    # an available dish claimed "not available" makes the brain re-ask the model (offline: fake model)
    calls = []

    async def fake_model(messages):
        calls.append(messages)
        if len(calls) == 1:
            return json.dumps({**EMPTY_TURN, "replyText": "Chicken Corn Soup is not available right now."})
        return json.dumps({**EMPTY_TURN, "replyText": "Chicken Corn Soup is ৳300 — added?"})

    orig = brain._call_openai
    brain._call_openai = fake_model
    try:
        out = asyncio.run(brain.generate_reply("Chicken Corn Soup?", menu_snapshot={"items": ITEMS}))
    finally:
        brain._call_openai = orig
    assert len(calls) == 2 and "IS available" in calls[1][-1]["content"]
    assert out["replyText"] == "Chicken Corn Soup is ৳300 — added?"

    # "X is sold out, but try Y" must not implicate Y
    calls.clear()

    async def fine_model(messages):
        calls.append(messages)
        return json.dumps({**EMPTY_TURN, "replyText": "Sold Out Prawn is sold out, but try the Chicken Corn Soup."})

    brain._call_openai = fine_model
    try:
        asyncio.run(brain.generate_reply("prawn?", menu_snapshot={"items": ITEMS}))
    finally:
        brain._call_openai = orig
    assert len(calls) == 1


def test_budget_detection():
    for t in ["our budget is 1200 taka", "something under 500", "৫০০ টাকার মধ্যে কি পাব?", "বাজেট ১০০০"]:
        assert brain._BUDGET.search(t), t
    for t in ["2 spring rolls please", "how much is the soup?"]:
        assert not brain._BUDGET.search(t), t
    # echoing the guest's own budget doesn't count as stating a total
    assert brain._new_amounts("With ৳1200 you can get plenty!", "budget is 1200 taka") == []
    assert brain._new_amounts("That's ৳1020, within your ৳1200.", "budget is 1200 taka") == [1020]


def test_confirm_fast_path_without_model():
    history = [{"role": "assistant", "content": "Your order: 1 × Spring Roll — ৳230. Anything else, or shall I confirm your order?"}]
    ctx = {"cartItems": [{"itemId": "a1", "quantity": 1}], "table": "12"}
    # yes to "anything else, or shall I confirm?" → a short check, no prices (nothing placed yet)
    out = asyncio.run(brain.generate_reply("yes please", menu_snapshot={"items": ITEMS}, history=history, context=dict(ctx)))
    assert out["meta"]["decision"].get("showCheckout") is True and not out["meta"]["decision"].get("placeOrder")
    assert out["replyText"] == "1 × Spring Roll — shall I place the order?"
    assert out["meta"]["checkout"]["stage"] == "readback"
    # yes to the read-back → place (the server does the actual placing)
    history2 = history + [{"role": "user", "content": "yes please"}, {"role": "assistant", "content": out["replyText"]}]
    out2 = asyncio.run(brain.generate_reply("yes", menu_snapshot={"items": ITEMS}, history=history2, context=dict(ctx),
                                            dialog_state={"checkout": out["meta"]["checkout"]}))
    assert out2["meta"]["decision"].get("placeOrder") is True
    assert out2["meta"]["orderDraft"]["items"] == [{"itemId": "a1", "qty": 1}] and out2["meta"]["orderDraft"]["table"] == "12"
    # no table known → ask for it first
    out3 = asyncio.run(brain.generate_reply("yes please", menu_snapshot={"items": ITEMS}, history=history,
                                            context={"cartItems": [{"itemId": "a1", "quantity": 1}]}))
    assert out3["meta"]["decision"].get("askTable") and out3["meta"]["checkout"]["stage"] == "table"

    # a question after the confirm prompt is NOT a confirmation (goes to the model; offline → fallback, no cart change)
    brain.OPENAI_API_KEY = ""
    out = asyncio.run(
        brain.generate_reply("you have any desserts?", menu_snapshot={"items": ITEMS}, history=history,
                             context={"cartItems": [{"itemId": "a1", "quantity": 1}]})
    )
    assert not out["meta"]["decision"].get("showCheckout") and not out["meta"]["decision"].get("placeOrder")
    assert out["meta"]["cartOps"] == [] and out["meta"]["items"] == []


def test_offline_fallback_never_touches_cart():
    brain.OPENAI_API_KEY = ""
    out = asyncio.run(brain.generate_reply("How much is the Spring Roll?", menu_snapshot={"items": ITEMS}))
    assert out["meta"]["intent"] == "menu" and out["meta"]["cartOps"] == []
    assert "230" in out["replyText"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
