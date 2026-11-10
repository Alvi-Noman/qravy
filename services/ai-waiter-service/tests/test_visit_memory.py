"""The waiter remembers the whole visit: dishes this guest already ordered (in the kitchen or on the table) are never
recommended back; what they said they can't eat goes to their own app as a visible filter; the app can ask each
dish's kind. Run: python -m pytest tests/test_visit_memory.py"""
import os
import sys
from datetime import datetime, timedelta

import mongomock
from bson import ObjectId

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv  # noqa: E402
import wait_time  # noqa: E402

T = ObjectId()
WINGS, SHAKE, FRIES, OLD, OTHER = (ObjectId() for _ in range(5))


def _kitchen(monkeypatch, orders):
    db = mongomock.MongoClient().db
    db["orders"].insert_many(orders)
    monkeypatch.setattr(srv, "_CLIENT", {srv.MENU_DB_NAME: db})
    monkeypatch.setattr(srv, "resolve_tenant_id", lambda t: T)
    monkeypatch.setattr(srv, "resolve_location_id", lambda *a, **k: None)
    return srv.kitchen_now("burger-house", None, "guest-1", wait_time.kitchen_settings(None), datetime.utcnow())


def _order(session, status, items, minutes_ago=10):
    return {"tenantId": T, "sessionId": session, "status": status, "createdAt": datetime.utcnow() - timedelta(minutes=minutes_ago),
            "items": [{"itemId": i, "name": "x", "qty": 1} for i in items], "eta": {}}


def test_every_dish_this_visit_counts_as_ordered_served_ones_too(monkeypatch):
    out = _kitchen(monkeypatch, [
        _order("guest-1", "completed", [WINGS], minutes_ago=50),  # already on the table
        _order("guest-1", "preparing", [SHAKE]),
        _order("guest-1", "cancelled", [FRIES]),  # cancelled: not theirs
        _order("guest-1", "completed", [OLD], minutes_ago=6 * 60),  # an earlier visit
        _order("guest-2", "preparing", [OTHER]),  # another guest
    ])
    assert set(out["myOrderedIds"]) == {str(WINGS), str(SHAKE)}


def test_no_session_no_memory(monkeypatch):
    db = mongomock.MongoClient().db
    monkeypatch.setattr(srv, "_CLIENT", {srv.MENU_DB_NAME: db})
    monkeypatch.setattr(srv, "resolve_tenant_id", lambda t: T)
    monkeypatch.setattr(srv, "resolve_location_id", lambda *a, **k: None)
    out = srv.kitchen_now("burger-house", None, None, wait_time.kitchen_settings(None), datetime.utcnow())
    assert out["myOrderedIds"] == []


MENU = [
    {"id": "b1", "name": "Classic Beef Burger", "description": "Beef patty, cheddar"},
    {"id": "c1", "name": "Crispy Chicken Burger", "description": "Fried chicken, slaw"},
]


def test_guest_filter_only_when_they_said_what_they_cant_eat():
    assert srv.guest_filter({"reco": {"profile": {}}}, MENU) is None
    assert srv.guest_filter({}, MENU) is None
    # a dish they only turned down is no diet
    assert srv.guest_filter({"reco": {"profile": {"declined": ["c1"]}}}, MENU) is None


def test_guest_filter_hides_what_their_diet_rules_out():
    gf = srv.guest_filter({"reco": {"profile": {"diet": ["no_beef"], "declined": ["c1"]}}}, MENU)
    assert gf is not None
    assert gf["diet"] == ["no_beef"]
    assert "b1" in gf["hide"] and "c1" not in gf["hide"]  # (declined isn't hidden by the filter)


def test_menu_kinds_leaves_out_dishes_of_no_kind(monkeypatch):
    monkeypatch.setattr(srv, "_dish_kind", lambda it: {"d": "drink", "s": "dessert"}.get(it.get("id"), ""))
    assert srv.menu_kinds([{"id": "d"}, {"id": "s"}, {"id": "x"}, {"name": "no id"}]) == {"d": "drink", "s": "dessert"}


# "the first one" is the first one the guest SEES: the app's numbered list on screen when it sent one
class _Index:
    by_id = {"a": {"id": "a", "name": "Oreo Milkshake"}, "b": {"id": "b", "name": "French Fries"}, "c": {"id": "c", "name": "Hot Wings"}}


class _Reco:
    last_offered = ["c", "a"]  # what the waiter last said, in another order
    last_offer_turn = 1
    last_list: list = []
    last_list_turn = 0
    turn = 9  # long ago: on its own, no longer a list to count in


def test_ordinal_counts_the_list_on_screen():
    import brain
    out = brain._ordinal_to_dish("দ্বিতীয়টা দিন", _Reco(), _Index(), ["a", "b"])
    assert "French Fries" in out or "ফ্রেঞ্চ" in out


def test_ordinal_without_a_screen_list_keeps_the_old_rule():
    import brain
    # the said list is too old (turn 9 vs 1) → left as the guest said it
    assert brain._ordinal_to_dish("দ্বিতীয়টা দিন", _Reco(), _Index(), None) == "দ্বিতীয়টা দিন"


def test_ordinal_never_rewrites_a_tray_change():
    import brain
    assert brain._ordinal_to_dish("প্রথমটা বাদ দিন", _Reco(), _Index(), ["a", "b"]) == "প্রথমটা বাদ দিন"


# "where's my rider?" — the restaurant's own rider on the guest's order, as a fact for the waiter
def test_rider_fact():
    now = datetime(2026, 11, 10, 14, 0)
    assert srv._rider_fact(None, now) == {}
    assert srv._rider_fact({"name": "Rakib", "pickedUpAt": None}, now) == {"rider": {"name": "Rakib", "pickedUpMinAgo": None}}
    out = srv._rider_fact({"name": "Rakib", "pickedUpAt": now - timedelta(minutes=12)}, now)
    assert out["rider"]["pickedUpMinAgo"] == 12


def test_rider_in_the_waiters_facts():
    import wait_talk
    k = {"queueMinutes": 0, "busy": "quiet", "ordersInKitchen": 1, "settings": wait_time.kitchen_settings(None),
         "myOrders": [{"orderNumber": 7, "status": "ready", "items": ["Hot Wings"], "rider": {"name": "Rakib", "pickedUpMinAgo": 5}},
                      {"orderNumber": 8, "status": "preparing", "items": ["Fries"], "rider": {"name": "Sumon", "pickedUpMinAgo": None}}]}
    text = wait_talk.facts(k)
    assert "OUT FOR DELIVERY with rider Rakib (picked up ~5 min ago)" in text
    assert "rider Sumon assigned, collecting it from the restaurant" in text
