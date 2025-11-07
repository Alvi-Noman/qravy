"""
Upgraded Qravy AI Waiter brain.

Key properties:
- Single LLM call (no extra hops).
- Server passes:
    - transcript
    - optional menu_snapshot
    - optional dialog_state
    - NEW: optional context
    - NEW: optional suggestion_candidates
    - NEW: optional upsell_candidates
- Model must:
    - classify intent
    - pick items ONLY from provided candidates
    - output a SINGLE JSON object.

Expected model output (single JSON object):

{
  "replyText": "string",
  "intent": "order|menu|suggestions|chitchat",
  "language": "bn|en",
  "items": [
    { "name": "Cheesy Fries", "itemId": "item_123", "quantity": 1 }
  ],  # optional, for intent=order
  "suggestions": [
    {
      "title": "Cheesy Fries",
      "subtitle": "Crispy fries with cheese",
      "itemId": "item_123",
      "categoryId": "cat_sides",
      "price": 220
    }
  ],  # optional
  "upsell": [
    {
      "title": "Coke",
      "itemId": "item_999",
      "price": 60
    }
  ],  # optional
  "decision": {
    "showSuggestionsModal": true,
    "showUpsellTray": false
  },  # optional
  "notes": "optional free-form notes"
}

The adapter below:
- Enforces the contract via system message + response_format=json_object.
- Validates + normalizes the model output:
    - intent → canonical WaiterIntent-like set.
    - items/suggestions/upsell restricted to provided candidate lists when present.
    - canonicalizes item names using menu_snapshot.
- Returns:
    {
      "replyText": str,
      "meta": {
        "model": ...,
        "language": ...,
        "intent": ...,
        "items": [...],
        "suggestions": [...],
        "upsell": [...],
        "decision": {...},
        ...debug/ctx info...
      }
    }
"""

from __future__ import annotations

import os
import json
import re
from typing import Any, Dict, Optional, List, Tuple

import httpx

# --------------------------- Configuration ---------------------------

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4.1-mini").strip()

BRAIN_MAX_TOKENS = int(os.environ.get("BRAIN_MAX_TOKENS", "1024"))
BRAIN_TIMEOUT_S = float(os.environ.get("BRAIN_TIMEOUT_S", "8.0"))
BRAIN_TEMP = float(os.environ.get("BRAIN_TEMP", "0.2"))
BRAIN_TOP_P = float(os.environ.get("BRAIN_TOP_P", "1.0"))

OPENAI_CHAT_URL = f"{OPENAI_BASE}/v1/chat/completions"

print("[brain] loaded from:", __file__)
print("[brain] OPENAI_BASE=", OPENAI_BASE)
print("[brain] OPENAI_CHAT_MODEL=", OPENAI_CHAT_MODEL)
print("[brain] BRAIN_TEMP=", BRAIN_TEMP)

# --------------------------- Small utils ---------------------------


def _clamp(s: str, max_chars: int) -> str:
    if not s:
        return ""
    return s if len(s) <= max_chars else (s[: max_chars - 1] + "…")


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


# --------------------------- Candidate helpers ---------------------------


def _normalize_id(raw: Any) -> str:
    return str(raw).strip() if raw is not None else ""


