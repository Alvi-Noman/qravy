"""The waiter at a branch: finds the branch from the guest's link and only offers that branch's menu (the same dishes the
menu page shows). Run: python -m pytest tests/test_branch_menu.py"""
import os
import sys

import mongomock
import pytest
from bson import ObjectId

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability  # noqa: E402
from availability import load_rules, on_branch_menu, resolve_location_id  # noqa: E402

T = ObjectId()
GULSHAN = ObjectId()
BANANI = ObjectId()
OLD = ObjectId()  # a branch made before branches had slugs


@pytest.fixture
def db():
    availability._LOCATION_ID_CACHE.clear()
    d = mongomock.MongoClient().db
    d["tenants"].insert_one({"_id": T, "timezone": "Asia/Dhaka"})
    d["locations"].insert_many(
        [
            {"_id": GULSHAN, "tenantId": T, "name": "Gulshan 2 (Main)", "slug": "gulshan-2-main"},
            {"_id": BANANI, "tenantId": T, "name": "Banani", "slug": "banani"},
            {"_id": OLD, "tenantId": T, "name": "Uttara Sector 7"},
            {"_id": ObjectId(), "tenantId": ObjectId(), "name": "Elsewhere", "slug": "banani"},  # another restaurant
        ]
    )
    return d


def test_finds_the_branch_from_its_link(db):
    assert resolve_location_id(db, T, "gulshan-2-main") == GULSHAN  # the slug (what QR codes carry)
    assert resolve_location_id(db, T, "Gulshan-2-Main") == GULSHAN
    assert resolve_location_id(db, T, "banani") == BANANI
    assert resolve_location_id(db, T, "Banani") == BANANI
    assert resolve_location_id(db, T, str(BANANI)) == BANANI
    assert resolve_location_id(db, T, "uttara-sector-7") == OLD  # name written as a link (older links)
    assert resolve_location_id(db, T, "nowhere") is None
    assert resolve_location_id(db, T, "a.*") is None  # not a pattern


def _menu(db, loc, channel="dine-in"):
    cat_main, cat_gulshan_only, cat_off = ObjectId(), ObjectId(), ObjectId()
    db["categories"].insert_many(
        [
            {"_id": cat_main, "tenantId": T, "name": "Mains"},
            {"_id": cat_gulshan_only, "tenantId": T, "name": "Gulshan specials", "scope": "location", "locationId": GULSHAN},
            {"_id": cat_off, "tenantId": T, "name": "Desserts"},
        ]
    )
    burger, steak, banani_pie, lava, sold, gone = (ObjectId() for _ in range(6))
    items = [
        {"id": str(burger), "categoryId": str(cat_main)},
        {"id": str(steak), "categoryId": str(cat_gulshan_only)},
        {"id": str(banani_pie), "categoryId": str(cat_main), "locationId": str(BANANI)},
        {"id": str(lava), "categoryId": str(cat_off)},
        {"id": str(sold), "categoryId": str(cat_main)},
        {"id": str(gone), "categoryId": str(cat_main)},
    ]
    # Banani took desserts off its menu, sold out one dish and removed another
    db["categoryVisibility"].insert_one({"tenantId": T, "categoryId": cat_off, "locationId": BANANI, "channel": "dine-in", "removed": True})
    db["itemAvailability"].insert_many(
        [
            {"tenantId": T, "itemId": sold, "locationId": BANANI, "channel": "dine-in", "available": False},
            {"tenantId": T, "itemId": gone, "locationId": BANANI, "channel": "dine-in", "removed": True},
        ]
    )
    rules = load_rules(db, T, loc, channel)
    names = dict(zip(["burger", "steak", "banani_pie", "lava", "sold", "gone"], items))
    return {k for k, it in names.items() if on_branch_menu(it, rules)}, rules, names


def test_banani_menu(db):
    on, rules, names = _menu(db, BANANI)
    assert on == {"burger", "banani_pie", "sold"}  # not Gulshan's specials, not the desserts or the removed dish
    assert names["sold"]["id"] in rules["sold_out"]  # still on the menu — "sold out right now"


def test_gulshan_menu(db):
    on, _, _ = _menu(db, GULSHAN)
    assert on == {"burger", "steak", "lava", "sold", "gone"}  # Banani's changes don't touch Gulshan


def test_takeaway_at_banani_keeps_what_it_only_took_off_dine_in(db):
    on, _, _ = _menu(db, BANANI, channel="online")
    assert {"lava", "gone"} <= on


def test_no_branch_is_the_whole_menu(db):
    on, _, _ = _menu(db, None)
    assert on == {"burger", "steak", "banani_pie", "lava", "sold", "gone"}


def test_each_branch_keeps_its_own_tray(monkeypatch):
    import cart_store

    monkeypatch.setattr(cart_store, "carts", mongomock.MongoClient().db["carts"])
    cart_store.save_cart("burger", "s1", [{"id": "burger", "qty": 1}], "gulshan")
    assert cart_store.load_cart("burger", "s1", "gulshan") == [{"id": "burger", "qty": 1}]
    assert cart_store.load_cart("burger", "s1", "banani") == []  # not Gulshan's tray
    assert cart_store.load_cart("burger", "s1") == []
    # a tray saved before branches were part of the key is still the no-branch tray
    cart_store.carts.insert_one({"tenant": "burger", "sessionId": "s2", "items": [{"id": "x"}], "updatedAt": __import__("time").time()})
    assert cart_store.load_cart("burger", "s2") == [{"id": "x"}]


def test_a_switched_off_branch_is_not_found(db):
    db["locations"].update_one({"_id": BANANI}, {"$set": {"disabled": True}})
    assert resolve_location_id(db, T, "banani") is None


def test_dishes_follow_the_channel(db):
    from availability import on_channel_menu

    online_only = {"id": "x1", "visibility": {"dineIn": False, "online": True}}
    rules = {"turned_on": {}}
    assert not on_channel_menu(online_only, rules, "dine-in")  # never offered at the table
    assert on_channel_menu(online_only, rules, "online")
    assert on_channel_menu(online_only, rules, None)
    # Banani switched it on for dine-in → offered at Banani's tables
    assert on_channel_menu(online_only, {"turned_on": {"x1": {"dine-in"}}}, "dine-in")


def test_conversation_memory_is_per_branch():
    import importlib

    server = importlib.import_module("server")
    assert server.convo_sid("s1", "gulshan") != server.convo_sid("s1", "banani")
    assert server.convo_sid("s1", None) == "s1"


def test_no_branch_means_the_branch_orders_go_to(db):
    # two open branches, no main link branch → no branch (the whole menu, no one branch's changes)
    assert resolve_location_id(db, T, None) is None
    availability._LOCATION_ID_CACHE.clear()
    # the owner sends the main link's orders to Banani → that branch
    db["tenants"].update_one({"_id": T}, {"$set": {"mainBranchId": BANANI}})
    assert resolve_location_id(db, T, None) == BANANI
    availability._LOCATION_ID_CACHE.clear()
    # one open branch → it
    db["tenants"].update_one({"_id": T}, {"$unset": {"mainBranchId": ""}})
    db["locations"].update_many({"tenantId": T, "_id": {"$ne": GULSHAN}}, {"$set": {"disabled": True}})
    assert resolve_location_id(db, T, None) == GULSHAN
