"""Categories switched by hand (Categories → "Turn categories on and off": By hand): the waiter ignores category serving
hours, as the menu and checkout do. Run: python -m pytest tests/test_category_hours_mode.py"""
import os
import sys
from datetime import datetime, timezone

import mongomock
from bson import ObjectId

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from availability import load_rules, unavailable_reason  # noqa: E402

T = ObjectId()
CAT = ObjectId()
BRANCH = ObjectId()
NOON_DHAKA = datetime(2026, 10, 26, 6, 0, tzinfo=timezone.utc)  # 12:00 in Asia/Dhaka


def _db(mode=None):
    d = mongomock.MongoClient().db
    d["tenants"].insert_one({"_id": T, "timezone": "Asia/Dhaka", **({"categoryHoursMode": mode} if mode else {})})
    d["categories"].insert_one(
        {
            "_id": CAT,
            "tenantId": T,
            "name": "Breakfast",
            "availability": [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "07:00", "end": "11:00"}],
            "branchAvailability": [{"locationId": BRANCH, "availability": [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "06:00", "end": "10:00"}]}],
        }
    )
    return d


DISH = {"id": "d1", "name": "Paratha", "categoryId": CAT}


def test_automatic_follows_the_category_hours():
    rules = load_rules(_db(), T)
    assert unavailable_reason(DISH, rules, NOON_DHAKA) == "Breakfast is served 7am–11am."


def test_by_hand_ignores_the_category_hours():
    rules = load_rules(_db("manual"), T)
    assert rules["categories"][str(CAT)]["hours"] == []
    assert unavailable_reason(DISH, rules, NOON_DHAKA) is None


def test_by_hand_ignores_a_branchs_own_hours_too():
    rules = load_rules(_db("manual"), T, BRANCH)
    assert unavailable_reason(DISH, rules, NOON_DHAKA) is None


def test_by_hand_keeps_the_dishs_own_hours():
    rules = load_rules(_db("manual"), T)
    dish = {**DISH, "availability": [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "18:00", "end": "22:00"}]}
    assert unavailable_reason(dish, rules, NOON_DHAKA) is not None
