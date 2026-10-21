"""ElevenLabs Scribe as the waiter's ears (stt_engines.py): dish names as keyterms, back to plain / scribe_v1 when the
account can't, credits used up → STATUS["out"] (the waiter goes back to gpt-4o), and the credits for Cortex.
Run: python -m pytest tests/test_stt_engines.py"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
import stt_engines  # noqa: E402


class R:
    def __init__(self, code, text="", js=None):
        self.status_code, self.text, self._js = code, text, js

    def json(self):
        return self._js


def fake(responses, seen):
    async def post(self, url, data=None, files=None, headers=None, **k):
        seen.append(list(data or []))
        return responses.pop(0)

    async def get(self, url, headers=None, **k):
        return responses.pop(0)
    return post, get


def run(responses, keyterms=None, monkeypatch=None):
    seen = []
    post, get = fake(responses, seen)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    monkeypatch.setattr(stt_engines, "ELEVEN_KEY", "k")
    return asyncio.run(stt_engines.elevenlabs(b"\0\0" * 1600, 16000, keyterms)), seen


def test_keyterms_are_sent_and_dropped_if_refused(monkeypatch):
    monkeypatch.setattr(stt_engines, "_keyterms_ok", True)
    monkeypatch.setattr(stt_engines, "_eleven_model", "scribe_v2")
    (text, err), seen = run([R(422, '{"detail":"keyterms not supported"}'), R(200, "", {"text": "একটা ভাত দাও"})],
                            ["ভাত", "ভর্তা"], monkeypatch)
    assert (text, err) == ("একটা ভাত দাও", "")
    assert ("keyterms", "ভাত") in seen[0] and not any(k == "keyterms" for k, _v in seen[1])


def test_no_scribe_v2_falls_back_to_v1(monkeypatch):
    monkeypatch.setattr(stt_engines, "_eleven_model", "scribe_v2")
    (text, _e), seen = run([R(400, '{"detail":"invalid model_id"}'), R(200, "", {"text": "হ্যাঁ"})], None, monkeypatch)
    assert text == "হ্যাঁ" and ("model_id", "scribe_v1") in seen[1]


def test_credits_used_up_turns_it_off_and_a_rate_limit_doesnt(monkeypatch):
    monkeypatch.setattr(stt_engines, "STATUS", {"out": False})
    (text, err), _ = run([R(401, '{"detail":{"status":"quota_exceeded"}}')], None, monkeypatch)
    assert text is None and stt_engines.STATUS["out"] is True
    monkeypatch.setattr(stt_engines, "STATUS", {"out": False})
    run([R(429, '{"detail":"too_many_concurrent_requests"}')], None, monkeypatch)
    assert stt_engines.STATUS["out"] is False


def test_the_credits_for_cortex(monkeypatch):
    saved = {}

    class Coll:
        def update_one(self, q, u, upsert):
            saved.update(u["$set"])

    class Db:
        settings = Coll()
    monkeypatch.setattr(stt_engines, "ELEVEN_KEY", "k")
    monkeypatch.setattr(stt_engines, "STATUS", {"out": False})
    _p, get = fake([R(200, "", {"character_count": 9500, "character_limit": 10000, "tier": "free"})], [])
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    asyncio.run(stt_engines.refresh_status(Db()))
    assert saved["left"] == 500 and saved["low"] is True and saved["out"] is False and saved["tier"] == "free"
