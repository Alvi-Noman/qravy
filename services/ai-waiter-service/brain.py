# services/ai-waiter-service/brain.py
"""
Minimal, future-proof brain:
- All behavior/intent/formatting lives in the fine-tuned model.
- This file is a thin adapter: send input → get JSON → return to caller.
- No regex, no prompt logic, no persona here. Change only the model ID via env.

Expected model output (single JSON object):
{
  "replyText": "string",
  "intent": "order|menu|suggestions|chitchat",
  "language": "bn|en",
  "items": [{"name":"...", "itemId":"...", "quantity": 1}],   # optional
  "notes": "..."                                               # optional
}
"""

from __future__ import annotations

import os
import json
import re
from typing import Any, Dict, Optional, List

import httpx

# --------------------------- Configuration ---------------------------

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4.1-mini").strip()

BRAIN_TIMEOUT_S = float(os.environ.get("BRAIN_TIMEOUT_S", "4.0"))
BRAIN_MAX_TOKENS = int(os.environ.get("BRAIN_MAX_TOKENS", "200"))
BRAIN_TEMP = float(os.environ.get("BRAIN_TEMP", "0.2"))
BRAIN_TOP_P = float(os.environ.get("BRAIN_TOP_P", "1.0"))

OPENAI_CHAT_URL = f"{OPENAI_BASE}/v1/chat/completions"

# Visibility at import time (helps detect stale modules/containers)
print("[brain] loaded from:", __file__)
print("[brain] OPENAI_BASE=", OPENAI_BASE)
print("[brain] OPENAI_CHAT_MODEL=", OPENAI_CHAT_MODEL)
print("[brain] BRAIN_TEMP=", BRAIN_TEMP)

def _clamp(s: str, max_chars: int) -> str:
    if not s:
        return ""
    return s if len(s) <= max_chars else (s[: max_chars - 1] + "…")

# Very light language hint only for fallback phrasing
_BENGALI = re.compile(r"[\u0980-\u09FF]")
def _guess_lang(text: str) -> str:
    return "bn" if _BENGALI.search(text or "") else "en"

def _safe_snip(s: str | bytes, n: int = 800) -> str:
    """Trim long debug strings safely for logs."""
    if s is None:
        return ""
    if isinstance(s, bytes):
        try:
            s = s.decode("utf-8", errors="replace")
        except Exception:
            s = str(s)
    return s if len(s) <= n else (s[:n] + "…")

# --------------------------- Message Build ---------------------------

# One permanent system line: ask for strict JSON. (Behavior lives in fine-tune.)
_SYSTEM = (
    "Return ONLY a single valid JSON object with keys: "
    'replyText, intent, language, and optional items[], notes. No markdown.'
)

def _build_user_content(
    transcript: str,
    menu_snapshot: Optional[Dict[str, Any]],
) -> str:
    """
    User content = raw transcript + compact optional menu hint.
    - This is runtime grounding (live data), not behavior.
    - Deterministic slice: sort by name, include aliases, cap at 120.
    """
    base = (transcript or "").strip()
    if not menu_snapshot:
        return base

    try:
        items_src = sorted(
            (menu_snapshot.get("items") or []),
            key=lambda z: (z.get("name") or "").lower()
        )

        compact = {
            "categories": [
                {"id": c.get("id"), "name": c.get("name")}
                for c in (menu_snapshot.get("categories") or [])[:8]
            ],
            "items": [
                {
                    "id": i.get("id") or i.get("_id"),
                    "name": i.get("name"),
                    "price": i.get("price"),
                    "aliases": i.get("aliases") or [],
                    "categoryIds": (i.get("categoryIds") or [])[:2],
                }
                for i in items_src[:120]
            ],
        }
        hint = json.dumps(compact, ensure_ascii=False)
    except Exception:
        hint = ""

    return f"{base}\n\n[MenuHint]: {hint}" if hint else base

# --------------------------- OpenAI Call ---------------------------

async def _call_openai(messages: List[Dict[str, str]]) -> str:
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
        "stream": False,
        # ✅ Force a single valid JSON object from the model
        "response_format": {"type": "json_object"},
    }

    # Debug visibility of outbound call (truncated)
    try:
        print("[brain] >>>", _safe_snip(json.dumps(payload, ensure_ascii=False)))
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=BRAIN_TIMEOUT_S) as client:
        r = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)

    # Debug visibility of inbound response (status + truncated body)
    print("[brain] HTTP", r.status_code)
    print("[brain] <<<", _safe_snip(r.text))

    r.raise_for_status()
    data = r.json()

    # Defensive extract
    return (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()

# ------------------------ JSON Parse Helpers ------------------------

_JSON_FIRST_OBJECT = re.compile(r"\{.*\}", re.DOTALL)

def _parse_model_json(text: str) -> Dict[str, Any]:
    """
    Parse a single JSON object from model text. If the model added stray text,
    grab the first {...} block.
    """
    candidate = text
    if not text.startswith("{"):
        m = _JSON_FIRST_OBJECT.search(text)
        if not m:
            raise ValueError("No JSON object found in model response")
        candidate = m.group(0)
    obj = json.loads(candidate)
    if not isinstance(obj, dict):
        raise ValueError("Top-level JSON is not an object")
    return obj

# ----------------------------- Public API -----------------------------

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
    Thin adapter:
    - clamp transcript
    - send transcript + optional menu hint to the fine-tuned model
    - expect strict JSON back
    - return reply + small meta (no business logic here)
    """
    transcript = _clamp(transcript or "", 2000)
    if not transcript:
        lang = "en"
        return {
            "replyText": "Sorry, I didn’t catch that. Could you say that again?",
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "language": lang,
                "tenant": tenant, "branch": branch, "channel": channel,
                "conversationId": conversation_id, "userId": user_id,
                "fallback": True,
            },
        }

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _build_user_content(transcript, menu_snapshot)},
    ]

    try:
        raw = await _call_openai(messages)
        obj = _parse_model_json(raw)

        # Minimal normalization
        reply_text = str(obj.get("replyText") or "").strip()
        language = (obj.get("language") or "").strip() or _guess_lang(reply_text or transcript)
        intent = (obj.get("intent") or "").strip() or "chitchat"

        return {
            "replyText": reply_text,
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "language": language,
                "intent": intent,
                "items": obj.get("items"),
                "notes": obj.get("notes"),
                "tenant": tenant, "branch": branch, "channel": channel,
                "conversationId": conversation_id, "userId": user_id,
                "fallback": False,
            },
        }

    except Exception as e:
        # Graceful network/parse fallback (language hint from input)
        lang = _guess_lang(transcript)
        text = "দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?" if lang == "bn" \
               else "Sorry, I’m having trouble. Could you try once more?"
        return {
            "replyText": text,
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "language": lang,
                "tenant": tenant, "branch": branch, "channel": channel,
                "conversationId": conversation_id, "userId": user_id,
                "error": str(e),
                "fallback": True,
            },
        }

__all__ = ["generate_reply"]
