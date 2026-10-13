"""Offline tests for "bill please" / "call a waiter" said to the waiter → the restaurant's dashboard (the same
endpoint as the storefront's bell button).  Run: python tests/test_staff_call.py"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402


class _Resp:
    def __init__(self, status, data):
        self.status_code = status
        self._data = data
        self.content = b"x"

    def json(self):
        return self._data


def _post_with(status, data, sent):
    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json):
            sent.append((url, json))
            return _Resp(status, data)

    return _Client


def _call(request, *, status=201, data=None, table="12", table_key="abcd2345", branch=None):
    sent = []
    orig_client, orig_sub = server.httpx.AsyncClient, server.tenant_subdomain
    server.httpx.AsyncClient = _post_with(status, data if data is not None else {"request": {"token": "t" * 32, "kind": "bill", "status": "open", "table": table}}, sent)
    server.tenant_subdomain = lambda tenant: "burger-house"
    try:
        out = asyncio.run(server.call_staff_via_api(tenant="t1", branch=branch, table=table, table_key=table_key, request=request))
    finally:
        server.httpx.AsyncClient, server.tenant_subdomain = orig_client, orig_sub
    return out, sent


def test_paging_only_at_a_table():
    orig = server.STAFF_ALERTS_ENABLED
    server.STAFF_ALERTS_ENABLED = True
    try:
        assert server.staff_can_be_paged("dine-in", "12")
        assert server.staff_can_be_paged(None, "12")           # a table and no channel → the table's QR
        assert not server.staff_can_be_paged("online", "12")   # the online shop: nobody to send over
        assert not server.staff_can_be_paged("dine-in", None)
        assert not server.staff_can_be_paged("dine-in", "  ")
        server.STAFF_ALERTS_ENABLED = False
        assert not server.staff_can_be_paged("dine-in", "12")  # switched off for the deployment
    finally:
        server.STAFF_ALERTS_ENABLED = orig


def test_kinds_map_to_the_dashboard():
    out, sent = _call({"type": "bill", "note": ""})
    assert out["ok"] and out["request"]["token"] == "t" * 32
    url, body = sent[0]
    assert url.endswith("/api/v1/public/service-requests"), url
    assert body == {"subdomain": "burger-house", "table": "12", "kind": "bill", "tableKey": "abcd2345"}, body
    assert _call({"type": "call_staff", "note": ""})[1][0][1]["kind"] == "waiter"
    assert _call({"type": "cleanup", "note": ""})[1][0][1]["kind"] == "cleanup"
    assert "note" not in _call({"type": "water", "note": "guest requested water"})[1][0][1]  # filler, not shown
    # things the dashboard has no button for → "other", saying what it was
    body = _call({"type": "napkins", "note": ""})[1][0][1]
    assert body["kind"] == "other" and body["note"] == "Napkins", body
    body = _call({"type": "other", "note": "a high chair"})[1][0][1]
    assert body["kind"] == "other" and body["note"] == "a high chair", body
    body = _call({"type": "other", "note": ""})[1][0][1]
    assert body["kind"] == "other" and body["note"], body  # never an empty "other"
    assert _call({"type": "bill", "note": ""}, branch="gulshan")[1][0][1]["branch"] == "gulshan"


def test_a_failed_call_says_so():
    out, _ = _call({"type": "bill", "note": ""}, status=400, data={"message": "We could not find that table"})
    assert out == {"ok": False}
    out, sent = _call({"type": "bill", "note": ""}, table=None)
    assert out == {"ok": False} and sent == []  # no table → nothing sent


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