def _build_candidate_index(
    suggestion_candidates: Optional[List[Dict[str, Any]]],
    upsell_candidates: Optional[List[Dict[str, Any]]],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    """
    Build:
      by_id: itemId -> candidate dict (from suggestion/upsell pools)
      name_to_id: normalized name -> itemId
    These define the ONLY valid target items when candidates are provided.
    """
    by_id: Dict[str, Dict[str, Any]] = {}
    name_to_id: Dict[str, str] = {}

    def ingest_one(c: Dict[str, Any]):
        item_id = _normalize_id(
            c.get("itemId") or c.get("id") or c.get("_id")
        )
        title = (c.get("title") or c.get("name") or "").strip()
        if not item_id:
            return
        if item_id not in by_id:
            by_id[item_id] = c
        # Name → id map (shortlists small; first wins)
        if title:
            key = title.lower()
            if key and key not in name_to_id:
                name_to_id[key] = item_id

    for src in (suggestion_candidates or []):
        ingest_one(src)
    for src in (upsell_candidates or []):
        ingest_one(src)

    return by_id, name_to_id


# ----------------------- Menu canonicalization helpers -----------------------


def _build_menu_maps(menu_snapshot: Optional[Dict[str, Any]]):
    """
    Build lookup maps from the full menu snapshot:
      id -> canonical name
      lower(name/alias) -> id
      id -> aliases (including its own name)
    """
    id_to_name: Dict[str, str] = {}
    token_to_id: Dict[str, str] = {}
    id_to_aliases: Dict[str, List[str]] = {}

    if not menu_snapshot:
        return id_to_name, token_to_id, id_to_aliases

    for it in (menu_snapshot.get("items") or []):
        _id = _normalize_id(it.get("id") or it.get("_id"))
        name = (it.get("name") or "").strip()
        if not _id or not name:
            continue

        aliases = (it.get("aliases") or [])[:]
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
    Replace any mentioned item aliases in reply_text with their canonical menu names.
    Only uses items[] that survived validation.
    """
    if not reply_text or not menu_snapshot or not model_items:
        return reply_text

    try:
        id_to_name, _, id_to_aliases = _build_menu_maps(menu_snapshot)
        if not id_to_name:
            return reply_text

        intended_ids: List[str] = []
        for it in model_items:
            _id = _normalize_id(it.get("itemId"))
            if _id and _id in id_to_name:
                intended_ids.append(_id)

        if not intended_ids:
            return reply_text

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
        return reply_text


# -------------------- Dialog State Helper ----------------------


def _build_state_line(dialog_state: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    """
    Tiny synthetic 'system' message carrying [DialogState] if provided.
    """
    if not dialog_state:
        return None
    try:
        blob = json.dumps(dialog_state, ensure_ascii=False)
        return {"role": "system", "content": f"[DialogState]: {blob}"}
    except Exception:
        return None


# -------------------- Language helpers & system prompt ----------------------


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
    """
    System message:
    - Describes strict JSON contract.
    - Explains candidates & constraints.
    - Adds language directive.
    """
    directive = _LANG_DIRECTIVE.get(
        lang_hint,
        "Mirror the user's language and do not switch mid-conversation.",
    )

    return (
        "You are the Qravy AI Waiter brain. "
        "You receive a single [INPUT] JSON from the server with keys like: "
        "userTranscript, Context, SuggestionCandidates, UpsellCandidates, MenuHint. "
        "Context may include timeOfDay, climate, channel, tenant, branch, languageHint, lastIntent, etc. "
        "Use Context to adapt your reply (e.g., lighter items in hot weather, breakfast items in the morning). "
        "Use SuggestionCandidates and UpsellCandidates as the ONLY allowed pools when proposing items, "
        "suggestions, upsells, or filling items[]. Never invent new items or IDs. "
        "Always respect channel, visibility, and availability implied by the candidates. "
        "Your entire reply MUST be exactly one valid JSON object with this shape: "
        "{"
        "\"replyText\": string (≤ 280 chars), "
        "\"intent\": \"order\"|\"menu\"|\"suggestions\"|\"chitchat\", "
        "\"language\": \"bn\"|\"en\", "
        "\"items\": ["
        "  {\"name\": string, \"itemId\": string, \"quantity\": integer >=1}"
        "],  /* optional, for order */ "
        "\"suggestions\": ["
        "  {\"title\": string, \"subtitle\"?: string, \"itemId\"?: string, \"categoryId\"?: string, \"price\"?: number}"
        "],  /* optional */ "
        "\"upsell\": ["
        "  {\"title\": string, \"subtitle\"?: string, \"itemId\"?: string, \"categoryId\"?: string, \"price\"?: number}"
        "],  /* optional */ "
        "\"decision\": {"
        "  \"showSuggestionsModal\"?: boolean, "
        "  \"showUpsellTray\"?: boolean"
        "},  /* optional */ "
        "\"notes\"?: string  /* optional */ "
        "}. "
        "If the request is about choosing or recommending items, use intent=\"suggestions\". "
        "If it's casual talk, use intent=\"chitchat\". "
        "If it clearly specifies items to add, use intent=\"order\". "
        + directive
    )


# -------------------- User/content payload builder ----------------------


def _build_menu_hint(menu_snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Compact, deterministic slice of menu for extra grounding (not required).
    """
    if not menu_snapshot:
        return None

    try:
        items_src = sorted(
            (menu_snapshot.get("items") or []),
            key=lambda z: (z.get("name") or "").lower(),
        )

        compact = {
            "categories": [
                {"id": c.get("id") or c.get("_id"), "name": c.get("name")}
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
        return compact
    except Exception:
        return None


def _build_user_input_payload(
    transcript: str,
    context: Optional[Dict[str, Any]],
    suggestion_candidates: Optional[List[Dict[str, Any]]],
    upsell_candidates: Optional[List[Dict[str, Any]]],
    menu_snapshot: Optional[Dict[str, Any]],
) -> str:
    """
    Build the single [INPUT] JSON payload given to the model as user content.
    This is where we pass candidates and optional menu hint.
    """
    payload: Dict[str, Any] = {
        "userTranscript": (transcript or "").strip(),
    }

    if context:
        payload["Context"] = context

    if suggestion_candidates:
        payload["SuggestionCandidates"] = suggestion_candidates

    if upsell_candidates:
        payload["UpsellCandidates"] = upsell_candidates

    menu_hint = _build_menu_hint(menu_snapshot)
    if menu_hint:
        payload["MenuHint"] = menu_hint

    return json.dumps(payload, ensure_ascii=False)


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
        "response_format": {"type": "json_object"},
    }

    try:
        print("[brain] >>>", _safe_snip(json.dumps(payload, ensure_ascii=False)))
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=BRAIN_TIMEOUT_S) as client:
        r = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)

    print("[brain] HTTP", r.status_code)
    print("[brain] <<<", _safe_snip(r.text))

    r.raise_for_status()
    data = r.json()

    return (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )


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


