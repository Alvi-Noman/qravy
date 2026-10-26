"""AI-first safety checks (CLAUDE.md: the AI writes the reply, the code checks it) — run: python -m pytest tests/test_ai_first.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402


def test_foods_the_menu_does_not_have_are_caught():
    # it once offered Fanta / Sprite on a menu with only Coca-Cola, and described a teriyaki platter
    ix = MenuIndex([{"id": "a", "name": "কোকা কোলা", "category": "Drinks"},
                    {"id": "b", "name": "Set Menu-5", "description": "Egg Fried Rice, Chicken Fry"},
                    {"id": "c", "name": "Masala Wedges (Spicy)"}])
    said = ["কোকা কোলা", "কোক", "ফান্টা", "Sprite", "Egg Fried Rice", "Masala Wedges", "Chicken Teriyaki Platter"]
    assert brain._unknown_foods(said, ix) == ["ফান্টা", "Sprite", "Chicken Teriyaki Platter"]
    assert brain._unknown_foods([], ix) == [] and brain._unknown_foods(None, ix) == []


def test_the_ai_first_schema_only_adds_the_field():
    s = brain.RESPONSE_SCHEMA_AI_FIRST
    assert "foodsNamed" in s["required"] and "foodsNamed" not in brain.RESPONSE_SCHEMA["required"]
    assert set(s["properties"]) - set(brain.RESPONSE_SCHEMA["properties"]) == {"foodsNamed"}


def test_closed_now_is_a_fact_with_the_opening_time():
    # at 1am the café (open 09:00–12:00) said "your tray is empty" / "try later" — never "closed, opens at 9"
    opening = [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "09:00", "end": "12:00"}]
    fact = brain._closed_fact(opening, "Tue 01:15")
    assert len(fact) == 1 and "CLOSED" in fact[0] and "09:00" in fact[0]
    assert brain._closed_fact(opening, "Tue 10:30") == []
    # open past midnight: 06:00–00:00 is closed at 02:08 and opens at 06:00
    assert "06:00" in brain._closed_fact([{"start": "06:00", "end": "00:00"}], "02:08")[0]
    assert brain._closed_fact([], "02:08") == []  # no hours set → nothing claimed


def test_opening_hours_past_midnight():
    # 06:00–00:00 was said as "রাত ১২টা থেকে ১২টা", 18:00–02:00 as "12am to 12am"
    assert "সকাল ৬টা থেকে রাত ১২টা" in brain._open_answer("রেস্টুরেন্ট কতক্ষণ খোলা?", [{"start": "06:00", "end": "00:00"}], "", 600, "bn")
    assert brain._open_answer("when do you open?", [{"start": "18:00", "end": "02:00"}], "", 600, "en").startswith("We're open 6pm to 2am")
