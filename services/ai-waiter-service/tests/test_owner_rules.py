"""The owner's say over the AI waiter (Settings → Upsell & picks): "a guest orders these → offer these" comes before
the engine's own offer, and "a guest asks for <words> → show these dishes" answers the ask with exactly those dishes,
in the owner's order.  Run: python tests/test_owner_rules.py"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402
import offers  # noqa: E402
from recommender import GuestProfile, OrderStats  # noqa: E402
from test_offers import IDX, ITEMS, TURN, line, ref  # noqa: E402


def _rows(*cart):
    rows, _ = brain.cart_lines(IDX, list(cart))
    return brain._tray.with_refs(rows)


def _ctx(rows, added, rules, **kw):
    base = dict(index=IDX, orderable={}, rows=rows, added=added, picks=[], stats=OrderStats(), profile=GuestProfile(),
                clash=lambda it: [], lang="en", arm={"wording": "reason", "timing": "early"}, owner_rules=rules)
    base.update(kw)
    return offers.Ctx(**base)


BRAND = [{"whenItemIds": ["smash"], "whenCategories": [], "offerItemIds": ["mint"], "on": True}]


def test_ordering_the_dish_offers_the_owners_pick_first():
    rows = _rows(line("smash"))
    o = offers.plan("first_add", _ctx(rows, [{"op": "add", "itemId": "smash", "quantity": 1}], BRAND))
    # the engine alone would offer fries / a meal for a burger — the owner said Mint Lemonade
    assert o.type == "owner:mint" and o.item_ids == ["mint"], o
    assert o.text == "Would you like a Mint Lemonade with the Classic Smash Burger? (৳160)", o.text
    assert o.ops == [{"op": "add", "itemId": "mint", "name": "Mint Lemonade", "quantity": 1}]
    assert o.card["itemId"] == "mint"


def test_a_category_rule_and_what_is_skipped():
    rule = [{"whenItemIds": [], "whenCategories": ["Chicken"], "offerItemIds": ["mint", "coke"], "on": True}]
    rows = _rows(line("hw", variation="6 pcs", modifiers=[{"name": "Regular"}]), line("mint"))
    o = offers.plan("first_add", _ctx(rows, [{"op": "add", "itemId": "hw", "quantity": 1}], rule))
    assert o.type == "owner:coke", o  # Mint Lemonade is already in the tray → the next one
    # sold out → skipped; switched off → the engine decides again
    o2 = offers.plan("first_add", _ctx(_rows(line("hw", variation="6 pcs", modifiers=[{"name": "Regular"}])),
                                       [{"op": "add", "itemId": "hw", "quantity": 1}], rule, orderable={"mint": False}))
    assert o2.type == "owner:coke", o2
    off = [{**rule[0], "on": False}]
    o3 = offers.plan("first_add", _ctx(_rows(line("hw", variation="6 pcs", modifiers=[{"name": "Regular"}])),
                                       [{"op": "add", "itemId": "hw", "quantity": 1}], off))
    assert o3 is None or not o3.type.startswith("owner"), o3


def test_it_is_offered_once_a_visit_and_also_at_the_end():
    rows = _rows(line("smash"))
    done = offers.plan("first_add", _ctx(rows, [{"op": "add", "itemId": "smash", "quantity": 1}], BRAND,
                                          done_types=["owner:mint"]))
    assert done is None or done.type != "owner:mint"
    end = offers.plan("wrap_up", _ctx(rows, [], BRAND))  # "that's all" with the burger in the tray
    assert end.type == "owner:mint", end


def run(text, rules, cart=()):
    async def fake(messages):
        return json.dumps({**TURN, "replyText": "Sure."})

    async def no_reading(*a, **k):
        return None

    orig, orig_u = brain._call_openai, brain._understand
    brain._call_openai, brain._understand = fake, no_reading
    try:
        return asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="en",
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "channel": "online"},
            restaurant={"suggestRules": rules}))
    finally:
        brain._call_openai, brain._understand = orig, orig_u


PICKS = [{"phrases": ["refreshing", "ঠান্ডা কিছু"], "itemIds": ["mint", "coke"], "on": True}]


def test_asking_for_the_owners_word_shows_their_dishes_in_their_order():
    out = run("anything refreshing?", PICKS)
    assert [r["itemId"] for r in out["meta"]["suggestions"]] == ["mint", "coke"], out["meta"]["suggestions"]
    assert out["meta"]["notes"] == "reco_owner", out["meta"].get("notes")
    assert "Mint Lemonade" in out["replyText"] and "Coca-Cola" in out["replyText"], out["replyText"]
    assert "popular" not in out["replyText"].lower(), out["replyText"]  # never claimed without evidence


def test_bangla_words_match_with_endings_and_other_asks_are_untouched():
    out = run("ঠান্ডা কিছু আছে?", PICKS)
    assert [r["itemId"] for r in out["meta"]["suggestions"]] == ["mint", "coke"], out["replyText"]
    # "refreshing" inside another word is not the word; an order is not an ask
    assert brain._owner_pick("I'll have the Hot Wings", PICKS, IDX, {}) is None
    assert brain._owner_pick("refreshingly cold", PICKS, IDX, {}) is None
    # a switched-off rule, or none of its dishes orderable → the AI picks
    assert brain._owner_pick("anything refreshing?", [{**PICKS[0], "on": False}], IDX, {}) is None
    assert brain._owner_pick("anything refreshing?", PICKS, IDX, {"mint": False, "coke": False}) is None
    assert brain._owner_pick("anything refreshing?", PICKS, IDX, {"mint": False}) == ("refreshing", ["coke"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
