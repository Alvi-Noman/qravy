"""Recommendation engine + policy tests (offline) — run: python tests/test_recommender.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from recommender import (  # noqa: E402
    GuestProfile,
    OrderStats,
    RecoState,
    build_plan,
    complements,
    decide_mode,
    extract_prefs,
    rank,
    violations,
)
from waiter_knowledge import MenuIndex  # noqa: E402

CURRY_OPTS = [{"id": f"o{i}", "name": n, "price": 0} for i, n in enumerate(["Beef Hot Sauce", "Szu-Chuan Chicken", "Szu-Chian Shrimp"])]
MENU = [
    {"id": "sp", "name": "Spring Roll", "price": 230, "category": "Appetizer"},
    {"id": "wt", "name": "Fried Won Thon", "price": 230, "category": "Appetizer"},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "cs", "name": "Chicken Corn Soup", "price": 300, "category": "Soup"},
    {"id": "hs", "name": "Hot & Sour Soup", "price": 320, "category": "Soup", "tags": ["Spicy"]},
    {"id": "ns", "name": "Special Cashew Nut Salad (regular)", "price": 420, "category": "Salad"},
    {"id": "vs", "name": "Vegetable Sizzling", "price": 320, "category": "Sizzling", "tags": ["Vegetarian"]},
    {"id": "bs", "name": "Beef Sizzling", "price": 450, "category": "Sizzling"},
    {"id": "mc", "name": "Mongolian Chicken", "price": 350, "category": "Chicken Selection"},
    {"id": "sc", "name": "Szu-Chuan Chicken", "price": 350, "category": "Chicken Selection"},
    {"id": "cc", "name": "Chicken with Cashew nut", "price": 350, "category": "Chicken Selection"},
    {"id": "rc", "name": "Beef with Red Curry", "price": 380, "category": "Beef Selection"},
    {"id": "pr", "name": "Hot Sauce Prawn", "price": 380, "category": "Prawn Selection"},
    {"id": "cm", "name": "Chinese Mixed Vegetable", "price": 260, "category": "Vegetable Selection"},
    {"id": "er", "name": "Egg Fried Rice", "price": 270, "category": "Rice & Noodles Selection"},
    {"id": "vr", "name": "Thai Vegetable Fried Rice", "price": 290, "category": "Rice & Noodles Selection"},
    {"id": "sm", "name": "Set Menu A-02", "price": 350, "category": "Set Menu",
     "description": "Thai Soup, Thai Fried Chicken, Chicken Chili Onion, Mixed Vegetable, Egg Fried Rice"},
    {"id": "c2", "name": "Choice of 2 Curry with Fried Rice & Vegetable", "price": 320, "category": "Choice of Curry",
     "modifierGroups": [{"id": "g", "name": "Choose 2 Curries", "min": 2, "max": 2, "options": CURRY_OPTS}]},
    {"id": "wf", "name": "Fried Whole Red Snapper with Hot Sauce", "price": 2500, "category": "Whole Fish Selection"},
    {"id": "sd", "name": "Choice of Soft Drinks (Served in a glass)", "price": 35, "category": "Beverage Selection"},
    {"id": "wa", "name": "Mineral Water (small)", "price": 15, "category": "Beverage Selection"},
    {"id": "so", "name": "Sold Out Prawn", "price": 380, "category": "Prawn Selection", "available": False},
]
IDX = MenuIndex(MENU)
ORDERABLE = {IDX.item_id(i): i.get("available") is not False for i in IDX.items}
by = {i["id"]: i for i in MENU}


def ids(picks):
    return [p.item["id"] for p in picks]


# ------------------------------------------------------------------ reading the guest

def test_extract_prefs():
    p = extract_prefs("we are 3 people, one is vegetarian, budget 1200 taka")
    assert (p.party_size, p.vegetarians_in_party, p.budget, p.diet) == (3, 1, 1200, [])
    assert extract_prefs("I'm allergic to nuts").allergies == ["nuts"]
    assert extract_prefs("আমার চিংড়িতে এলার্জি আছে").allergies == ["shellfish"]
    assert extract_prefs("I don't eat beef").diet == ["no_beef"]
    assert extract_prefs("nothing spicy please, it's for my kids").spice == "mild"
    assert extract_prefs("nothing spicy please, it's for my kids").kids is True
    assert extract_prefs("I love spicy food").spice == "hot"
    assert extract_prefs("আমরা ৪ জন, বাজেট ২০০০ টাকা").party_size == 4
    assert extract_prefs("something light").mood == ["light"]
    for q in ["Is the soup spicy?", "Does the pakora have gluten?", "2 beef sizzling please"]:
        p = extract_prefs(q)
        assert not (p.allergies or p.diet or p.spice or p.avoid), q


# ------------------------------------------------------------------ hard filters

def test_violations_are_conservative_where_safety_matters():
    veg = GuestProfile(diet=["vegetarian"])
    assert violations(by["c2"], veg)                      # vegetable in the name, but only meat curries to choose
    assert not violations(by["vs"], veg)
    assert violations(by["wt"], veg)                      # wontons usually have filling
    nuts = GuestProfile(allergies=["nuts"])
    assert violations(by["ns"], nuts) and violations(by["cc"], nuts) and not violations(by["mc"], nuts)
    shell = GuestProfile(allergies=["shellfish"])
    assert violations(by["pr"], shell) and violations(by["wt"], shell)
    assert violations(by["rc"], GuestProfile(diet=["no_beef"]))
    assert violations(by["hs"], GuestProfile(spice="mild"))
    assert violations(by["mc"], GuestProfile(declined=["mc"]))
    assert violations(by["wf"], GuestProfile(budget=800))


# ------------------------------------------------------------------ ranking

def test_rank_filters_diversifies_and_explains():
    picks, blocked = rank(IDX, ORDERABLE, ["dinner"], GuestProfile(allergies=["nuts"]))
    assert "so" in blocked and "ns" in blocked and "cc" in blocked
    assert not {"ns", "cc", "so"} & set(ids(picks))
    top3_cats = [p.item["category"] for p in picks[:3]]
    assert len(set(top3_cats)) == 3                       # variety, not three sizzlers
    assert all(p.reasons for p in picks[:3])              # every pick can be explained


def test_signature_and_time_and_whole_fish_rules():
    menu = [dict(i, signature=(i["id"] == "mc")) for i in MENU]
    idx = MenuIndex(menu)
    picks, _ = rank(idx, ORDERABLE, ["dinner"], GuestProfile())
    assert ids(picks)[0] == "mc" and "our signature" in picks[0].reasons
    breakfast, blocked = rank(idx, ORDERABLE, ["breakfast"], GuestProfile())
    assert "bs" in blocked and "doesn't suit this time" in blocked["bs"]
    asked, _ = rank(idx, ORDERABLE, ["breakfast"], GuestProfile(), asked_for={"bs"})
    assert "bs" in ids(asked)                              # explicitly asked → allowed at breakfast
    solo, _ = rank(IDX, ORDERABLE, ["dinner"], GuestProfile())
    group, _ = rank(IDX, ORDERABLE, ["dinner"], GuestProfile(party_size=4))
    assert ids(solo).index("wf") > ids(group).index("wf") if "wf" in ids(solo) else True


def test_party_with_a_vegetarian_gets_a_veg_dish_and_a_checked_plan():
    prof = GuestProfile(party_size=3, vegetarians_in_party=1, budget=1200)
    picks, _ = rank(IDX, ORDERABLE, ["dinner"], prof)
    assert any(p.item["id"] in ("vs", "cm", "vr") for p in picks[:3])
    plan = build_plan(picks, prof)
    assert plan and plan["fits"] and plan["total"] <= 1200
    assert sum(l["price"] * l["qty"] for l in plan["lines"]) == plan["total"]
    names = [l["name"] for l in plan["lines"]]
    assert any(n in ("Vegetable Sizzling", "Chinese Mixed Vegetable") for n in names)
    assert len(names) == len(set(names))                   # varied dishes, not 3 of one


def test_meal_plans_are_complete_varied_and_sensible():
    def plan_for(prof, kinds=("dinner",)):
        picks, blocked = rank(IDX, ORDERABLE, list(kinds), prof, limit=max(8, prof.party_size + 5))
        return build_plan(picks, prof, IDX, blocked)

    fam = plan_for(GuestProfile(party_size=4, kids=True, spice="mild"))
    names = {l["name"]: l["qty"] for l in fam["lines"]}
    assert "Fried Whole Red Snapper with Hot Sauce" not in names       # no ৳2500 splurge nobody asked for
    assert all(q == 1 for n, q in names.items() if "Rice" not in n)    # varied, no repeats
    assert fam["complete"]
    # rice is a side, never counted as someone's main, and comes one per two plain mains
    plain = sum(l["qty"] for l in fam["lines"] if l["name"] in ("Mongolian Chicken", "Beef with Red Curry", "Chinese Mixed Vegetable"))
    rice = sum(l["qty"] for l in fam["lines"] if "Fried Rice" in l["name"])
    assert rice <= max(1, -(-plain // 2)) + 0 or plain == 0
    # tight budget: two complete meals beat two curries with no rice
    duo = plan_for(GuestProfile(party_size=2, budget=700), ("lunch",))
    assert duo["complete"] and duo["fits"] and duo["total"] <= 700
    # sharing dish only when it makes sense
    big = plan_for(GuestProfile(party_size=4, budget=5000, mood=["sharing"]))
    assert big["fits"]
    assert sum(l["price"] * l["qty"] for l in big["lines"]) == big["total"]


def test_missing_kinds_on_this_menu():
    from waiter_knowledge import missing_kinds
    assert missing_kinds("you have any desserts?", IDX) == ["desserts"]
    assert missing_kinds("মিষ্টি কিছু আছে?", IDX) == ["desserts"]
    assert missing_kinds("do you have coffee or pizza?", IDX) == ["coffee", "pizza"]
    assert missing_kinds("is the soup spicy?", IDX) == []
    sweet = MenuIndex(MENU + [{"id": "ic", "name": "Vanilla Ice Cream", "price": 120, "category": "Dessert"}])
    assert missing_kinds("any dessert?", sweet) == []


def test_novelty_and_kids():
    first, _ = rank(IDX, ORDERABLE, ["lunch"], GuestProfile())
    again, _ = rank(IDX, ORDERABLE, ["lunch"], GuestProfile(), recent=ids(first)[:2])
    assert ids(again)[:2] != ids(first)[:2]
    kids, _ = rank(IDX, ORDERABLE, ["lunch"], GuestProfile(kids=True, spice="mild"))
    assert "kid-friendly" in kids[0].reasons and "hs" not in ids(kids)


def test_spice_lovers_get_spicy_and_kids_get_mild():
    hot, _ = rank(IDX, ORDERABLE, ["dinner"], GuestProfile(spice="hot"))
    assert all(p.item["id"] in ("sc", "hs", "pr", "rc", "wf") for p in hot[:3]), ids(hot)[:3]
    kids, blocked = rank(IDX, ORDERABLE, ["lunch"], GuestProfile(kids=True))
    assert "rc" in blocked and "spicy for kids" in blocked["rc"]
    assert "sc" in blocked and "hs" in blocked


def test_total_checker_and_cheaper_ceiling():
    # the live bug: five dishes that add up to ৳3605, stated as ৳4145
    menu = MENU + [{"id": "sa", "name": "Set Menu A-01", "price": 295, "category": "Set Menu"},
                   {"id": "wl", "name": "Fried Whole Red Snapper with Lemon Sauce", "price": 2500, "category": "Whole Fish Selection"},
                   {"id": "ss", "name": "Sweet & Sour Prawn", "price": 380, "category": "Prawn Selection"}]
    idx = MenuIndex(menu)
    bad = ("Set Menu A-01, Fried Whole Red Snapper with Lemon Sauce, এবং Egg Fried Rice। সাথে French Fry আর "
           "Sweet & Sour Prawn নিলে আরও মজা হবে। মোট খরচ হবে ৳4145।")
    assert brain._total_slip(bad, idx) == (4145, 3605)
    assert brain._total_slip(bad.replace("4145", "3605"), idx) is None
    assert brain._total_slip("2 × Set Menu A-02 and a Vegetable Sizzling — ৳1020 in total.", IDX) is None
    assert brain._total_slip("Two Set Menu A-02 come to ৳700 altogether", IDX) is None
    assert brain._total_slip("That's ৳735 in total with VAT for 2 × Set Menu A-02", IDX, vat_pct=5) is None
    # "something cheaper" → only dishes below the cheapest one just suggested
    picks, blocked = rank(IDX, ORDERABLE, ["lunch"], GuestProfile(max_price=299))
    assert all(float(p.item["price"]) <= 299 for p in picks) and "not cheaper than before" in blocked["mc"]


def test_prices_and_popularity_guards():
    assert brain._western_prices("দাম ৳২৫০০ এবং ৳৩০০") == "দাম ৳2500 এবং ৳300"
    assert brain._POPULARITY_CLAIM.search("it's very popular")
    assert not brain._POPULARITY_CLAIM.search("it's a mild dish")
    assert brain._GROUPISH.search("What should we order?") and not brain._GROUPISH.search("What should I order?")


# ------------------------------------------------------------------ completing the order

def test_complements_and_order_history():
    picks, blocked = rank(IDX, ORDERABLE, ["dinner"], GuestProfile())
    comp = [c[0]["id"] for c in complements(IDX, picks, ["rc"], blocked=blocked)]
    assert comp[0] in ("er", "vr") and "sd" in comp          # rice for the curry, then a drink
    assert not any(by[c]["category"] == "Rice & Noodles Selection" for c in
                   [x[0]["id"] for x in complements(IDX, picks, ["sm"], blocked=blocked)])  # set menu has rice
    # real orders: people who order the curry take the vegetable rice → learned
    stats = OrderStats.from_orders([{"items": [{"itemId": "rc"}, {"itemId": "vr"}]}] * 5 + [{"items": [{"itemId": "er"}]}])
    comp2 = complements(IDX, picks, ["rc"], stats, blocked=blocked)
    assert comp2[0][0]["id"] == "vr"
    assert stats.pop_score("vr") > stats.pop_score("mc")


# ------------------------------------------------------------------ WHEN to recommend

def _mode(text, **kw):
    base = dict(state=RecoState(turn=3), cart_ids=[], mentioned_ids=[], has_drinks=True, has_signature=True,
                cart_has_drink=False, done_ordering=False, confirming=False)
    base.update(kw)
    return decide_mode(text, **base)[0]


def test_decide_mode_policy():
    assert _mode("what do you recommend?") == "full"
    assert _mode("কি খাওয়া যায়?") == "full"
    assert _mode("I'm starving") == "full"
    assert _mode("Is the soup spicy?", mentioned_ids=["hs"]) == "answer"
    assert _mode("2 spring rolls please", mentioned_ids=["sp"]) == "complement"
    assert _mode("2 spring rolls please", mentioned_ids=["sp"], state=RecoState(turn=3, last_upsell_turn=2)) == "answer"
    assert _mode("no thanks", state=RecoState(turn=3, last_offered=["sd"], last_offer_turn=3)) == "quiet"
    assert _mode("no, something else", state=RecoState(turn=3, last_offered=["mc"], last_offer_turn=3)) == "full"
    assert _mode("hmm, something cheaper?", state=RecoState(turn=3, last_offered=["mc"], last_offer_turn=3)) == "full"
    assert _mode("2 spring rolls", mentioned_ids=["sp"], state=RecoState(turn=4, declined_turn=3)) == "answer"
    assert _mode("that's all", cart_ids=["rc"], done_ordering=True) == "last_call"
    assert _mode("that's all", cart_ids=["rc"], done_ordering=True, state=RecoState(turn=3, drink_offered=True)) == "quiet"
    assert _mode("that's all", cart_ids=["rc"], done_ordering=True, cart_has_drink=True) == "quiet"
    assert _mode("can I get the bill?") == "quiet"
    assert _mode("my food is taking too long") == "quiet"
    assert _mode("hi there", state=RecoState(turn=0)) == "greet"


# ------------------------------------------------------------------ brain integration (fake model)

TURN = {"topic": "recommendation", "intent": "suggestions", "language": "en", "mentionedItems": [], "cartOps": [],
        "clearCart": False, "confirmOrder": False, "serviceRequest": None, "suggestions": [], "voiceReplyText": "",
        "guestPrefs": {"diet": [], "allergies": [], "avoid": [], "spice": "", "budget": 0, "partySize": 0,
                       "vegetariansInParty": 0, "kids": False, "mood": [], "declined": [], "liked": []}}


def _run(text, replies, **kw):
    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps(replies[min(len(calls), len(replies)) - 1])

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply(text, menu_snapshot={"items": MENU}, context={"mealKinds": ["dinner"]}, **kw))
    finally:
        brain._call_openai = orig
    return out, calls


def test_prompt_carries_profile_mode_and_filtered_picks():
    out, calls = _run("I'm allergic to nuts. What do you recommend?",
                      [{**TURN, "replyText": "Try the Mongolian Chicken — mild and savoury.", "suggestions": [{"item": IDX.ref(by["mc"]), "reason": "mild"}]}])
    turn = calls[0][-1]["content"]
    assert "ALLERGIES: nuts" in turn and "RECOMMENDATION MODE: FULL" in turn
    assert "Cashew" not in turn.split("RANKED PICKS")[1]
    assert out["meta"]["recoMode"] == "full" and out["meta"]["intent"] in ("suggestions", "menu")
    # memory: next turn still knows about the allergy
    state = {"reco": out["meta"]["reco"]}
    _, calls2 = _run("what else?", [{**TURN, "replyText": "The Beef Sizzling is a hearty pick."}], dialog_state=state)
    assert "ALLERGIES: nuts" in calls2[0][-1]["content"]


def test_unsafe_recommendation_is_retried_then_replaced():
    bad = {**TURN, "replyText": "You'll love our Chicken with Cashew nut!"}
    out, calls = _run("I'm allergic to nuts, recommend something", [bad, bad])
    assert len(calls) == 2 and "isn't right for this guest" in calls[1][-1]["content"]
    assert "Cashew" not in out["replyText"]                    # deterministic safe recommendation
    assert all("ashew" not in s["title"] for s in out["meta"]["suggestions"])


def test_quiet_mode_strips_suggestions_and_decline_is_remembered():
    state = {"reco": RecoState(turn=2, last_offered=["sd"], last_offer_turn=2).to_dict()}
    out, calls = _run("no thanks", [{**TURN, "topic": "other", "intent": "chitchat", "replyText": "No problem!",
                                     "suggestions": [{"item": IDX.ref(by["sd"]), "reason": ""}]}], dialog_state=state)
    assert "RECOMMENDATION MODE: QUIET" in calls[0][-1]["content"]
    assert out["meta"]["suggestions"] == [] and out["meta"]["upsell"] == []
    assert "sd" in out["meta"]["reco"]["profile"]["declined"]


def test_complement_mode_offers_one_pairing_in_the_tray():
    add = {**TURN, "topic": "order_change", "intent": "order", "replyText": "Added 1 × Beef with Red Curry.",
           "cartOps": [{"op": "add", "item": IDX.ref(by["rc"]), "quantity": 1, "note": "", "choices": []}]}
    out, calls = _run("one beef with red curry please", [add])
    assert "RECOMMENDATION MODE: COMPLEMENT" in calls[0][-1]["content"] and "PAIRING" in calls[0][-1]["content"]
    assert len(out["meta"]["upsell"]) == 1 and out["meta"]["decision"]["showUpsellTray"]
    assert out["meta"]["reco"]["last_upsell_turn"] == out["meta"]["reco"]["turn"]


def test_ordinals_group_question_and_single_drink_offer():
    # "the first one" is resolved against what we actually said last turn
    state = {"reco": RecoState(turn=1, last_offered=["bs", "c2", "sm"], last_offer_turn=1).to_dict()}
    _, calls = _run("I'll take the first one", [{**TURN, "replyText": "Beef Sizzling added."}], dialog_state=state)
    assert "YOU JUST SUGGESTED" in calls[0][-1]["content"] and "1. " + IDX.ref(by["bs"]) in calls[0][-1]["content"]
    # a group without a head-count → recommend, then ask how many
    _, calls = _run("What should we order?", [{**TURN, "replyText": "Try the Beef Sizzling. How many of you are eating?"}])
    assert "How many of you are eating?" in calls[0][-1]["content"]
    # a drink offered with the food → no second drink offer at "that's all"
    add = {**TURN, "topic": "order_change", "intent": "order", "replyText": "Added 1 × Beef Sizzling.",
           "cartOps": [{"op": "add", "item": IDX.ref(by["bs"]), "quantity": 1, "note": "", "choices": []}]}
    out, _ = _run("one beef sizzling", [add])
    if out["meta"]["upsell"] and "Drink" in out["meta"]["upsell"][0]["title"]:
        assert out["meta"]["reco"]["drink_offered"] is True
        s2 = RecoState.from_dict(out["meta"]["reco"])
        assert decide_mode("that's all", state=s2, cart_ids=["bs"], mentioned_ids=[], has_drinks=True, has_signature=False,
                           cart_has_drink=False, done_ordering=True, confirming=False)[0] == "quiet"


def test_lookalike_dish_is_retargeted_to_what_the_guest_said():
    menu = MENU + [{"id": "cr", "name": "Chicken with Red Curry", "price": 350, "category": "Chicken Selection"}]
    idx = MenuIndex(menu)
    wrong = {**TURN, "topic": "order_change", "intent": "order", "replyText": "One Chicken with Red Curry added.",
             "cartOps": [{"op": "add", "item": idx.ref(next(i for i in menu if i["id"] == "cr")), "quantity": 1, "note": "", "choices": []}]}

    async def fake(messages):
        return json.dumps(wrong)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply("One Beef with Red Curry please", menu_snapshot={"items": menu},
                                               context={"mealKinds": ["dinner"]}))
    finally:
        brain._call_openai = orig
    assert [o["itemId"] for o in out["meta"]["cartOps"]] == ["rc"]
    assert "Beef with Red Curry" in out["replyText"] and "Chicken with Red Curry" not in out["replyText"]


def test_table_plan_needs_its_total_and_missing_dessert_is_flagged():
    import re as _re
    calls = []

    async def fake(messages):  # a waiter that presents the plan's dishes but forgets the total
        calls.append(messages)
        plan_line = next(l for l in messages[-1]["content"].splitlines() if l.startswith("MEAL PLAN"))
        dishes = _re.findall(r"\d+ × ([^(]+?) \(", plan_line)
        return json.dumps({**TURN, "replyText": "For the four of you: " + ", ".join(dishes) + "."})

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        # no money talk → no total is forced (prices are on the cards)
        asyncio.run(brain.generate_reply("We are 4, what should we order?", menu_snapshot={"items": MENU},
                                         context={"mealKinds": ["dinner"]}))
        assert len(calls) == 1
        # a budget → the plan must come with its total
        calls.clear()
        asyncio.run(brain.generate_reply("We are 4, our budget is 2000 taka, what should we order?",
                                         menu_snapshot={"items": MENU}, context={"mealKinds": ["dinner"]}))
    finally:
        brain._call_openai = orig
    assert len(calls) == 2 and "without its total" in calls[1][-1]["content"]
    _, calls = _run("you have any desserts?", [{**TURN, "topic": "availability", "intent": "menu", "replyText": "No desserts, sorry!"}])
    assert "NOT ON THIS MENU: desserts" in calls[0][-1]["content"]


def test_sizes_are_asked_for_then_priced_correctly():
    kacchi = {"id": "kb", "name": "Kacchi Biryani", "price": 450, "category": "Biryani",
              "variations": [{"name": "Half", "price": 450}, {"name": "Full", "price": 850}]}
    menu = MENU + [kacchi]
    idx = MenuIndex(menu)
    ref = idx.ref(kacchi)
    ops, problems = brain._validate_ops([{"op": "add", "item": ref, "quantity": 1, "variant": ""}], idx, {}, {})
    assert not ops and "needs a size/option first" in problems[0]         # no size → ask, don't guess
    ops, _ = brain._validate_ops([{"op": "add", "item": ref, "quantity": 2, "variant": "full"}], idx, {}, {})
    assert ops[0]["variant"] == "Full" and ops[0]["price"] == 850
    reply = brain._cart_change_reply(ops, False, idx, {"kb": 2}, "en", None, {"kb": 850.0}, {"kb": "Full"})
    assert "2 × Kacchi Biryani (Full)" in reply and "৳1700" in reply      # the Full price, not the base price


def test_questions_guessed_sizes_and_guessed_choices_never_touch_the_cart():
    kacchi = {"id": "kb", "name": "Kacchi Biryani", "price": 420, "category": "Biryani",
              "variations": [{"name": "Half", "price": 420}, {"name": "Full", "price": 780}]}
    thali = {"id": "th", "name": "Lunch Thali", "price": 350, "category": "Thali",
             "modifierGroups": [{"id": "g", "name": "Choose your curry", "min": 1, "max": 1, "options": [
                 {"id": "a", "name": "Chicken", "price": 0}, {"id": "b", "name": "Fish", "price": 50}]}]}
    idx = MenuIndex(MENU + [kacchi, thali])
    add = lambda item, **kw: [{"op": "add", "item": idx.ref(item), "quantity": 1, **kw}]  # noqa: E731
    # a question is not an order
    ops, probs = brain._validate_ops(add(by["cm"]), idx, {}, {}, "We are 3, all vegetarian. What can we eat?")
    assert not ops and "question, not for an order" in probs[0]
    ops, _ = brain._validate_ops(add(by["cm"]), idx, {}, {}, "Can I have a Chinese Mixed Vegetable?")
    assert ops                                                            # phrased as an order → fine
    ops, probs = brain._validate_ops(add(by["cm"]), idx, {}, {}, "We are 5 people with 2500 taka. What should we order?")
    assert not ops and "question, not for an order" in probs[0]          # "order" the word ≠ an order
    ops, _ = brain._validate_ops(add(by["cm"]), idx, {}, {}, "I'd like to order the Chinese Mixed Vegetable")
    assert ops
    # the model guessed "Half" — the guest never said a size
    ops, probs = brain._validate_ops(add(kacchi, variant="Half"), idx, {}, {}, "One kacchi please")
    assert not ops and "needs a size" in probs[0]
    ops, _ = brain._validate_ops(add(kacchi, variant="Full"), idx, {}, {}, "Full")
    assert ops[0]["variant"] == "Full" and ops[0]["price"] == 780
    ops, _ = brain._validate_ops(add(kacchi, variant="Half"), idx, {}, {}, "একটা হাফ কাচ্চি দিন")
    assert ops and ops[0]["variant"] == "Half"                          # Bangla size word counts
    # the model guessed the curry
    ops, probs = brain._validate_ops(add(thali, choices=["Chicken"]), idx, {}, {}, "I'll have the lunch thali")
    assert not ops and "needs its choices" in probs[0]
    ops, _ = brain._validate_ops(add(thali, choices=["Fish"]), idx, {}, {}, "Fish please")
    assert ops and ops[0]["choices"] == ["Fish"]
    # Bangla "please give" forms are orders, even with a question attached
    for bn in ["Mixed Vegetable Curry এক প্লেট দেবেন। মোট কত টাকা হবে?", "হ্যাঁ, আমি অর্ডার দিতে চাই।"]:
        assert not brain._is_question_not_order(bn), bn
    # a size said a turn ago still counts ("হাফ প্লেট দেবেন" … "হ্যাঁ, অর্ডার দিতে চাই")
    ops, _ = brain._validate_ops(add(kacchi, variant="Half"), idx, {}, {}, "হ্যাঁ, আমি অর্ডার দিতে চাই।",
                                 said="Kacchi Biryani এর হাফ প্লেট দেবেন। হ্যাঁ, আমি অর্ডার দিতে চাই।")
    assert ops and ops[0]["variant"] == "Half"
    # paid add-on: the line price includes it
    ops, _ = brain._validate_ops(add(thali, choices=["Fish"]), idx, {}, {}, "Fish please")
    assert ops[0]["price"] == 400
    text = brain._cart_change_reply(ops, False, idx, {"th": 1}, "en", None, {"th": 400.0}, {"th": "Fish"})
    assert "Lunch Thali (Fish) — ৳400" in text and "৳400" in text.split("Your order")[1]
    # if the model still claims it added something, a clear question replaces the reply
    q = brain._clarify_reply(["Kacchi Biryani needs a size/option first"], idx, "en")
    assert q == "Would you like the Kacchi Biryani Half (৳420) or Full (৳780)?"


def test_no_soup_for_dessert():
    soup = {**TURN, "topic": "availability", "intent": "menu",
            "replyText": "We don't have desserts. To finish your meal, try the Chicken Corn Soup at ৳300!"}
    out, calls = _run("you have any desserts?", [soup, soup])
    assert len(calls) == 2 and "which this menu doesn't have" in calls[1][-1]["content"]
    assert "Soup" not in out["replyText"] and out["replyText"].startswith("Sorry, we don't have desserts.")
    assert "odd_substitute_replaced" in out["meta"]["guards"]


def test_plan_uses_a_stated_size_for_sized_dishes():
    kacchi = {"id": "kb", "name": "Kacchi Biryani", "price": 420, "category": "Biryani",
              "variations": [{"name": "Half", "price": 420}, {"name": "Full", "price": 780}]}
    idx = MenuIndex(MENU + [kacchi])
    orderable = {idx.item_id(i): i.get("available") is not False for i in idx.items}
    prof = GuestProfile(party_size=3, budget=1500)
    picks, blocked = rank(idx, orderable, ["dinner"], prof, asked_for={"kb"})
    plan = build_plan(picks, prof, idx, blocked)
    line = next(l for l in plan["lines"] if l["name"] == "Kacchi Biryani")
    assert line["variant"] == "Half" and line["price"] == 420


def test_bugs_found_by_simulated_guests():
    from waiter_knowledge import is_explicit_confirm
    # "No, that's all. Please confirm…" IS a confirmation; "don't confirm yet" is not
    assert is_explicit_confirm("No, that's all. Please confirm my order for two Chicken Cashew Nut Salads.")
    assert not is_explicit_confirm("don't confirm yet")
    assert not is_explicit_confirm("কনফার্ম করব না")
    ctx = {"mealKinds": ["dinner"], "cartItems": [{"itemId": "rc", "quantity": 1}], "table": "7"}

    def run(text, obj):
        async def fake(messages):
            return json.dumps(obj)

        orig = brain._call_openai
        brain._call_openai = fake
        try:
            return asyncio.run(brain.generate_reply(text, menu_snapshot={"items": MENU}, context=dict(ctx)))
        finally:
            brain._call_openai = orig

    # 1) explicit confirm after "that's all" → the order is read back for the final yes
    out = run("No, that's all. Please confirm my order.", {**TURN, "topic": "confirm_order", "intent": "order",
                                                            "confirmOrder": True, "replyText": "Confirmed!"})
    assert out["meta"]["decision"].get("showCheckout") is True and out["meta"]["checkout"]["stage"] == "readback"
    assert "Confirmed!" not in out["replyText"] and "Shall I place it?" in out["replyText"]
    # 2) the model SAYS confirmed without a real confirmation → replaced with a question
    out = run("Is the Beef with Red Curry spicy?", {**TURN, "topic": "item_question", "intent": "menu",
                                                     "replyText": "It's mild. Your order is confirmed."})
    assert "confirmed" not in out["replyText"].lower() and "Shall I confirm" in out["replyText"]
    # 3) "suggest something cheaper instead" must not empty the cart
    out = run("That's over budget, suggest a smaller order instead",
              {**TURN, "clearCart": True, "replyText": "Try the Chicken Corn Soup."})
    assert out["meta"]["clearCart"] is False and "clear_blocked" in out["meta"]["guards"]
    # 4) adding while asking "shall I add these?" → the reply is replaced with the factual confirmation
    add = {**TURN, "topic": "order_change", "intent": "order",
           "cartOps": [{"op": "add", "item": IDX.ref(by["sc"]), "quantity": 1, "note": "", "choices": [], "variant": ""}],
           "replyText": "I suggest Szu-Chuan Chicken. Would you like me to add these to your order?"}
    out = run("Yes please add the Szu-Chuan Chicken", add)
    assert out["replyText"].startswith("Added 1 × Szu-Chuan Chicken")


def test_total_checker_understands_sizes_and_bangla_quantities():
    kacchi = {"id": "kb", "name": "Kacchi Biryani", "price": 420, "category": "Biryani",
              "variations": [{"name": "Half", "price": 420}, {"name": "Full", "price": 780}]}
    veg = {"id": "vc", "name": "Mixed Vegetable Curry", "price": 180, "category": "Curries"}
    idx = MenuIndex([kacchi, veg])
    live = "Mixed Vegetable Curry ৳180 এবং Full Kacchi Biryani তিনটি ৳2340 (৩ × ৳780) মিলিয়ে মোট ৳2520 হবে।"
    assert brain._total_slip(live, idx) is None                     # the live false alarm
    assert brain._total_slip(live.replace("2520", "2700"), idx) == (2700, 2520)
    assert brain._total_slip("1 Half Kacchi Biryani and 1 Mixed Vegetable Curry — ৳600 in total.", idx) is None


def test_add_and_confirm_in_one_breath():
    ctx = {"mealKinds": ["dinner"], "table": "4"}
    obj = {**TURN, "topic": "confirm_order", "intent": "order", "confirmOrder": True, "replyText": "Added and confirmed.",
           "cartOps": [{"op": "add", "item": IDX.ref(by["mc"]), "quantity": 2, "note": "", "choices": [], "variant": ""}]}

    async def fake(messages):
        return json.dumps(obj)

    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply("Two Mongolian Chicken please, and confirm the order",
                                               menu_snapshot={"items": MENU}, context=ctx))
    finally:
        brain._call_openai = orig
    # added AND read back in one reply — the order waits for the guest's yes
    assert out["meta"]["decision"].get("showCheckout") is True and not out["meta"]["decision"].get("placeOrder")
    assert out["meta"]["cartOps"][0]["quantity"] == 2
    assert out["replyText"].startswith("Added 2 × Mongolian Chicken") and "table 4" in out["replyText"]
    assert "Shall I place it?" in out["replyText"] and "confirmed" not in out["replyText"]


def test_allergy_guide_is_short_and_grouped():
    from recommender import allergy_guide
    menu = MENU + [
        {"id": f"p{i}", "name": n, "price": 380, "category": "Prawn Selection"}
        for i, n in enumerate(["Masala Prawn", "Prawn with Green Chili", "Sweet & Sour Prawn", "Prawn with Garlic"])
    ] + [
        {"id": f"s{i}", "name": n, "price": 350, "category": "Rice & Noodles Selection"}
        for i, n in enumerate(["Special Chowmein", "Special Fried Rice", "Special American Chopsuey"])
    ]
    idx = MenuIndex(menu)
    orderable = {idx.item_id(i): True for i in idx.items}
    g = allergy_guide(idx, "shellfish", orderable)
    assert "all Prawn Selection dishes" in g["groups"] and "the 'Special' dishes" in g["groups"]
    assert len(g["groups"]) <= 9 and g["count"] >= 10          # 10+ dishes said in a handful of phrases


def test_kitchen_claim_and_long_allergy_list_are_corrected():
    assert brain._KITCHEN_CLAIM.search("Masala Chicken এর জন্য ঝাল কমানোর নোট আমি কিচেনে পাঠিয়েছি।")
    assert brain._KITCHEN_CLAIM.search("I've let the kitchen know.")
    assert not brain._KITCHEN_CLAIM.search("I've added a note for the kitchen: less spicy.")
    ops = [{"op": "note", "itemId": "mc", "name": "Masala Chicken", "note": "less spicy"}]
    fixed = brain._fix_kitchen_claim("ঠিক আছে। Masala Chicken এর জন্য ঝাল কমানোর নোট আমি কিচেনে পাঠিয়েছি। আর কিছু?", ops, "bn")
    assert fixed == "ঠিক আছে। Masala Chicken এর জন্য নোট যোগ করেছি: less spicy। আর কিছু?"
    # a dietary answer reading out 10+ dishes triggers the "group it" rewrite
    long_reply = "Avoid " + ", ".join(i["name"] for i in MENU[:12]) + ". Please tell the staff."
    _, calls = _run("I'm allergic to prawns, what should I avoid?",
                    [{**TURN, "topic": "dietary", "intent": "menu", "replyText": long_reply},
                     {**TURN, "topic": "dietary", "intent": "menu", "replyText": "Avoid all prawn dishes. Please tell the staff."}])
    assert len(calls) == 2 and "Too long to say out loud" in calls[1][-1]["content"]
    assert any("ALLERGY GUIDE (shellfish)" in m["content"] for m in calls[0])  # (the retry appends to the same list)


def test_plan_total_is_inserted_before_the_closing_question():
    plan = {"lines": [{"itemId": "mc", "name": "Mongolian Chicken", "qty": 1, "price": 350, "variant": ""},
                      {"itemId": "er", "name": "Egg Fried Rice", "qty": 1, "price": 270, "variant": ""}],
            "total": 620, "party": 2, "budget": 0, "fits": True}
    out = brain._with_plan_total("For two: Mongolian Chicken and Egg Fried Rice. Shall I add them?", plan, IDX, "en", None)
    assert out == "For two: Mongolian Chicken and Egg Fried Rice. That's ৳620 in total. Shall I add them?"
    # already has a total, or names a dish outside the plan → untouched
    has = "Mongolian Chicken and Egg Fried Rice come to ৳620 in total."
    assert brain._with_plan_total(has, plan, IDX, "en", None) == has
    other = "Mongolian Chicken, Egg Fried Rice and a Beef Sizzling."
    assert brain._with_plan_total(other, plan, IDX, "en", None) == other


def test_thats_all_never_places_the_order():
    history = [{"role": "assistant", "content": "Thai Fried Rice Chicken added. Anything else, or shall I confirm your order?"}]
    ctx = {"mealKinds": ["dinner"], "cartItems": [{"itemId": "rc", "quantity": 1}]}
    confirm_attempt = {**TURN, "topic": "confirm_order", "intent": "order", "confirmOrder": True,
                       "replyText": "Your order is confirmed!"}
    for words in ["That's all", "no that's it", "nothing else"]:
        calls = []

        async def fake(messages):
            calls.append(messages)
            return json.dumps(confirm_attempt)

        orig = brain._call_openai
        brain._call_openai = fake
        try:
            out = asyncio.run(brain.generate_reply(words, menu_snapshot={"items": MENU}, history=history, context=ctx))
        finally:
            brain._call_openai = orig
        assert not out["meta"]["decision"].get("placeOrder"), words
        assert "confirmed" not in out["replyText"].lower(), words
    # a real yes starts the checkout (deterministic fast path, no model call) — it still isn't placed
    out = asyncio.run(brain.generate_reply("yes please", menu_snapshot={"items": MENU}, history=history, context=ctx))
    assert out["meta"]["decision"].get("askTable") is True and not out["meta"]["decision"].get("placeOrder")


def test_bangla_asks_for_picks_and_den_accepts_the_offer():
    from recommender import asks_for_recommendation
    from waiter_knowledge import is_affirmative

    # live: "ভালো খেকি আছে আপনার কাছে?" (ASR for "ভালো কী আছে") got one dish and no cards
    for t in ["ভালো কী আছে আপনার কাছে?", "ভালো খেকি আছে আপনার কাছে?", "কী ভালো আছে?", "ভালো কিছু আছে?", "bhalo ki ache?"]:
        assert asks_for_recommendation(t), t
    assert not asks_for_recommendation("আমি ভালো আছি")
    # live: "দ্যান" after "আপনার জন্য এটা দেব?" was taken as thanks
    for t in ["দেন", "দ্যান", "দিন", "হ্যাঁ দেন", "ওকে দেন", "den"]:
        assert is_affirmative(t), t
    assert not is_affirmative("হাফ প্লেট দেন") and not is_affirmative("না দেন না")

    calls = []

    async def fake(messages):
        calls.append(messages)
        return json.dumps({**TURN, "replyText": "ধন্যবাদ।"})

    state = {"reco": RecoState(turn=1, last_offered=["bs"], last_offer_turn=1).to_dict()}
    history = [{"role": "assistant", "content": "আমাদের Beef Sizzling রাতের জন্য দারুণ। আপনার জন্য এটা দেব?"}]
    orig = brain._call_openai
    brain._call_openai = fake
    try:
        out = asyncio.run(brain.generate_reply("দ্যান", menu_snapshot={"items": MENU}, history=history, dialog_state=state,
                                               context={"mealKinds": ["dinner"]}, locale="bn"))
        assert not calls  # deterministic
        assert [(o["op"], o["itemId"], o["quantity"]) for o in out["meta"]["cartOps"]] == [("add", "bs", 1)]
        assert "Beef Sizzling" in out["replyText"] and out["meta"]["intent"] == "order"
        # two dishes offered → "দেন" is ambiguous → the model decides (asks which one)
        state2 = {"reco": RecoState(turn=1, last_offered=["bs", "sc"], last_offer_turn=1).to_dict()}
        out = asyncio.run(brain.generate_reply("দেন", menu_snapshot={"items": MENU}, history=history, dialog_state=state2,
                                               context={"mealKinds": ["dinner"]}, locale="bn"))
        assert calls and out["meta"]["cartOps"] == []
        # a dish that needs its curry choices first is never added blindly
        calls.clear()
        state3 = {"reco": RecoState(turn=1, last_offered=["c2"], last_offer_turn=1).to_dict()}
        out = asyncio.run(brain.generate_reply("দেন", menu_snapshot={"items": MENU}, history=history, dialog_state=state3,
                                               context={"mealKinds": ["dinner"]}, locale="bn"))
        assert calls and out["meta"]["cartOps"] == []
    finally:
        brain._call_openai = orig


def test_offline_fallback_still_recommends_and_never_misleads():
    brain.OPENAI_API_KEY = ""
    out = asyncio.run(brain.generate_reply("what do you recommend?", menu_snapshot={"items": MENU}, context={"mealKinds": ["dinner"]}))
    assert out["meta"]["suggestions"] and "suggest" in out["replyText"].lower()
    out = asyncio.run(brain.generate_reply("Is the Hot & Sour Soup spicy?", menu_snapshot={"items": MENU}))
    assert "৳" not in out["replyText"]                       # doesn't answer a spice question with a price
    out = asyncio.run(brain.generate_reply("How much is the Spring Roll?", menu_snapshot={"items": MENU}))
    assert "230" in out["replyText"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
