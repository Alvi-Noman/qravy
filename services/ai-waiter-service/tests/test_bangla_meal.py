"""A Bengali (bhaat) restaurant's waiter — run: python -m pytest tests/test_bangla_meal.py

At a ভাত-মাছ restaurant "কী খাওয়া যায়?" got "আট আনা ভর্তা, আলু ভর্তা…" — sides as dishes of their own. A Bengali waiter
offers rice with the curries ("এখন ভাত খেতে পারেন। ভাতের সাথে মাছের মধ্যে … আছে…"), bhorta / dal only with rice, and
asks "…সাথে ভাত দেব?" when a curry is ordered alone. Fast food / Chinese / cafés are untouched."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bangla_meal  # noqa: E402
import brain  # noqa: E402
import offers  # noqa: E402
from recommender import GuestProfile, OrderStats, RecoState  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

_ROWS = [
    ("ভর্তা ভাজির মাখামাখি", ["আট আনা ভর্তা মিক্সড 🌶🌶", "আলু ভর্তা", "বেগুন ভর্তা", "শাক ভাজি", "শুটকি ভুনা", "চিংড়ির ভর্তা"]),
    ("কারির কাহিনী", ["চিকেন ঝাল ফ্রাই 🌶", "দেশি মুরগির ঝোল ✓", "গরুর লাল ভুনা", "মাটন দোপেয়াজা"]),
    ("মাছ মসাল বাঙালি", ["সাদা ভাত (মিনিকেট)", "রুই মাছ (গ্রাসি)", "সরষে ইলিশ", "আইর মাছ"]),
    ("ভোরের শহর", ["ডাল", "পরোটা", "চিকেন সুপ", "আলুর চপ", "সিঙ্গারা"]),
    ("কলিজা ঠাণ্ডা", ["আদা লেবু লাচ্ছি 🌶", "মাল্টার পিওর জুস", "মসলা চা"]),
    ("মিষ্টি বিলাস", ["বগুড়ার বিখ্যাত সরা দই"]),
]
MENU = [{"id": f"h{c}{n}", "name": name, "price": 40 if "ভাত" in name else 220, "category": cat}
        for c, (cat, names) in enumerate(_ROWS) for n, name in enumerate(names)]
IDX = MenuIndex(MENU)
BY = {it["name"]: it for it in MENU}
FAST_FOOD = MenuIndex([{"id": f"f{n}", "name": n_, "price": 300, "category": c}
                       for n, (c, n_) in enumerate([("Burgers", "Classic Beef Burger"), ("Burgers", "Chicken Cheese Burger"),
                                                    ("Sides", "French Fries"), ("Drinks", "Coke"), ("Chicken", "Chicken Curry")])])


def _reco(t, kinds, index=IDX, lang="bn", orderable=None, in_tray=None):
    return brain._fixed_reco(t, index=index, orderable=orderable or {}, kinds=kinds, profile=GuestProfile(),
                             stats=OrderStats(), rstate=RecoState(), kind_scope=set(), lang=lang, stage="none",
                             mode="full", about_shown=False, cart_ids=[], in_tray=in_tray)


def test_roles_at_a_bhaat_meal():
    role = lambda n: bangla_meal.role(BY[n])  # noqa: E731
    assert role("সাদা ভাত (মিনিকেট)") == "rice"
    assert role("রুই মাছ (গ্রাসি)") == "fish" and role("শুটকি ভুনা") == "fish"  # (a "ভর্তা…" category doesn't make it a side)
    assert role("চিকেন ঝাল ফ্রাই 🌶") == "chicken" and role("গরুর লাল ভুনা") == "meat"
    assert role("আলু ভর্তা") == "side" and role("চিংড়ির ভর্তা") == "side" and role("ডাল") == "side"
    assert role("আদা লেবু লাচ্ছি 🌶") == "" and role("আলুর চপ") == ""
    assert bangla_meal.is_bhaat_house(IDX.items) and not bangla_meal.is_bhaat_house(FAST_FOOD.items)
    assert bangla_meal.said_name(BY["দেশি মুরগির ঝোল ✓"]) == "দেশি মুরগির ঝোল"


def test_what_to_eat_at_lunch_is_rice_with_curries():
    text, cards, note = _reco("কি খাওয়া যেতে পারে?", ["lunch"])
    assert note == "reco_bhaat"
    assert text.startswith("এখন ভাত খেতে পারেন। ভাতের সাথে মাছের মধ্যে") and "মাংসের মধ্যে" in text, text
    assert "আট আনা ভর্তা" not in text and "✓" not in text and "🌶" not in text, text
    assert text.rstrip().endswith("নিতে পারেন।") and ("আলু ভর্তা" in text or "ডাল" in text), text
    assert cards and len(cards) <= 8
    en, _, _ = _reco("what's good to eat?", ["dinner"], lang="en")
    assert en.startswith("Right now you can have rice — with it we have fish like"), en
    # rice already in the tray: straight to what goes with it
    rice = BY["সাদা ভাত (মিনিকেট)"]["id"]
    again, _, _ = _reco("কি খাওয়া যেতে পারে?", ["lunch"], in_tray={rice})
    assert again.startswith("ভাতের সাথে"), again


def test_no_rice_meal_when_rice_isnt_served_or_in_the_afternoon():
    no_rice = {BY["সাদা ভাত (মিনিকেট)"]["id"]: False}
    text, _, note = _reco("কি খাওয়া যেতে পারে?", ["lunch"], orderable=no_rice)
    assert note != "reco_bhaat" and "ভর্তা" not in text and "ডাল" not in text.split("।")[0], text
    aft, _, note = _reco("কি খাওয়া যেতে পারে?", ["afternoon"])
    assert note != "reco_bhaat", aft
    for curry_or_side in ("গরুর লাল ভুনা", "মাটন দোপেয়াজা", "আলু ভর্তা", "আট আনা ভর্তা", "শাক ভাজি"):
        assert curry_or_side not in aft, aft


def test_a_curry_alone_gets_rice_offered_like_a_bengali_waiter():
    for dish, said in (("গরুর লাল ভুনা", "গরুর লাল ভুনার সাথে ভাত দেব?"), ("চিকেন ঝাল ফ্রাই 🌶", "চিকেন ঝাল ফ্রাইয়ের সাথে ভাত দেব?"),
                       ("রুই মাছ (গ্রাসি)", "রুই মাছের সাথে ভাত দেব?")):
        iid = BY[dish]["id"]
        rows, _ = brain.cart_lines(IDX, [{"itemId": iid, "quantity": 1}])
        c = offers.Ctx(index=IDX, orderable={}, rows=brain._tray.with_refs(rows), added=[{"op": "add", "itemId": iid, "quantity": 1}],
                       picks=[], stats=OrderStats(), profile=GuestProfile(), clash=lambda it: [], lang="bn",
                       arm={"wording": "reason", "timing": "early"})
        o = offers.plan("first_add", c)
        assert o and o.type == "rice" and o.text.startswith(said), (dish, o and o.text)
        assert o.ops[0]["itemId"] == BY["সাদা ভাত (মিনিকেট)"]["id"]  # plain rice, not paratha


def test_other_restaurants_are_untouched():
    text, _, note = _reco("what's good to eat?", ["lunch"], index=FAST_FOOD, lang="en")
    assert note != "reco_bhaat" and "rice" not in text.lower(), text
    assert bangla_meal.house_note(FAST_FOOD.items, FAST_FOOD.items) == ""
    assert "Bengali rice-and-curry" in bangla_meal.house_note(IDX.items, IDX.items)
