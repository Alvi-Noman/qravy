# services/ai-waiter-service/brain.py
"""
Brain module for Qravy AI Waiter (single-service, low-latency path).

- Uses OpenAI's Chat Completions API to call gpt-4o-mini.
- Returns only text (replyText). TTS is intentionally out-of-scope here.
- Safe to import and call from ai-waiter-service/server.py right after stt_final.

Environment variables (with reasonable defaults):
  OPENAI_API_KEY       : Required
  OPENAI_BASE          : Default "https://api.openai.com" (override for proxies)
  OPENAI_CHAT_MODEL    : Default "gpt-4o-mini"
  BRAIN_TIMEOUT_S      : Default "4.0"   (seconds) — keep this small for snappy UX
  BRAIN_MAX_TOKENS     : Default "200"   (generation cap)
  BRAIN_TEMP           : Default "0.3"
  BRAIN_TOP_P          : Default "1.0"
  BRAIN_FREQ_PENALTY   : Default "0.0"
  BRAIN_PRES_PENALTY   : Default "0.0"

Public async API:
  generate_reply(transcript: str, *, tenant=None, branch=None, channel=None,
                 locale=None, menu_snapshot=None, conversation_id=None, user_id=None)
    -> dict with shape: {"replyText": str, "meta": {...}}

Notes:
- Language behavior: reply in the *same* language (Bangla vs English) as the transcript.
- You can pass `menu_snapshot` (optional dict) to enable grounded answers later.
- Keep timeouts tight so UI feels instant. If timeout/error occurs, a short apology is returned.
"""

from __future__ import annotations

import os
import re
import json
from typing import Any, Dict, Optional

import httpx


# -------- Configuration --------

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini").strip()

BRAIN_TIMEOUT_S = float(os.environ.get("BRAIN_TIMEOUT_S", "4.0"))
BRAIN_MAX_TOKENS = int(os.environ.get("BRAIN_MAX_TOKENS", "200"))
BRAIN_TEMP = float(os.environ.get("BRAIN_TEMP", "0.3"))
BRAIN_TOP_P = float(os.environ.get("BRAIN_TOP_P", "1.0"))
BRAIN_FREQ_PENALTY = float(os.environ.get("BRAIN_FREQ_PENALTY", "0.0"))
BRAIN_PRES_PENALTY = float(os.environ.get("BRAIN_PRES_PENALTY", "0.0"))

OPENAI_CHAT_URL = f"{OPENAI_BASE}/v1/chat/completions"

# Simple language detectors
_BENGALI = re.compile(r"[\u0980-\u09FF]")   # Bangla block
_LATIN = re.compile(r"[A-Za-z]")


def _guess_lang(text: str) -> str:
    """Guess 'bn' for Bangla, 'en' for English, default 'en' if uncertain."""
    if _BENGALI.search(text):
        return "bn"
    if _LATIN.search(text):
        return "en"
    return "en"


def _clamp(s: str, max_chars: int) -> str:
    """Hard clamp to avoid oversized payloads in edge cases."""
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 1] + "…"


def _build_system_prompt(lang: str, tenant: Optional[str], branch: Optional[str],
                         channel: Optional[str], locale: Optional[str]) -> str:
    """
    Keep the system prompt short and fast. Focus on role, tone, language parity,
    concise actionable answers, and basic safety.
    """
    brand = tenant or "the restaurant"
    ch = channel or "online"
    loc = locale or ("bn-BD" if lang == "bn" else "en-US")

    if lang == "bn":
        return (
            "আপনি একজন ভয়েস ওয়েটার সহকারী। সংক্ষিপ্ত, ভদ্র ও কার্যকরভাবে উত্তর দিন। "
            f"{brand} এর মেনু/অফার/উপলব্ধতা সম্পর্কে নিশ্চিত না হলে প্রস্তাব সাধারণ রাখুন। "
            "অস্পষ্ট হলে ১–৩টি প্রাসঙ্গিক সাজেশন দিন, সংক্ষেপে কারণ বলুন। "
            "ইউজারের ভাষায় (বাংলা) উত্তর দিন। অতিরঞ্জিত দাবি করবেন না। "
            f"চ্যানেল: {ch}. লোকেল: {loc}. আউটপুট ছোট রাখুন; গ্রাহক শুনবেন।"
        )
    else:
        return (
            "You are a voice restaurant waiter. Be concise, polite, and action-oriented. "
            f"Assume some knowledge of {brand}'s menu/offers/availability, but keep suggestions general if uncertain. "
            "If the user is ambiguous, infer preferences and offer 1–3 relevant suggestions with brief reasons. "
            "Respond in the same language as the user (English here). Avoid exaggerated claims. "
            f"Channel: {ch}. Locale: {loc}. Keep replies short; the user will hear them."
        )


