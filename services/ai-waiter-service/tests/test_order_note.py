"""The guest's "Note for the kitchen" (typed in the tray) goes with an order they confirm by voice.
Run: python tests/test_order_note.py"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402


class _Resp:
    status_code = 201
    content = b"x"

    def json(self):
        return {"order": {"token": "t" * 32, "orderNumber": 7, "status": "placed"}, "created": True}


def _place(draft):
    sent = []

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json):
            sent.append(json)
            return _Resp()

    orig_client, orig_sub = server.httpx.AsyncClient, server.tenant_subdomain
    server.httpx.AsyncClient = _Client
    server.tenant_subdomain = lambda tenant: "burger-house"
    try:
        out = asyncio.run(server.place_order_via_api(tenant="t1", branch=None, session_id="s1", draft=draft))
    finally:
        server.httpx.AsyncClient, server.tenant_subdomain = orig_client, orig_sub
    return out, sent


DRAFT = {"table": "12", "items": [{"itemId": "a1", "qty": 2}], "signature": "abc"}


def test_the_note_goes_with_the_order():
    out, sent = _place({**DRAFT, "notes": "everything less spicy"})
    assert out["ok"] and sent[0]["notes"] == "everything less spicy"


def test_no_note_sends_none():
    _, sent = _place(dict(DRAFT))
    assert "notes" not in sent[0]


if __name__ == "__main__":
    test_the_note_goes_with_the_order()
    test_no_note_sends_none()
    print("ok")
