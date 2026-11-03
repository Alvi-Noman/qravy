"""The cuisine's default day (knowledge/cuisines/*.md "Schedule") and the dishes never eaten alone ("Needs a base") —
run: python -m pytest tests/test_day_schedule.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import knowledge  # noqa: E402
import recommender as R  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

# a Chinese + fast-food café like the one that suggested a lone "Chicken Masala" in the morning
CAFE = MenuIndex([
    {"id": "s1", "name": "Set Menu 1", "category": "Student's Packages", "price": 189},
    {"id": "s2", "name": "Set Menu 7", "category": "Student's Packages", "price": 230},
    {"id": "fr", "name": "Chicken Fried Rice", "category": "Rice", "price": 250},
    {"id": "ma", "name": "Chicken Masala", "category": "Masala Curry", "price": 380},
    {"id": "co", "name": "Chicken Chili Onion", "category": "Masala Curry", "price": 350},
    {"id": "mo", "name": "Naga Momos", "category": "Appetizers", "price": 189},
    {"id": "wi", "name": "Chicken Wings", "category": "Appetizers", "price": 199},
    {"id": "we", "name": "Masala Wedges", "category": "Appetizers", "price": 159},
    {"id": "bu", "name": "Royal Juicy Burger", "category": "Fast Food", "price": 159},
])
CUISINES = ["fast food", "chinese", "cafe"]


def setup_function():
    global _tokens
    _tokens = (R.SCHEDULE.set(None), R.BASES.set(()))


def teardown_function():
    # (the day's schedule is per turn — never left over for the next test)
    R.SCHEDULE.reset(_tokens[0])
    R.BASES.reset(_tokens[1])


def _picks(minute, on=None, limit=4):
    R.SCHEDULE.set(knowledge.schedule_now(CUISINES, minute))
    R.BASES.set(knowledge.needs_base(CUISINES))
    picks, blocked = R.rank(CAFE, on or {}, ["breakfast", "lunch", "dinner"], R.GuestProfile(), limit=limit)
    return [p.item["id"] for p in picks], picks, blocked


def test_every_cuisine_pack_has_a_day_that_parses():
    for name in os.listdir(os.path.join(knowledge.ROOT, "cuisines")):
        key = name[:-3]
        day = [knowledge.schedule_now([key], m) for m in (9 * 60, 13 * 60, 17 * 60, 20 * 60, 23 * 60 + 30)]
        assert all(day), f"{name}: a time of day with no schedule slot"


def test_the_morning_is_set_menus_and_fried_rice_and_the_afternoon_snacks():
    morning, _p, _b = _picks(9 * 60)
    assert set(morning[:2]) <= {"s1", "s2", "fr"}
    afternoon, _p, _b = _picks(17 * 60)
    assert set(afternoon[:3]) & {"mo", "wi", "we"}


def test_a_masala_is_never_suggested_alone():
    _ids, picks, blocked = _picks(13 * 60, limit=9)
    masala = [p for p in picks if p.item["id"] in ("ma", "co")]
    assert masala and all(p.reasons[0] == "with Chicken Fried Rice" for p in masala)
    # no fried rice on now → no masala at all
    _ids, picks, blocked = _picks(13 * 60, on={"fr": False}, limit=9)
    assert not any(p.item["id"] in ("ma", "co") for p in picks) and "ma" in blocked
    # a snack with a spice word in its name is still a snack
    assert R.base_for(CAFE.by_id["we"], CAFE, {}) is None


def test_a_kebab_goes_well_with_naan_but_is_still_a_kebab_without_it():
    R.BASES.set(knowledge.needs_base(["bangla"]))
    ix = MenuIndex([{"id": "k", "name": "চিকেন চাপ মাসালা", "category": "কাবাব"},
                    {"id": "n", "name": "কাশ্মীরি নান", "category": "রুটি"},
                    {"id": "c", "name": "দেশি মুরগির ঝোল", "category": "কারি"},
                    {"id": "r", "name": "সাদা ভাত", "category": "ভাত"}])
    assert R.base_for(ix.by_id["k"], ix, {})["id"] == "n"
    assert R.base_for(ix.by_id["k"], ix, {"n": False}) is None  # (still suggested)
    assert R.base_for(ix.by_id["c"], ix, {})["id"] == "r"
    assert R.base_for(ix.by_id["c"], ix, {"r": False})["id"] == "n"  # (no rice on: with the naan, like a nehari)
    assert R.base_for(ix.by_id["c"], ix, {"r": False, "n": False}) is False  # (nothing to eat it with: not suggested)
