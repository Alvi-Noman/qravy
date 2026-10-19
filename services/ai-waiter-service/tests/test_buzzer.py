"""The counter buzzer: rings for orders and table calls, a new ring while it's ringing is seen, silencing only clears
what the staff saw, it survives a restart, and a quiet device shows as offline.  Run: python tests/test_buzzer.py"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402


class _FakeCol:
    """Stands in for the buzzer_alerts collection."""

    def __init__(self):
        self.docs = {}

    def update_one(self, flt, upd, upsert=False):
        self.docs.setdefault(flt["_id"], {"_id": flt["_id"]}).update(upd["$set"])

    def find(self, flt):
        return list(self.docs.values())


def _fresh():
    server._ALERT_STATE.clear()
    server._DEVICE_SEEN.clear()
    server._ALERTS = _FakeCol()


def test_rings_for_an_order_and_a_call_and_says_which():
    _fresh()
    server._set_alert("burger-house", True, None, kind="order")
    st = server._alert_state("burger-house")
    assert st["active"] and st["kind"] == "order"
    first = st["last"]
    time.sleep(0.01)
    server._set_alert("burger-house", True, None, kind="call")
    st = server._alert_state("burger-house")
    assert st["active"] and st["kind"] == "call" and st["last"] > first  # a new ring while ringing is seen


def test_silencing_only_clears_what_was_seen():
    _fresh()
    server._set_alert("t1", True, "branch-a", kind="order")
    seen = server._alert_state("t1")["since"]
    time.sleep(0.01)
    server._set_alert("t1", True, "branch-b", kind="call")  # came in after the staff looked
    server._set_alert("t1", False, None, until=seen)
    assert server._alert_state("t1", "branch-a")["active"] is False
    assert server._alert_state("t1", "branch-b")["active"] is True  # still ringing — nobody saw it
    server._set_alert("t1", False, None)  # no "until" (older dashboards, a device button): all off
    assert server._alert_state("t1")["active"] is False


def test_a_branch_hears_its_own_and_branchless_rings():
    _fresh()
    server._set_alert("t2", True, "gulshan")
    assert server._alert_state("t2", "gulshan")["active"]
    assert not server._alert_state("t2", "banani")["active"]
    assert server._alert_state("t2")["active"]  # a buzzer for every branch
    server._set_alert("t2", True, None)  # an order without a branch rings every branch's buzzer
    assert server._alert_state("t2", "banani")["active"]


def test_it_survives_a_restart():
    _fresh()
    changed = server._set_alert("t3", True, None, kind="call")
    server._persist_alerts(changed)
    saved = server._ALERTS
    server._ALERT_STATE.clear()  # the service restarted
    server._ALERTS = saved
    server._load_alerts()
    st = server._alert_state("t3")
    assert st["active"] and st["kind"] == "call"


def test_a_quiet_device_shows_how_long_ago():
    _fresh()
    assert server._device_seen_ago("t4") is None  # no buzzer here
    server._DEVICE_SEEN[("t4", "")] = time.time() - 40
    assert 39 <= server._device_seen_ago("t4") <= 41
    assert server._device_seen_ago("t4", "gulshan") is not None  # a buzzer for every branch counts for each


def test_only_a_buzzer_counts_as_a_buzzer():
    """The dashboard asks on its own site (no Origin header on a same-site GET) — that's not a buzzer checking in."""
    import asyncio
    from aiohttp.test_utils import make_mocked_request

    _fresh()
    asyncio.run(server.handle_alert_get(make_mocked_request("GET", "/alert?tenant=t5")))
    assert server._device_seen_ago("t5") is None
    asyncio.run(server.handle_alert_get(make_mocked_request("GET", "/alert?tenant=t5&device=1")))
    assert server._device_seen_ago("t5") is not None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