def _build_user_message(transcript: str, lang: str,
                        menu_snapshot: Optional[Dict[str, Any]]) -> str:
    """
    Build a compact user message. If a small menu snapshot is provided, inline
    a minimal hint so the model can ground suggestions (kept tiny for latency).
    """
    base = transcript.strip()
    if not menu_snapshot:
        return base

    # Keep snapshot extremely small; you can expand later to structured tools.
    try:
        compact_menu = {
            "categories": [
                {"name": c.get("name"), "id": c.get("id")}
                for c in (menu_snapshot.get("categories") or [])[:8]
            ],
            "items": [
                {
                    "name": i.get("name"),
                    "categoryIds": (i.get("categoryIds") or [])[:2],
                    "price": i.get("price"),
                }
                for i in (menu_snapshot.get("items") or [])[:20]
            ],
        }
        snippet = json.dumps(compact_menu, ensure_ascii=False)
    except Exception:
        snippet = ""

    if lang == "bn":
        return f"{base}\n\n[মেনু-ইঙ্গিত (সংক্ষেপিত)]: {snippet}"
    else:
        return f"{base}\n\n[Menu hint (compact)]: {snippet}"


async def _call_openai_chat(messages: list[dict[str, str]]) -> str:
    """
    Call OpenAI Chat Completions and return text content.
    """
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": OPENAI_CHAT_MODEL,
        "messages": messages,
        "max_tokens": BRAIN_MAX_TOKENS,
        "temperature": BRAIN_TEMP,
        "top_p": BRAIN_TOP_P,
        "frequency_penalty": BRAIN_FREQ_PENALTY,
        "presence_penalty": BRAIN_PRES_PENALTY,
        "stream": False,  # add streaming later if desired
    }

    async with httpx.AsyncClient(timeout=BRAIN_TIMEOUT_S) as client:
        resp = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)
        resp.raise_for_status()

    data = resp.json()
    # OpenAI-compatible shape: choices[0].message.content
    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except Exception as e:
        raise RuntimeError(f"OpenAI chat response parse error: {e}") from e


async def generate_reply(
    transcript: str,
    *,
    tenant: Optional[str] = None,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    locale: Optional[str] = None,
    menu_snapshot: Optional[Dict[str, Any]] = None,
    conversation_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entrypoint: produce a short, speakable reply for the given transcript.

    Returns:
      {
        "replyText": "<assistant message>",
        "meta": {
            "model": "<model>",
            "lang": "bn|en",
            "tenant": "...",
            "branch": "...",
            "channel": "...",
            "conversationId": "...",
            "userId": "...",
            "timing": { "timeout_s": <float> }
        }
      }
    """
    # Defensive clamps for latency and payload size
    transcript = _clamp(transcript or "", 2000).strip()
    if not transcript:
        # Very short default
        return {
            "replyText": "Sorry, I didn’t catch that. Could you say that again?",
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "lang": "en",
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "timing": {"timeout_s": BRAIN_TIMEOUT_S},
                "fallback": True,
            },
        }

    lang = _guess_lang(transcript)

    system_prompt = _build_system_prompt(lang, tenant, branch, channel, locale)
    user_message = _build_user_message(transcript, lang, menu_snapshot)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    # Try the model; on timeout/error return a polite short fallback.
    try:
        content = await _call_openai_chat(messages)
        content = content.strip()
        if not content:
            raise RuntimeError("Empty model response")
        # Keep replies compact; these are spoken. (Clamp just in case.)
        content = _clamp(content, 800)
        return {
            "replyText": content,
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "lang": lang,
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "timing": {"timeout_s": BRAIN_TIMEOUT_S},
                "fallback": False,
            },
        }
    except Exception as e:
        # Minimal apology in the correct language
        if lang == "bn":
            text = "দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?"
        else:
            text = "Sorry, I’m having trouble. Could you try once more?"
        return {
            "replyText": text,
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "lang": lang,
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "timing": {"timeout_s": BRAIN_TIMEOUT_S},
                "error": str(e),
                "fallback": True,
            },
        }


__all__ = ["generate_reply"]
