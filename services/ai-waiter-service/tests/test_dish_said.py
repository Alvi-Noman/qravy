# dishSaid — the on-screen dishes as the voice says them, so the app can slide its suggestion cards along with the
# voice. Metadata only: the reply and the voice text are untouched.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv  # noqa: E402
from bn_translit import to_bangla_script  # noqa: E402


def _no_learned(monkeypatch):
    monkeypatch.setattr(srv, "_say_learned", lambda text, tenant: text)


def test_suggestions_and_offers_in_order_without_repeats(monkeypatch):
    _no_learned(monkeypatch)
    meta = {
        "suggestions": [{"itemId": "a", "title": "Hot Wings"}, {"itemId": "b", "title": "Oreo Milkshake"}],
        "upsell": [{"itemId": "b", "title": "Oreo Milkshake"}, {"id": "c", "name": "French Fries"}, "junk", {"itemId": "", "title": "x"}],
    }
    out = srv.dish_said(meta, tenant=None)
    assert [d["id"] for d in out] == ["a", "b", "c"]


def test_each_name_is_spoken_as_the_voice_text_says_it(monkeypatch):
    _no_learned(monkeypatch)
    names = ["Hot Wings", "Oreo Milkshake", "French Fries"]
    meta = {"suggestions": [{"itemId": str(i), "title": n} for i, n in enumerate(names)]}
    out = srv.dish_said(meta, tenant=None)
    # the same conversion the voice text gets — so each name is found inside it
    voice = to_bangla_script(f"আছে {names[0]}, {names[1]} আর {names[2]}।", spoken=True)
    for d in out:
        assert d["said"] and d["said"] in voice


def test_nothing_on_screen_nothing_sent(monkeypatch):
    _no_learned(monkeypatch)
    assert srv.dish_said({}, tenant=None) == []
