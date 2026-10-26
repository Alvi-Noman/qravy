"""A number in a dish's name vs a count, and the same dish listed twice — run: python -m pytest tests/test_dish_numbers.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

SET_MENUS = MenuIndex([{"id": f"s{n}", "name": f"Set Menu-{n}", "price": 300 + n} for n in range(1, 7)]
                      + [{"id": "ff", "name": "French Fry", "price": 120}])


def _order(text):
    named = brain._dishes_named(text, SET_MENUS)
    ops = [{"op": "add", "itemId": SET_MENUS.item_id(it), "name": it["name"], "quantity": 1} for it in named]
    brain._fix_quantities(ops, text, SET_MENUS)
    return [(o["name"], o["quantity"]) for o in ops]


def test_the_number_in_a_name_is_not_a_count():
    # "সেট মেনু-৩ এবং একটি ফ্রেঞ্চ ফ্রাই" once became 3 × Set Menu-1 (৩ read as a count, একটি as Set Menu-1)
    assert _order("আমাকে সেট মেনু-৩ এবং একটি ফ্রেঞ্চ ফ্রাই দাও।") == [("Set Menu-3", 1), ("French Fry", 1)]
    assert _order("দুইটা সেট মেনু ২ দাও") == [("Set Menu-2", 2)]
    assert _order("সেট মেনু-৫ ৩টা দিন") == [("Set Menu-5", 3)]
    assert _order("সেট মেনু চার দিন") == [("Set Menu-4", 1)]
    assert _order("একটা সেট মেনু ছয়") == [("Set Menu-6", 1)]


def test_the_copy_of_a_dish_that_can_be_ordered_now_is_used():
    # "গরুর কালা ভুনা" is on the menu twice (breakfast and lunch); at 10am the lunch copy was picked and the order
    # was dropped with a bare "দুঃখিত, কোনটা বোঝালেন?"
    ix = MenuIndex([{"id": "lunch", "name": "গরুর কালা ভুনা", "price": 350},
                    {"id": "breakfast", "name": "গরুর কালা ভুনা", "price": 350}])
    orderable = {"lunch": False, "breakfast": True}
    raw = [{"op": "add", "item": ix.ref(ix.by_id["lunch"]), "quantity": 1, "variant": "", "note": "", "choices": []}]
    ops, problems = brain._validate_ops(raw, ix, {}, orderable, "গরুর কালা ভুনা দাও একটা", "গরুর কালা ভুনা দাও একটা")
    assert [o["itemId"] for o in ops] == ["breakfast"] and not any("not orderable" in p for p in problems)


def test_the_one_dish_on_now_that_is_that_dish_by_name():
    # "পরোটা" (breakfast) at 8pm → the evening's "প্যাঁচ পরোটা" (it said "পরোটা এখন পাওয়া যাচ্ছে না, কাছাকাছি প্যাঁচ পরোটা")
    ix = MenuIndex([{"id": "p", "name": "পরোটা"}, {"id": "pp", "name": "প্যাঁচ পরোটা ✓"}, {"id": "nan", "name": "গার্লিক নান"}])
    on = {"p": False, "pp": True, "nan": True}
    assert brain._orderable_twin(ix.by_id["p"], ix, on)["id"] == "pp"
    # two parathas on → no guess
    ix2 = MenuIndex([{"id": "p", "name": "পরোটা"}, {"id": "a", "name": "আলু পরোটা"}, {"id": "b", "name": "ডিম পরোটা"}])
    assert brain._orderable_twin(ix2.by_id["p"], ix2, {"p": False, "a": True, "b": True}) is None


def test_several_dishes_in_one_sentence_are_never_one_merged_name():
    ix = MenuIndex([{"id": "k", "name": "বিফ শিক কাবাব"}, {"id": "n1", "name": "কাশ্মীরি নান"}, {"id": "n2", "name": "গার্লিক নান"}])
    assert brain._several_dishes("একটা বিফ শিক দাও আর একটা নান দাও।", ix)
    assert brain._menu_answer("একটা বিফ শিক দাও আর একটা নান দাও।", ix, {}, set(), [], "bn", lambda _x: True) is None
    assert not brain._several_dishes("বিফ তেহারি আছে?", ix)
