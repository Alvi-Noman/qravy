"""The AI's opening line ("preamble" — "let me check what's mild…"): read from the answer as it streams, checked, sent
once, before the answer — and never able to break a turn. No real AI: a fake streaming endpoint.
Run: python -m pytest tests/test_preamble.py"""
import asyncio
import json
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402

ITEMS = [
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "csz", "name": "Chicken Sizzling", "price": 420, "category": "Sizzling"},
    {"id": "cos", "name": "Corn Soup", "price": 220, "category": "Soup"},
]
IDX = brain.MenuIndex(ITEMS)
ANSWER = {"sayFirst": "Okay, something mild… let me see", "topic": "other", "intent": "menu", "language": "en",
          "mentionedItems": [], "cartOps": [], "clearCart": False, "confirmOrder": False, "checkout": "none",
          "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [], "guestPrefs": None,
          "replyText": "The Corn Soup is gentle and mild."}


def _sse(text: str, pieces: int = 9, usage=True) -> bytes:
    """The answer the way the AI streams it: small pieces, then usage, then [DONE]."""
    step = max(1, len(text) // pieces)
    out = []
    for i in range(0, len(text), step):
        out.append("data: " + json.dumps({"choices": [{"delta": {"content": text[i:i + step]}}]}))
    if usage:
        out.append("data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}))
    out.append("data: [DONE]")
    return ("\n\n".join(out) + "\n\n").encode("utf-8")


def _call(handler, sink=None):
    """_call_openai against a fake endpoint, with the opening line going to `sink` (as generate_reply sets it)."""
    said = []

    async def record(text):
        said.append(text)
        if sink:
            await sink(text)

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        orig_client, orig_key = brain._client, brain.OPENAI_API_KEY
        brain._client, brain.OPENAI_API_KEY = (lambda: client), "test-key"
        token = brain._PREAMBLE_NOW.set(record)
        try:
            return await brain._call_openai([{"role": "user", "content": "something mild?"}])
        finally:
            brain._PREAMBLE_NOW.reset(token)
            brain._client, brain.OPENAI_API_KEY = orig_client, orig_key
            await client.aclose()

    return asyncio.run(go()), said


def test_the_opening_line_is_read_from_the_stream_and_the_whole_answer_still_comes_back():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, content=_sse(json.dumps(ANSWER, ensure_ascii=False)))

    raw, said = _call(handler)
    assert said == ["Okay, something mild… let me see"]
    assert json.loads(raw) == ANSWER  # (the answer is exactly what a plain request returns)
    assert seen[0]["stream"] is True


def test_the_opening_line_goes_out_before_the_rest_of_the_answer_is_written():
    order = []
    text = json.dumps(ANSWER, ensure_ascii=False)

    async def stream():
        for i in range(0, len(text), 12):
            order.append("piece")
            yield ("data: " + json.dumps({"choices": [{"delta": {"content": text[i:i + 12]}}]}) + "\n\n").encode()
            await asyncio.sleep(0)
        yield b"data: [DONE]\n\n"

    async def sink(_t):
        order.append("LINE")

    raw, said = _call(lambda r: httpx.Response(200, content=stream()), sink)
    assert said and json.loads(raw)["replyText"] == ANSWER["replyText"]
    assert order.index("LINE") < len(order) - 3  # said while most of the answer was still to come


def test_no_opening_line_when_it_is_empty_or_not_first():
    raw, said = _call(lambda r: httpx.Response(200, content=_sse(json.dumps({**ANSWER, "sayFirst": ""}))))
    assert said == [] and json.loads(raw)["replyText"] == ANSWER["replyText"]
    # json_object mode (another endpoint): the fields come in any order → none this turn, the answer as usual
    other = {"topic": "other", **{k: v for k, v in ANSWER.items() if k != "topic"}}
    raw, said = _call(lambda r: httpx.Response(200, content=_sse(json.dumps(other))))
    assert said == [] and json.loads(raw)["sayFirst"] == ANSWER["sayFirst"]


def test_a_failing_opening_line_never_costs_the_answer():
    async def broken(_t):
        raise RuntimeError("socket closed")

    raw, said = _call(lambda r: httpx.Response(200, content=_sse(json.dumps(ANSWER))), broken)
    assert json.loads(raw)["replyText"] == ANSWER["replyText"]


def test_a_server_error_is_retried_like_before():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, text="busy")
        return httpx.Response(200, content=_sse(json.dumps(ANSWER)))

    raw, said = _call(handler)
    assert len(calls) == 2 and json.loads(raw)["replyText"] == ANSWER["replyText"]
    assert said == [ANSWER["sayFirst"]]


