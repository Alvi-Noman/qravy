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

# ✅ Increased defaults
BRAIN_MAX_TOKENS = int(os.environ.get("BRAIN_MAX_TOKENS", "1024"))
BRAIN_TIMEOUT_S = float(os.environ.get("BRAIN_TIMEOUT_S", "8.0"))
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

# ✅ Base system instruction (kept for reference; actual content built per language below)
_SYSTEM = (
    "Return ONLY a single valid JSON object with keys: replyText, intent, language, and optional items[], notes. "
    "Valid intents: order | menu | suggestions | chitchat. "
    "For intent 'order', include items as an array of up to 8 objects. "
    "Do NOT list the full menu. replyText must be ≤ 280 characters."
)

# ✅ Language-resolving helpers
def _resolve_lang_hint(locale: Optional[str], transcript: str) -> str:
    """
    Normalize the desired language:
      - 'bn' or 'en' → fixed language
      - 'auto' / None → infer from current transcript
    """
    v = (locale or "").strip().lower()
    if v in ("bn", "en"):
        return v
    return _guess_lang(transcript)

_LANG_DIRECTIVE = {
    "bn": "Respond ONLY in Bangla (Bengali).",
    "en": "Respond ONLY in English.",
}

def _build_system_with_lang(lang_hint: str) -> str:
    directive = _LANG_DIRECTIVE.get(
        lang_hint,
        "Mirror the user's language and do not switch mid-conversation."
    )
    return (
        "Return ONLY a single valid JSON object with keys: replyText, intent, language, and optional items[], notes. "
        "Valid intents: order | menu | suggestions | chitchat. "
        "For intent 'order', include items as an array of up to 8 objects. "
        "Do NOT list the full menu. replyText must be ≤ 280 characters. "
        + directive
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

# ------------- Dialog State Helper (compact, JSON-only, optional) -------------
def _build_state_line(dialog_state: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    """
    Return a tiny synthetic 'system' message carrying [DialogState] if provided.
    The model is instructed in _SYSTEM to use it when present.
    """
    if not dialog_state:
        return None
    try:
        blob = json.dumps(dialog_state, ensure_ascii=False)
        return {"role": "system", "content": f"[DialogState]: {blob}"}
    except Exception:
        return None

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
    return token_to_id.get((name or "").strip().lower())

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

    # ✅ Make canonicalization safe
    try:
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
            for alias in aliases:
                a = (alias or "").strip()
                if not a or a == canonical:
                    continue
                pattern = re.compile(re.escape(a), flags=re.IGNORECASE)
                out = pattern.sub(canonical, out)
        return out
    except Exception:
        # If anything goes wrong, fall back to the original text unchanged
        return reply_text

# -------------------- Infer items from LLM text ----------------------

def _infer_items_from_reply_text(reply_text: str, menu_snapshot: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    LLM-first inference: if the model listed concrete item names in reply_text
    but forgot to fill items[], detect canonical names using the MenuHint.
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
    history: Optional[List[Dict[str, str]]] = None,        # ✅ existing
    dialog_state: Optional[Dict[str, Any]] = None,          # ✅ NEW
) -> Dict[str, Any]:
    """
    Thin adapter:
    - clamp transcript
    - build chat messages from optional history + optional dialog_state + current turn (+ MenuHint)
    - call model expecting strict JSON
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
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {}),
            },
        }

    # ✅ Build messages with hard language directive
    lang_hint = _resolve_lang_hint(locale, transcript)

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": _build_system_with_lang(lang_hint)}
    ]

    state_line = _build_state_line(dialog_state)
    if state_line:
        messages.append(state_line)

    if history:
        # keep last 8 short turns; earlier turns should be summarized server-side
        for t in history[-8:]:
            r = t.get("role")
            c = (t.get("content") or "").strip()
            if r in ("user", "assistant") and c:
                messages.append({"role": r, "content": c})

    messages.append({"role": "user", "content": _build_user_content(transcript, menu_snapshot)})

    try:
        raw = await _call_openai(messages)
        obj = _parse_model_json(raw)

        reply_text = str(obj.get("replyText") or "").strip()
        language = (obj.get("language") or "").strip() or _guess_lang(reply_text or transcript)

        # ✅ If caller forced a language (bn/en), honor it in meta & nudge consistency
        if lang_hint in ("bn", "en"):
            language = lang_hint

        # If the model forgot items[], infer from reply_text using MenuHint
        model_items = obj.get("items")
        if not model_items:
            inferred = _infer_items_from_reply_text(reply_text, menu_snapshot)
            if inferred:
                obj["items"] = inferred
                model_items = inferred

        # Normalize intent to canonical 4
        intent_raw = (obj.get("intent") or "").strip().lower()
        intent_map = {
            "order_food": "order",
            "add_to_cart": "order",
            "place_order": "order",

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
        if intent == "menu" and model_items:
            intent = "suggestions"
        if intent not in {"order", "menu", "suggestions", "chitchat"}:
            intent = "chitchat"

        # Canonicalize any item names in reply_text to menu originals
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
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {}),
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
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {}),
                "fallback": True,
            },
        }

__all__ = ["generate_reply"]
