"""Tests for availability.py — run: python -m pytest tests  (or: python tests/test_availability.py)"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from availability import format_windows, is_within, next_opening, resolve_windows, unavailable_reason, DEFAULT_PERIODS  # noqa: E402

TZ = "Asia/Dhaka"
# 2026-09-28T02:30Z = Monday 08:30 in Dhaka
MON_0830 = datetime(2026, 9, 28, 2, 30, tzinfo=timezone.utc)
MON_1200 = datetime(2026, 9, 28, 6, 0, tzinfo=timezone.utc)
BREAKFAST = [{"days": [1, 2, 3, 4, 5], "start": "07:00", "end": "11:00"}]
OPEN = [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "11:00", "end": "23:00"}]


def test_is_within_uses_restaurant_time_zone():
    assert is_within(BREAKFAST, TZ, MON_0830)
    assert not is_within(BREAKFAST, "UTC", MON_0830)  # 02:30 UTC
    assert is_within([], TZ, MON_0830)


def test_past_midnight_window():
    late = [{"days": [5, 6], "start": "22:00", "end": "02:00"}]
    sat_0130_dhaka = datetime(2026, 10, 2, 19, 30, tzinfo=timezone.utc)  # Sat 01:30 Dhaka
    assert is_within(late, TZ, sat_0130_dhaka)
    mon_0130_dhaka = datetime(2026, 10, 4, 19, 30, tzinfo=timezone.utc)  # Mon 01:30 Dhaka
    assert not is_within(late, TZ, mon_0130_dhaka)


def test_formatting_and_next_opening():
    assert format_windows(BREAKFAST) == "Mon–Fri 7am–11am"
    assert next_opening(BREAKFAST, TZ, MON_1200) == "tomorrow 7am"
    assert next_opening(OPEN, TZ, MON_0830) == "11am"


def test_unavailable_reasons_in_priority_order():
    rules = {
        "tz": TZ,
        "opening": OPEN,
        "categories": {"c1": {"name": "Breakfast", "hours": BREAKFAST}},
        "sold_out": {"i9"},
    }
    item = {"id": "i1", "name": "Paratha", "categoryId": "c1", "availability": []}
    # 08:30 → restaurant closed (opens 11am) wins over breakfast hours
    assert unavailable_reason(item, rules, MON_0830) == "We're closed right now — we open at 11am."
    # 12:00 → open, but breakfast is over
    assert unavailable_reason(item, rules, MON_1200) == "Breakfast is served Mon–Fri 7am–11am."
    # switched off beats everything — with no time to come back it's "not available right now", never "sold out today"
    # (a branch that never serves kebabs said "কাবাব আজ শেষ হয়ে গেছে" every day, Nov 14–16)
    assert unavailable_reason({**item, "id": "i9"}, rules, MON_1200) == "Sorry, Paratha isn't available right now."
    # the owner's "Sold out → until 3pm": sold out, and when it's back
    until = {**rules, "sold_out_until": {"i9": MON_1200 + timedelta(hours=3)}}
    assert unavailable_reason({**item, "id": "i9"}, until, MON_1200) == "Sorry, Paratha is sold out right now — back at 3pm."
    # item's own hours
    special = {"id": "i2", "name": "Friday Biryani", "availability": [{"days": [5], "start": "12:00", "end": "15:00"}]}
    assert unavailable_reason(special, rules, MON_1200) == "Friday Biryani is available Fri 12pm–3pm."
    # switched off restaurant-wide (no branches), no time set
    assert unavailable_reason({"id": "i4", "name": "Fries", "offline": True}, rules, MON_1200) == "Sorry, Fries isn't available right now."
    # orderable
    assert unavailable_reason({"id": "i3", "name": "Coke"}, rules, MON_1200) is None
    # Bangla
    assert unavailable_reason({**item, "id": "i9"}, rules, MON_1200, lang="bn") == "Paratha এখন পাওয়া যাচ্ছে না।"


def test_service_periods_and_dates():
    rules = {"tz": TZ, "opening": [], "categories": {}, "sold_out": set(), "periods": DEFAULT_PERIODS}
    # Breakfast item at noon → not served
    b = {"id": "b1", "name": "Paratha", "servicePeriodIds": ["breakfast"]}
    assert unavailable_reason(b, rules, MON_1200) == "Paratha is available 7am–11am."
    assert unavailable_reason(b, rules, MON_0830) is None
    # Breakfast time edited in Settings → follows
    edited = {**rules, "periods": [{"id": "breakfast", "name": "Breakfast", "days": [1], "start": "07:00", "end": "08:00"}]}
    assert unavailable_reason(b, edited, MON_0830) == "Paratha is available Mon 7am–8am."
    # deleted period is ignored → always
    assert resolve_windows(["gone"], [], DEFAULT_PERIODS) == []
    # dates (Dhaka date)
    eid = {"id": "e1", "name": "Eid Special", "availableFrom": "2026-10-03", "availableUntil": "2026-10-05"}
    assert unavailable_reason(eid, rules, MON_1200) == "Eid Special is available from 2026-10-03."
    later = datetime(2026, 10, 10, 6, 0, tzinfo=timezone.utc)
    assert unavailable_reason(eid, rules, later) == "Eid Special is no longer available."
    during = datetime(2026, 10, 2, 20, 0, tzinfo=timezone.utc)  # 3 Oct 02:00 Dhaka
    assert unavailable_reason(eid, rules, during) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