# ------------------------ Normalization helpers ------------------------


def _normalize_intent(raw: Any, has_items: bool) -> str:
    r = (str(raw or "")).strip().lower()

    intent_map = {
        "order_food": "order",
        "add_to_cart": "order",
        "place_order": "order",
        "confirm_order": "order",

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

    if r in intent_map:
        r = intent_map[r]

    if r == "menu" and has_items:
        r = "suggestions"

    if r not in {"order", "menu", "suggestions", "chitchat"}:
        if has_items:
            r = "order"
        else:
            r = "chitchat"

    return r


def _normalize_items(
    raw_items: Any,
    cand_by_id: Dict[str, Dict[str, Any]],
    cand_name_to_id: Dict[str, str],
    max_items: int = 24,
) -> List[Dict[str, Any]]:
    """
    Normalize items[] using candidate index when available.
    - Only keep items that map to a candidate ID when candidates exist.
    - If no candidates provided, we accept any non-empty name/itemId.
    """
    if not raw_items or not isinstance(raw_items, list):
        return []

    out: List[Dict[str, Any]] = []
    seen_ids = set()
    have_candidates = bool(cand_by_id)

    for it in raw_items:
        if not isinstance(it, dict):
            continue

        name = (it.get("name") or "").strip()
        item_id = _normalize_id(it.get("itemId"))

        if have_candidates:
            if item_id and item_id in cand_by_id:
                cid = item_id
            elif name:
                cid = cand_name_to_id.get(name.lower())
            else:
                cid = ""
            if not cid:
                continue
            item_id = cid
            cand = cand_by_id.get(cid) or {}
            if not name:
                name = (cand.get("title") or cand.get("name") or "").strip()
        else:
            if not (name or item_id):
                continue

        if item_id in seen_ids:
            continue

        qty_raw = it.get("quantity", 1)
        try:
            qty = int(qty_raw)
            if qty <= 0:
                qty = 1
        except Exception:
            qty = 1

        out.append(
            {
                "name": name or item_id,
                "itemId": item_id,
                "quantity": qty,
            }
        )
        seen_ids.add(item_id)

        if len(out) >= max_items:
            break

    return out


def _normalize_suggestion_like_list(
    raw_list: Any,
    cand_by_id: Dict[str, Dict[str, Any]],
    cand_name_to_id: Dict[str, str],
    max_len: int = 8,
) -> List[Dict[str, Any]]:
    """
    Normalize suggestions[] or upsell[] arrays:
    - Snap itemId/title/categoryId/price to candidate data when possible.
    - Only keep entries resolvable to a candidate when candidates exist.
    """
    if not raw_list or not isinstance(raw_list, list):
        return []

    out: List[Dict[str, Any]] = []
    seen_ids = set()
    have_candidates = bool(cand_by_id)

    for it in raw_list:
        if not isinstance(it, dict):
            continue

        title = (it.get("title") or it.get("name") or "").strip()
        item_id = _normalize_id(it.get("itemId"))
        category_id = _normalize_id(it.get("categoryId"))
        price = it.get("price")
        subtitle = (it.get("subtitle") or "").strip()

        cand = None
        resolved_id = ""

        if have_candidates:
            if item_id and item_id in cand_by_id:
                resolved_id = item_id
            elif title:
                resolved_id = cand_name_to_id.get(title.lower(), "")
            if resolved_id:
                cand = cand_by_id.get(resolved_id)
            else:
                # Unresolvable when candidates exist -> drop
                continue
        else:
            if not title:
                continue

        if cand:
            resolved_id = _normalize_id(
                cand.get("itemId") or cand.get("id") or cand.get("_id")
            )
            if not resolved_id:
                continue
            if resolved_id in seen_ids:
                continue

            if not title:
                title = (cand.get("title") or cand.get("name") or "").strip()
            if not category_id:
                category_id = _normalize_id(
                    cand.get("categoryId")
                    or (cand.get("categoryIds") or [None])[0]
                )
            if price in (None, ""):
                price = cand.get("price")

            item_id = resolved_id

        if have_candidates and not item_id:
            continue

        row: Dict[str, Any] = {
            "title": title or (item_id or ""),
        }
        if subtitle:
            row["subtitle"] = subtitle
        if item_id:
            row["itemId"] = item_id
        if category_id:
            row["categoryId"] = category_id
        if isinstance(price, (int, float)) and price >= 0:
            row["price"] = price

        out.append(row)
        if item_id:
            seen_ids.add(item_id)

        if len(out) >= max_len:
            break

    return out


def _normalize_decision(raw: Any, has_suggestions: bool, has_upsell: bool) -> Dict[str, bool]:
    if not isinstance(raw, dict):
        raw = {}

    show_suggestions = raw.get("showSuggestionsModal")
    show_upsell = raw.get("showUpsellTray")

    if not isinstance(show_suggestions, bool):
        show_suggestions = bool(has_suggestions)

    if not isinstance(show_upsell, bool):
        show_upsell = bool(has_upsell)

    return {
        "showSuggestionsModal": show_suggestions,
        "showUpsellTray": show_upsell,
    }


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
    history: Optional[List[Dict[str, str]]] = None,
    dialog_state: Optional[Dict[str, Any]] = None,
    # NEW: rich orchestration inputs (all optional for backward-compat)
    context: Optional[Dict[str, Any]] = None,
    suggestion_candidates: Optional[List[Dict[str, Any]]] = None,
    upsell_candidates: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Thin-but-strict adapter:
    - Clamp transcript.
    - Build messages: system + optional DialogState + history + [INPUT] JSON.
    - Call model with response_format=json_object.
    - Normalize + validate output into (replyText, meta).
    """
    transcript = _clamp(transcript or "", 2000)
    if not transcript:
        lang = "en"
        return {
            "replyText": "Sorry, I didn’t catch that. Could you say that again?",
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "language": lang,
                "intent": "chitchat",
                "items": [],
                "suggestions": [],
                "upsell": [],
                "decision": {
                    "showSuggestionsModal": False,
                    "showUpsellTray": False,
                },
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "fallback": True,
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {}),
            },
        }

    lang_hint = _resolve_lang_hint(locale, transcript)

    # Build candidate index from server shortlists
    cand_by_id, cand_name_to_id = _build_candidate_index(
        suggestion_candidates, upsell_candidates
    )

    # System message
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": _build_system_with_lang(lang_hint)}
    ]

    # Optional DialogState as separate system line
    state_line = _build_state_line(dialog_state)
    if state_line:
        messages.append(state_line)

    # Recent compact history
    if history:
        for t in history[-8:]:
            r = t.get("role")
            c = (t.get("content") or "").strip()
            if r in ("user", "assistant") and c:
                messages.append({"role": r, "content": c})

    # Single INPUT for this turn
    user_payload = _build_user_input_payload(
        transcript=transcript,
        context=context,
        suggestion_candidates=suggestion_candidates,
        upsell_candidates=upsell_candidates,
        menu_snapshot=menu_snapshot,
    )
    messages.append({"role": "user", "content": f"[INPUT]: {user_payload}"})

    try:
        raw = await _call_openai(messages)
        obj = _parse_model_json(raw)

        # ---- Extract core fields ----
        reply_text = str(obj.get("replyText") or "").strip()
        language = (obj.get("language") or "").strip() or _guess_lang(
            reply_text or transcript
        )

        # Honor fixed lang hint
        if lang_hint in ("bn", "en"):
            language = lang_hint

        # Normalize lists against candidates (if provided)
        items = _normalize_items(
            obj.get("items"),
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
        )

        suggestions = _normalize_suggestion_like_list(
            obj.get("suggestions"),
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
        )

        upsell = _normalize_suggestion_like_list(
            obj.get("upsell"),
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
        )

        # Intent
        intent = _normalize_intent(obj.get("intent"), has_items=bool(items))

        # Decision / UI hints
        decision = _normalize_decision(
            obj.get("decision"),
            has_suggestions=bool(suggestions),
            has_upsell=bool(upsell),
        )

        # Canonicalize reply text item mentions based on validated items[]
        reply_text = _canonicalize_reply_text(
            reply_text=reply_text,
            model_items=items,
            menu_snapshot=menu_snapshot,
        )

        # Fallback reply text if model was empty
        if not reply_text:
            if intent == "order" and items:
                reply_text = (
                    "Got it, I’ve added that to your order."
                    if language == "en"
                    else "ঠিক আছে, আপনার অর্ডারে যুক্ত করেছি।"
                )
            elif intent == "suggestions" and suggestions:
                reply_text = (
                    "Here are some options I recommend."
                    if language == "en"
                    else "এই কিছু আইটেম আমি সাজেস্ট করছি।"
                )
            else:
                reply_text = (
                    "Sorry, I didn’t catch that clearly. Could you say that again?"
                    if language == "en"
                    else "দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন?"
                )

        return {
            "replyText": reply_text,
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "language": language,
                "intent": intent,
                "items": items,
                "suggestions": suggestions,
                "upsell": upsell,
                "decision": decision,
                "notes": obj.get("notes"),
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "fallback": False,
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {}),
                "hasCandidates": bool(cand_by_id),
                "contextSnapshot": context or None,  # 👈 debug: what the model saw
            },
        }

    except Exception as e:
        # Graceful fallback
        lang = _guess_lang(transcript)
        text = (
            "দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?"
            if lang == "bn"
            else "Sorry, I’m having trouble. Could you try once more?"
        )
        return {
            "replyText": text,
            "meta": {
                "model": OPENAI_CHAT_MODEL,
                "language": lang,
                "intent": "chitchat",
                "items": [],
                "suggestions": [],
                "upsell": [],
                "decision": {
                    "showSuggestionsModal": False,
                    "showUpsellTray": False,
                },
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "error": str(e),
                "fallback": True,
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {}),
                "hasCandidates": bool(
                    suggestion_candidates or upsell_candidates
                ),
            },
        }


__all__ = ["generate_reply"]
