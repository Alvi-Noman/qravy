"""Offline tests for the speech-to-text safety net — run: python tests/test_stt.py (needs the service's deps)"""
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv  # noqa: E402

PROMPT = "রেস্টুরেন্টে খাবারের অর্ডার নিয়ে কথা। মেনু: সেট মেনু এ-03, স্পেশাল আমেরিকান চপসুয়ে, থাই স্পেশাল ফ্রাইড নুডলস, স্পেশাল চাওমিন, চাওমিন প্রন।"


def _pcm(seconds: float, amp: int, rate: int = 16000) -> bytes:
    return b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * 220 * i / rate))) for i in range(int(seconds * rate)))


def test_silence_is_not_transcribed():
    assert not srv.has_speech(b"\x00\x00" * 16000)            # silence
    assert not srv.has_speech(_pcm(1.0, 80))                   # faint hum
    loud = _pcm(0.3, 0) + _pcm(0.6, 4000) + _pcm(0.3, 0)       # a voice-like burst in quiet
    assert srv.has_speech(loud)


def test_hint_echo_is_rejected():
    assert srv.is_prompt_echo("স্পেশাল আমেরিকান চপসুয়ে, থাই স্পেশাল ফ্রাইড নুডলস, স্পেশাল চাওমিন", PROMPT)
    assert srv.is_prompt_echo("রেস্টুরেন্টে খাবারের অর্ডার নিয়ে কথা।", PROMPT)
    # real requests that happen to name a dish are kept
    assert not srv.is_prompt_echo("একটা স্পেশাল চাওমিন দিন", PROMPT)
    assert not srv.is_prompt_echo("চাওমিন প্রন আর স্পেশাল চাওমিন, দুইটাই দিন", PROMPT)
    assert not srv.is_prompt_echo("বিলটা দিয়েন", PROMPT)


def test_good_mixed_transcripts_are_kept_and_filler_is_not():
    live = "Crispy rice soup, lemon doita, choice of two curry with fried rice and vegetable given, chapta."
    assert not srv.is_junk_transcript(live)
    assert not srv.is_junk_transcript("স্প্রিং রোলটা বাদ দেন।")
    for junk in ["Thanks for watching!", "Thank you.", "you", "Please subscribe", " "]:
        assert srv.is_junk_transcript(junk), junk


def test_an_echoed_hint_means_unclear_not_a_groq_guess():
    import asyncio

    prompt = srv.stt_prompt("burger-house", "bn")
    calls = []

    async def fake_openai(pcm, lang, rate=16000, prompt="", model=None):
        return prompt  # nothing clear was said → it repeats its hint

    async def fake_groq(pcm, lang, rate=16000, prompt=""):
        calls.append("groq")
        return "নিউবদ্র সাস্কর ভাব্য়া পাসি।"

    o_oa, o_gq, o_on, o_ab = srv.openai_transcribe, srv.groq_transcribe, srv.OPENAI_STT_ON, srv.stt_ab_on
    srv.openai_transcribe, srv.groq_transcribe, srv.OPENAI_STT_ON, srv.stt_ab_on = fake_openai, fake_groq, True, (lambda: False)
    try:
        speech = _pcm(0.3, 0) + _pcm(0.6, 4000) + _pcm(0.3, 0)
        assert asyncio.run(srv.cloud_transcribe(speech, "bn", tenant="burger-house")) == (None, "unclear")
        assert calls == []  # no invented Groq text
    finally:
        srv.openai_transcribe, srv.groq_transcribe, srv.OPENAI_STT_ON, srv.stt_ab_on = o_oa, o_gq, o_on, o_ab


def test_hint_never_contains_action_words():
    p = srv.stt_prompt("burger-house", "bn")
    for bad in ("অর্ডারটা দিয়ে দিন", "হ্যাঁ", "বিল দিন", "আর কিছু লাগবে না"):
        assert bad not in p, bad


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