def test_a_rejected_cache_key_falls_back_to_a_plain_request():
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if "prompt_cache_key" in body:
            return httpx.Response(400, text="unknown field prompt_cache_key")
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}], "usage": {}})

    orig = brain._CACHE_KEY_OK
    brain._CACHE_KEY_OK = True
    try:
        raw, said = _call(handler)
    finally:
        brain._CACHE_KEY_OK = orig
    assert json.loads(raw)["replyText"] == ANSWER["replyText"]


def test_a_stream_that_stalls_is_given_up_within_the_turns_budget():
    async def stalls():
        yield ("data: " + json.dumps({"choices": [{"delta": {"content": '{"sayFirst": "Okay'}}]}) + "\n\n").encode()
        await asyncio.sleep(30)
        yield b"data: [DONE]\n\n"

    orig = brain.BRAIN_TIMEOUT_S, brain.BRAIN_RETRIES
    brain.BRAIN_TIMEOUT_S, brain.BRAIN_RETRIES = 1.0, 0
    try:
        try:
            _call(lambda r: httpx.Response(200, content=stalls()))
            assert False, "should time out"
        except httpx.TimeoutException:
            pass
    finally:
        brain.BRAIN_TIMEOUT_S, brain.BRAIN_RETRIES = orig


def test_without_an_opening_line_wanted_the_request_is_exactly_as_before():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ANSWER)}}], "usage": {}})

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        orig_client, orig_key = brain._client, brain.OPENAI_API_KEY
        brain._client, brain.OPENAI_API_KEY = (lambda: client), "test-key"
        try:
            return await brain._call_openai([{"role": "user", "content": "hi"}])
        finally:
            brain._client, brain.OPENAI_API_KEY = orig_client, orig_key
            await client.aclose()

    raw = asyncio.run(go())
    assert json.loads(raw) == ANSWER and "stream" not in seen[0]


def test_only_a_safe_line_is_said_before_the_answer_is_checked():
    ok = brain._preamble_ok
    assert ok("Okay, something mild… let me see", IDX) == "Okay, something mild… let me see"
    assert ok("  Sure —   let me check  ", IDX) == "Sure — let me check"
    assert ok("The French Fry is mild", IDX) == ""  # a dish
    assert ok("Under ৳500… let me see", IDX) == ""  # a price
    assert ok("Let me check 2 options", IDX) == ""  # a number
    assert ok("I've added it, one moment", IDX) == ""  # a claim
    assert ok("Your order has been sent", IDX) == ""
    assert ok("x" * 90, IDX) == ""  # too long to be an opening line
    assert ok("", IDX) == ""


def _turn(text, model, *, send=True):
    """generate_reply with a fake AI that writes `model`'s preamble as it streams (like _call_openai does)."""
    sent, calls = [], []

    async def fake(messages):
        on = brain._PREAMBLE_NOW.get()
        calls.append(on is not None)
        if on is not None and model.get("sayFirst"):
            await on(model["sayFirst"])
        return json.dumps(model, ensure_ascii=False)

    async def to_app(t):
        sent.append(t)

    async def go():
        orig = brain._call_openai
        brain._call_openai = fake
        token = brain.PREAMBLE_TO.set(to_app) if send else None
        try:
            return await brain.generate_reply(text, menu_snapshot={"items": ITEMS}, locale="en",
                                              context={"cartItems": [], "mealKinds": ["dinner"]})
        finally:
            if token is not None:
                brain.PREAMBLE_TO.reset(token)
            brain._call_openai = orig

    return asyncio.run(go()), sent, calls


QUESTION = "which soup is the mildest, for my kid?"


def test_a_turn_sends_the_opening_line_once_and_keeps_it_for_review():
    out, sent, calls = _turn(QUESTION, ANSWER)
    assert calls and calls[0] is True  # the first model call may say one
    assert sent == [ANSWER["sayFirst"]]
    assert out["meta"].get("preamble") == ANSWER["sayFirst"]
    assert out["replyText"]


def test_an_unsafe_opening_line_is_never_sent():
    out, sent, _ = _turn(QUESTION, {**ANSWER, "sayFirst": "The Corn Soup, one moment"})
    assert sent == [] and "preamble" not in out["meta"]
    assert out["replyText"]


def test_no_socket_no_opening_line():
    out, sent, calls = _turn(QUESTION, ANSWER, send=False)
    assert sent == [] and calls and calls[0] is False and "preamble" not in out["meta"]
