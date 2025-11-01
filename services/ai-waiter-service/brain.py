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
    "replyText, intent, language, and optional items[], notes. "
    "Valid intents: order | menu | suggestions | chitchat. "
    "For intent 'order', include items as an array of objects with "
    "{name, itemId?, quantity?}. When you can match to [MenuHint], include itemId. "
    "When referring to menu items, always use the exact 'name' field from [MenuHint] if available. "
    "Intent policy: (a) price or availability questions → intent='chitchat'; "
    "(b) general requests to show/see the menu or what's on the menu → intent='menu'; "
    "(c) category-specific or option-listing replies (e.g., 'what desserts do you have') → intent='suggestions' and include items[]; "
    "(d) everything else → 'chitchat'. "
    "No markdown."
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

# ----------------------- Canonical Name Helpers -----------------------

def _build_menu_maps(menu_snapshot: Optional[Dict[str, Any]]):
    """
    Build lookup maps:
      id -> canonical name
      lower(name/alias) -> id
      id -> aliases (including its own name for replacement sweep)
    """
    id_to_name: Dict[str, str] = {}
    token_to_id: Dict[str, str] = {}
    id_to_aliases: Dict[str, List[str]] = {}

    if not menu_snapshot:
        return id_to_name, token_to_id, id_to_aliases

    for it in (menu_snapshot.get("items") or []):
        _id = str(it.get("id") or it.get("_id") or "")
        name = (it.get("name") or "").strip()
        if not _id or not name:
            continue
        aliases = (it.get("aliases") or [])[:]
        # include the canonical name itself as an alias for replacement logic
        all_aliases = list({name, *aliases})

        id_to_name[_id] = name
        id_to_aliases[_id] = all_aliases

        for tok in all_aliases:
            t = (tok or "").strip().lower()
            if t:
                token_to_id[t] = _id

    return id_to_name, token_to_id, id_to_aliases

def _find_id_for_name(name: Optional[str], token_to_id: Dict[str, str]) -> Optional[str]:
    if not name:
        return None
    return token_to_id.get(name.strip().lower())

def _canonicalize_reply_text(
    reply_text: str,
    model_items: Optional[List[Dict[str, Any]]],
    menu_snapshot: Optional[Dict[str, Any]],
) -> str:
    """
    Replace any mentioned item names/aliases in reply_text with the menu's
    canonical/original 'name' (e.g., Cheesy Fries), so Bangla transliterations
    are shown in canonical form inside otherwise Bangla sentences.
    """
    if not reply_text or not menu_snapshot:
        return reply_text

    id_to_name, token_to_id, id_to_aliases = _build_menu_maps(menu_snapshot)
    if not id_to_name:
        return reply_text

    # Figure out which canonical items the model intended
    intended_ids: List[str] = []

    for it in (model_items or []):
        _id = str(it.get("itemId") or "").strip()
        nm = (it.get("name") or "").strip()
        if _id and _id in id_to_name:
            intended_ids.append(_id)
            continue
        if not _id and nm:
            guess = _find_id_for_name(nm, token_to_id)
            if guess:
                intended_ids.append(guess)

    if not intended_ids:
        return reply_text

    # For each intended item, replace any alias occurrences with canonical name
    out = reply_text
    for _id in intended_ids:
        canonical = id_to_name.get(_id)
        if not canonical:
            continue
        aliases = id_to_aliases.get(_id, [])
        # include the model-provided name as an alias candidate too
        # (covers cases where model minted a slight variant)
        for alias in aliases:
            a = (alias or "").strip()
            if not a or a == canonical:
                continue
            # case-insensitive replace; keep it simple to work with Bengali too
            pattern = re.compile(re.escape(a), flags=re.IGNORECASE)
            out = pattern.sub(canonical, out)
    return out

# -------------------- Infer items from LLM text ----------------------

def _infer_items_from_reply_text(reply_text: str, menu_snapshot: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    LLM-first inference: if the model listed concrete item names in reply_text
    but forgot to fill items[], detect canonical names using the MenuHint.
    No keyword rules; we match against canonical item names from the snapshot.
    """
    if not reply_text or not menu_snapshot:
        return []
    id_to_name, _, _ = _build_menu_maps(menu_snapshot)
    if not id_to_name:
        return []
    hay = reply_text.lower()
    hits: List[Dict[str, Any]] = []
    for _id, canon in id_to_name.items():
        name_l = (canon or "").strip().lower()
        if name_l and name_l in hay:
            hits.append({"name": canon, "itemId": _id, "quantity": 1})
            if len(hits) >= 24:
                break
    # dedupe by itemId
    seen = set()
    out = []
    for h in hits:
        k = h.get("itemId")
        if k and k not in seen:
            out.append(h)
            seen.add(k)
    return out

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

        # If the model forgot items[], infer from reply_text using MenuHint (LLM-first, no keywords)
        model_items = obj.get("items")
        if not model_items:
            inferred = _infer_items_from_reply_text(reply_text, menu_snapshot)
            if inferred:
                obj["items"] = inferred
                model_items = inferred

        # 🔧 Normalize intent to canonical 4 (base on LLM label)
        intent_raw = (obj.get("intent") or "").strip().lower()
        intent_map = {
            "order_food": "order",
            "add_to_cart": "order",
            "place_order": "order",

            # availability/price checks are *not* menu
            "availability_check": "chitchat",
            "availability": "chitchat",
            "in_stock": "chitchat",
            "have_it": "chitchat",
            "price_check": "chitchat",
            "price": "chitchat",
            "cost": "chitchat",
            "how_much": "chitchat",

            "menuinquiry": "menu",
            "menu_inquiry": "menu",
            "menu_query": "menu",
            "show_menu": "menu",
            "see_menu": "menu",

            "recommendation": "suggestions",
            "recommendations": "suggestions",
            "recommend": "suggestions",
            "recs": "suggestions",
        }
        intent = intent_map.get(intent_raw, intent_raw or "chitchat")

        # If the model labeled 'menu' but actually enumerated concrete items (either returned or inferred),
        # treat this as 'suggestions' so the client shows the SuggestionsModal and not just /menu.
        if intent == "menu" and model_items:
            intent = "suggestions"

        if intent not in {"order", "menu", "suggestions", "chitchat"}:
            intent = "chitchat"

        # ✅ Canonicalize any item names inside reply_text to menu's original names
        reply_text = _canonicalize_reply_text(
            reply_text=reply_text,
            model_items=obj.get("items"),
            menu_snapshot=menu_snapshot,
        )

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
