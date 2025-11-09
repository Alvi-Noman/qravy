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

# Lightweight intent-classifier model (can override separately)
INTENT_MODEL = os.environ.get("OPENAI_INTENT_MODEL", OPENAI_CHAT_MODEL).strip()
INTENT_MAX_TOKENS = int(os.environ.get("INTENT_MAX_TOKENS", "32"))
INTENT_TIMEOUT_S = float(os.environ.get("INTENT_TIMEOUT_S", "2.0"))
INTENT_CONF_THRESHOLD = float(os.environ.get("INTENT_CONF_THRESHOLD", "0.6"))

OPENAI_CHAT_URL = f"{OPENAI_BASE}/v1/chat/completions"

print("[brain] loaded from:", __file__)
print("[brain] OPENAI_BASE=", OPENAI_BASE)
print("[brain] OPENAI_CHAT_MODEL=", OPENAI_CHAT_MODEL)
print("[brain] BRAIN_TEMP=", BRAIN_TEMP)
print("[brain] INTENT_MODEL=", INTENT_MODEL)

# --------------------------- Small utils ---------------------------


def _clamp(s: str, max_chars: int) -> str:
    if not s:
        return ""
    return s if len(s) <= max_chars else (s[: max_chars - 1] + "…")


_BENGALI = re.compile(r"[\u0980-\u09FF]")
_LATIN = re.compile(r"[A-Za-z]")


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


def _is_very_short_turn(transcript: str) -> bool:
    """
    Language-agnostic structural heuristic:
    Treat extremely short user turns as non-committal (often greetings/politeness).
    """
    return len((transcript or "").strip()) <= 24


def _is_price_or_availability_query(transcript: str) -> bool:
    """
    Lightweight detector for turns primarily about price/availability,
    used to bias toward a 'menu/info' style intent instead of pure chitchat.
    """
    if not transcript:
        return False

    t = (transcript or "").strip().lower()
    if not t or len(t) > 140:
        return False

    has_q = "?" in t

    price_terms = ("price", "how much", "tk", "taka", "টাকা", "দাম")
    avail_terms = ("available", "availability", "in stock", "আছে")

    if any(p in t for p in price_terms) or any(a in t for a in avail_terms):
        return True

    # For Bangla short forms like "মিল্কশেক আছে", also treat as query.
    if not has_q and t.endswith("আছে"):
        return True

    return False


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


def _canonicalize_reply_text(
    reply_text: str,
    model_items: Optional[List[Dict[str, Any]]],
    menu_snapshot: Optional[Dict[str, Any]],
) -> str:
    """
    Replace any mentioned item aliases in replyText with their canonical menu names.
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


def _extract_last_intent(
    context: Optional[Dict[str, Any]],
    dialog_state: Optional[Dict[str, Any]],
) -> Optional[str]:
    """
    Extract a coarse lastIntent signal from context/dialog_state if present.
    """
    for src in (dialog_state, context):
        if isinstance(src, dict):
            v = src.get("lastIntent") or src.get("last_intent")
            if isinstance(v, str) and v.strip():
                return v.strip().lower()
    return None


def _extract_locked_intent(context: Optional[Dict[str, Any]]) -> Optional[str]:
    """
    If upstream already decided a lockedIntent, respect it.
    """
    if not isinstance(context, dict):
        return None
    v = context.get("lockedIntent") or context.get("locked_intent")
    if not isinstance(v, str):
        return None
    v = v.strip().lower()
    if v in ("order", "menu", "suggestions", "chitchat"):
        return v
    return None


# -------------------- Language helpers & system prompt ----------------------


def _resolve_lang_hint(locale: Optional[str], transcript: str) -> str:
    """
    Normalize the desired language:
      - 'bn' or 'en' -> fixed language
      - 'auto' / None -> infer from current transcript
    """
    v = (locale or "").strip().lower()
    if v in ("bn", "en"):
        return v
    return _guess_lang(transcript)


_LANG_DIRECTIVE = {
    "bn": "Respond ONLY in Bangla (Bengali).",
    "en": "Respond ONLY in English.",
}


def _build_system_with_lang(lang_hint: str, locked_intent: Optional[str]) -> str:
    """
    System message:
      - Describes strict JSON contract.
      - Explains candidates & constraints.
      - Adds language directive.
      - Clarifies that lockedIntent (if provided) is final and must be obeyed.
      - Enforces concise outputs.
      - Requires proper Bangla voiceReplyText for Bangla users.
    """
    directive = _LANG_DIRECTIVE.get(
        lang_hint,
        "Mirror the user's language and do not switch mid-conversation.",
    )

    if locked_intent in ("order", "menu", "suggestions", "chitchat"):
        locked_intent_clause = (
            f" The backend has ALREADY decided the intent for this turn as "
            f"\"{locked_intent}\" (lockedIntent). You MUST treat this as FINAL: "
            f"- Set your \"intent\" field to exactly \"{locked_intent}\".\n"
            f"- Make sure replyText, items, suggestions, upsell, and decision are all consistent with \"{locked_intent}\".\n"
            f"- Do NOT contradict or override lockedIntent."
        )
    else:
        locked_intent_clause = (
            " The backend will derive the final intent from the user's request and context. "
            "Your \"intent\" is advisory and may be overridden."
        )

    concision_clause = (
        " Keep replyText short and direct (max 280 chars)."
        " Never list more than 5 items in suggestions or upsell."
        " For menu/availability queries, show a concise subset instead of the full menu."
    )

    return (
        "You are the Qravy AI Waiter brain. "
        "You receive a single [INPUT] JSON from the server with keys like: "
        "userTranscript, Context, SuggestionCandidates, UpsellCandidates, MenuHint. "
        "Context may include timeOfDay, climate, channel, tenant, branch, languageHint, lastIntent, lockedIntent, etc. "
        "Use Context and the provided candidates to propose a helpful reply. "
        "Use SuggestionCandidates and UpsellCandidates as the primary pools when proposing items, "
        "suggestions, or upsells, or filling items[]. "
        "Use ONLY the unified AllowedCandidates (merged shortlist) provided by the backend. "
        "Never invent items outside this set, even if MenuHint.items exist. "
        "Never invent items or IDs outside these provided sets. "
        "Always respect channel, visibility, and availability implied by the candidates. "
        "Your entire reply MUST be exactly one valid JSON object with this shape: "
        "{"
        "\"replyText\": string (<= 280 chars), "
        "\"intent\": \"order\"|\"menu\"|\"suggestions\"|\"chitchat\", "
        "\"language\": \"bn\"|\"en\", "
        "\"items\": ["
        "  {\"name\": string, \"itemId\": string, \"quantity\": integer >=1}"
        "], "
        "\"suggestions\": ["
        "  {\"title\": string, \"subtitle\"?: string, \"itemId\"?: string, \"categoryId\"?: string, \"price\"?: number}"
        "], "
        "\"upsell\": ["
        "  {\"title\": string, \"subtitle\"?: string, \"itemId\"?: string, \"categoryId\"?: string, \"price\"?: number}"
        "], "
        "\"decision\": {"
        "  \"showSuggestionsModal\"?: boolean, "
        "  \"showUpsellTray\"?: boolean"
        "}, "
        "\"cartOps\"?: ["
        "  {"
        "    \"op\": \"add\"|\"set\"|\"delta\"|\"remove\", "
        "    \"itemId\"?: string, "
        "    \"name\"?: string, "
        "    \"quantity\"?: integer, "
        "    \"delta\"?: integer"
        "  }"
        "], "
        "\"clearCart\"?: boolean, "
        "\"notes\"?: string, "
        "\"voiceReplyText\"?: string "
        "}. "
        "For Bangla users (language=\"bn\"), UI item names in replyText MUST remain exactly as in candidates/menu (English or mixed) "
        "so that they match the real menu. "
        "In addition, when language=\"bn\" you MUST ALWAYS provide \"voiceReplyText\" as a natural Bangla-script reading of the FULL replyText, "
        "including phonetic Bangla spellings for any English menu item names (e.g. \"Chicken Pesto Pasta\" → \"চিকেন পেস্তো পাস্তা\"). "
        "Do NOT leave Latin characters inside voiceReplyText for Bangla; do NOT translate or rename items—only transcribe them phonetically into Bangla script. "
        "Examples (language=\"bn\"): "
        " 1) replyText: \"আপনার জন্য Chicken Burger ভালো অপশন।\" "
        "    voiceReplyText: \"আপনার জন্য চিকেন বার্গার ভালো অপশন।\" "
        " 2) replyText: \"Kids-এর জন্য Pesto Pasta ট্রাই করতে পারেন।\" "
        "    voiceReplyText: \"কিডস-এর জন্য পেস্তো পাস্তা ট্রাই করতে পারেন।\" "
        " 3) replyText: \"Spicy চাইলে Peri Peri Wings নিন।\" "
        "    voiceReplyText: \"স্পাইসি চাইলে পেরি পেরি উইংস নিন।\" "
        "If language=\"en\", you MAY omit voiceReplyText or set it equal to replyText. "
        "Do NOT add items that are not in candidates/menu. "
        "Only suggest clearing the cart when the user clearly asks to cancel everything. "
        "If the user specifies a number or quantity in their request (in any language), "
        "use that count to limit how many suggestions or items you include. "
        + concision_clause
        + locked_intent_clause
        + " "
        + directive
    )


# -------------------- Intent inference (heuristic fallback) ----------------------


def _infer_intent_from_query(
    transcript: str,
    *,
    has_items: bool,
    last_intent: Optional[str],
) -> str:
    """
    Conservative heuristic for intent when classifier is uncertain/unavailable.
    """
    t = (transcript or "").strip()
    if not t:
        return "chitchat"

    if has_items:
        return "order"

    if "?" in t:
        return "menu"

    if last_intent in ("menu", "suggestions", "availability", "availability_check"):
        return "chitchat"

    if _is_very_short_turn(t) and not has_items:
        return "chitchat"

    return "chitchat"


# -------------------- Lightweight LLM intent classifier ----------------------


async def _call_openai_intent(messages: List[Dict[str, str]]) -> str:
    """
    Lightweight call for intent classification.
    """
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": INTENT_MODEL or OPENAI_CHAT_MODEL,
        "messages": messages,
        "max_tokens": INTENT_MAX_TOKENS,
        "temperature": 0.0,
        "top_p": 1.0,
        "stream": False,
        "response_format": {"type": "json_object"},
    }

    try:
        print("[brain:intent] >>>", _safe_snip(json.dumps(payload, ensure_ascii=False)))
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=INTENT_TIMEOUT_S) as client:
        r = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)

    print("[brain:intent] HTTP", r.status_code)
    print("[brain:intent] <<<", _safe_snip(r.text))

    r.raise_for_status()
    data = r.json()
    return (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )


async def _classify_intent_llm(
    transcript: str,
    last_intent: Optional[str],
    context: Optional[Dict[str, Any]],
) -> Tuple[Optional[str], float]:
    """
    Use a small LLM to classify intent into: order/menu/suggestions/chitchat.
    """
    transcript = (transcript or "").strip()
    if not transcript:
        return None, 0.0

    ctx: Dict[str, Any] = {}
    if isinstance(context, dict):
        for k in ("timeOfDay", "channel", "tenant", "branch", "languageHint"):
            if k in context:
                ctx[k] = context[k]
        locked = context.get("lockedIntent") or context.get("locked_intent")
        if locked:
            ctx["lockedIntentUpstream"] = locked

    if last_intent:
        ctx["lastIntent"] = last_intent

    system_msg = (
        "You are a lightweight intent classifier for Qravy AI Waiter.\n"
        "Classify the user's latest message into one of these intents:\n"
        "- \"order\": user is trying to place or modify an order, add items, quantities, confirm.\n"
        "- \"menu\": user is asking about availability, price, ingredients, or menu info.\n"
        "- \"suggestions\": user is asking for recommendations or 'what to eat/drink'.\n"
        "- \"chitchat\": greetings, thanks, small talk, or anything not related to ordering/menu.\n"
        "Use the semantics of the message and the provided lastIntent/context. "
        "Be conservative but do NOT rely on hardcoded keywords; infer from meaning.\n"
        "Return ONLY a single JSON object like:\n"
        "{ \"intent\": \"order\"|\"menu\"|\"suggestions\"|\"chitchat\", \"confidence\": 0.0-1.0 }"
    )

    user_payload = {
        "userTranscript": transcript,
        "Context": ctx or None,
    }

    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]

    try:
        raw = await _call_openai_intent(messages)
        obj = _parse_model_json(raw)
    except Exception as e:
        print("[brain:intent] intent classification failed:", e)
        return None, 0.0

    intent = (obj.get("intent") or "").strip().lower()
    try:
        confidence = float(obj.get("confidence", 0.0))
    except Exception:
        confidence = 0.0

    if intent not in ("order", "menu", "suggestions", "chitchat"):
        return None, 0.0

    confidence = max(0.0, min(1.0, confidence))
    return intent, confidence


# -------------------- Locked intent decision (LLM + fallback) ----------------------


async def _decide_locked_intent(
    transcript: str,
    context: Optional[Dict[str, Any]],
    dialog_state: Optional[Dict[str, Any]],
) -> str:
    """
    Decide lockedIntent BEFORE calling the main model.
    """
    ctx_locked = _extract_locked_intent(context)
    if ctx_locked:
        print("[brain:intent] using upstream lockedIntent:", ctx_locked)
        return ctx_locked

    last_intent = _extract_last_intent(context, dialog_state)

    intent_llm: Optional[str] = None
    conf_llm: float = 0.0
    try:
        intent_llm, conf_llm = await _classify_intent_llm(
            transcript=transcript,
            last_intent=last_intent,
            context=context,
        )
    except Exception as e:
        print("[brain:intent] _classify_intent_llm error:", e)

    if (
        intent_llm in ("order", "menu", "suggestions", "chitchat")
        and conf_llm >= INTENT_CONF_THRESHOLD
    ):
        print(f"[brain:intent] LLM classifier lockedIntent={intent_llm} conf={conf_llm}")
        return intent_llm or "chitchat"

    intent = _infer_intent_from_query(
        transcript=transcript,
        has_items=False,
        last_intent=last_intent,
    )

    if intent not in ("order", "menu", "suggestions", "chitchat"):
        intent = "chitchat"

    print(f"[brain:intent] heuristic lockedIntent={intent} (LLM_conf={conf_llm})")
    return intent


# -------------------- User/content payload builder ----------------------


def _build_menu_hint(menu_snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Compact, deterministic slice of menu for grounding (not required).
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
                    "categoryIds": (
                        i.get("categoryIds")
                        or ([i.get("categoryId")] if i.get("categoryId") else [])
                    )[:2],
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
    locked_intent: Optional[str],
) -> str:
    """
    Build the single [INPUT] JSON payload for the main model.
    """
    payload: Dict[str, Any] = {
        "userTranscript": (transcript or "").strip(),
    }

    ctx_obj: Dict[str, Any] = {}
    if isinstance(context, dict):
        ctx_obj.update(context)

    if locked_intent in ("order", "menu", "suggestions", "chitchat"):
        ctx_obj["lockedIntent"] = locked_intent

    if ctx_obj:
        payload["Context"] = ctx_obj

    if suggestion_candidates:
        payload["SuggestionCandidates"] = suggestion_candidates

    if upsell_candidates:
        payload["UpsellCandidates"] = upsell_candidates

    return json.dumps(payload, ensure_ascii=False)


# --------------------------- OpenAI Call (main brain) ---------------------------


async def _call_openai(messages: List[Dict[str, str]]) -> str:
    """
    Call main OpenAI chat model for brain.
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
    Parse a single JSON object from model text.
    - Prefer the first {...} span.
    - If json.loads fails, progressively trim from the end to salvage.
    """
    raw = (text or "").strip()
    candidate = raw

    if not raw.startswith("{"):
        m = _JSON_FIRST_OBJECT.search(raw)
        if not m:
            print("[brain:json] no top-level { } found. raw=", _safe_snip(raw, 800))
            raise ValueError("No JSON object found in model response")
        candidate = m.group(0)

    # Fast path
    try:
        obj = json.loads(candidate)
        if not isinstance(obj, dict):
            print(
                "[brain:json] Top-level is not an object. raw=",
                _safe_snip(candidate, 800),
            )
            raise ValueError("Top-level JSON is not an object")
        return obj
    except json.JSONDecodeError as e:
        print("[brain:json] JSONDecodeError on first attempt:", repr(e))
        print(
            "[brain:json] Full candidate (truncated for log):",
            _safe_snip(candidate, 1500),
        )

    # Salvage: trim from end to last '}' or ']' and retry
    s = candidate
    for i in range(len(s) - 1, -1, -1):
        if i < len(s) and s[i] in ("}", "]"):
            trimmed = s[: i + 1]
            try:
                obj = json.loads(trimmed)
                if isinstance(obj, dict):
                    print("[brain:json] Salvaged valid JSON after trimming at", i)
                    return obj
            except json.JSONDecodeError:
                continue

    # Log detailed error region if still invalid
    try:
        json.loads(candidate)
    except json.JSONDecodeError as e:
        start = max(e.pos - 120, 0)
        end = min(e.pos + 120, len(candidate))
        snippet = candidate[start:end]
        print("[brain:json] Final JSONDecodeError:", repr(e))
        print("[brain:json] Around pos", e.pos, "=>", snippet)

    raise ValueError("Unable to parse JSON object from model response")


# ------------------------ Normalization helpers ------------------------


def _normalize_intent(raw: Any, has_items: bool) -> str:
    """
    Normalize model-provided intent into constrained set.
    """
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

    if r not in {"order", "menu", "suggestions", "chitchat"}:
        r = "order" if has_items else "chitchat"

    return r


def _normalize_items(
    raw_items: Any,
    cand_by_id: Dict[str, Dict[str, Any]],
    cand_name_to_id: Dict[str, str],
    max_items: int = 24,
) -> List[Dict[str, Any]]:
    """
    Normalize items[] using candidate index when available.
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

        if not item_id or item_id in seen_ids:
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
    max_len: int = 5,
) -> List[Dict[str, Any]]:
    """
    Normalize suggestions[] or upsell[] arrays.
    Caps at max_len to avoid huge payloads.
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
                continue
        else:
            if not title:
                continue

        if cand:
            resolved_id = _normalize_id(
                cand.get("itemId") or cand.get("id") or cand.get("_id")
            )
            if not resolved_id or resolved_id in seen_ids:
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


def _normalize_decision(
    raw: Any,
    has_suggestions: bool,
    has_upsell: bool,
) -> Dict[str, bool]:
    """
    Normalize decision flags; default based on presence of suggestions/upsell.
    """
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


def _normalize_cart_ops(
    raw_ops: Any,
    cand_by_id: Dict[str, Dict[str, Any]],
    cand_name_to_id: Dict[str, str],
    max_ops: int = 32,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Normalize cartOps into a safe minimal set understood by the frontend.
    """
    if not raw_ops or not isinstance(raw_ops, list):
        return [], False

    out: List[Dict[str, Any]] = []
    have_candidates = bool(cand_by_id)
    clear_all = False

    def resolve_item(op: Dict[str, Any]) -> Tuple[str, str]:
        item_id = _normalize_id(op.get("itemId"))
        name = (op.get("name") or op.get("title") or "").strip()

        if have_candidates:
            if item_id and item_id in cand_by_id:
                cand = cand_by_id[item_id]
                if not name:
                    name = (cand.get("name") or cand.get("title") or "").strip()
                return item_id, name
            if name:
                cid = cand_name_to_id.get(name.lower())
                if cid and cid in cand_by_id:
                    cand = cand_by_id[cid]
                    return cid, (cand.get("name") or cand.get("title") or name)
            return "", ""
        else:
            if item_id:
                return item_id, name or item_id
            if name:
                return "", name
            return "", ""

    for raw in raw_ops:
        if not isinstance(raw, dict):
            continue

        op_raw = (raw.get("op") or raw.get("type") or "").strip().lower()

        if op_raw in (
            "clear",
            "clearall",
            "clear_cart",
            "cancel_all",
            "cancel-order",
            "cancel_order",
        ):
            clear_all = True
            continue

        if op_raw in ("add", "plus", "increment"):
            op = "add"
        elif op_raw in ("set", "assign", "update"):
            op = "set"
        elif op_raw in ("delta", "change", "adjust"):
            op = "delta"
        elif op_raw in ("remove", "delete", "rm"):
            op = "remove"
        else:
            continue

        item_id, name = resolve_item(raw)

        if op == "remove" and not (item_id or name):
            continue
        if op in ("add", "set", "delta") and not (item_id or name):
            continue

        quantity = raw.get("quantity", raw.get("qty"))
        delta = raw.get("delta")

        norm_quantity: Optional[int] = None
        norm_delta: Optional[int] = None

        if op in ("add", "set"):
            try:
                q = int(quantity if quantity is not None else 1)
            except Exception:
                q = 1
            if op == "add" and q <= 0:
                q = 1
            if op == "set" and q < 0:
                q = 0
            norm_quantity = q
        elif op == "delta":
            try:
                d = int(delta if delta is not None else 0)
            except Exception:
                d = 0
            if d == 0:
                continue
            norm_delta = d

        op_obj: Dict[str, Any] = {"op": op}
        if item_id:
            op_obj["itemId"] = item_id
        if name:
            op_obj["name"] = name
        if norm_quantity is not None:
            op_obj["quantity"] = norm_quantity
        if norm_delta is not None:
            op_obj["delta"] = norm_delta

        out.append(op_obj)

        if len(out) >= max_ops:
            break

    return out, clear_all


# ------------------------ Backend finalizer ------------------------


def _finalize_backend_decision(
    *,
    transcript: str,
    lang_hint: str,
    raw_obj: Dict[str, Any],
    menu_snapshot: Optional[Dict[str, Any]],
    cand_by_id: Dict[str, Dict[str, Any]],
    cand_name_to_id: Dict[str, str],
    suggestion_candidates: Optional[List[Dict[str, Any]]],
    upsell_candidates: Optional[List[Dict[str, Any]]],
    context: Optional[Dict[str, Any]],
    dialog_state: Optional[Dict[str, Any]],
    locked_intent: Optional[str],
) -> Dict[str, Any]:
    """
    Take raw model JSON and deterministically decide:
      - intent
      - items
      - suggestions
      - upsell
      - decision
    """

    # 1) Normalize model-proposed items
    proposed_items = _normalize_items(
        raw_obj.get("items"),
        cand_by_id=cand_by_id,
        cand_name_to_id=cand_name_to_id,
    )
    has_items = bool(proposed_items)

    # 2) Start from lockedIntent if valid
    intent: Optional[str] = None
    if locked_intent in ("order", "menu", "suggestions", "chitchat"):
        intent = locked_intent

    # 3) If no lockedIntent, use heuristic + model advisory
    if not intent:
        last_intent = _extract_last_intent(context, dialog_state)

        query_intent = _infer_intent_from_query(
            transcript=transcript,
            has_items=has_items,
            last_intent=last_intent,
        )
        model_intent = _normalize_intent(raw_obj.get("intent"), has_items=has_items)

        intent = query_intent

        if intent == "chitchat":
            if model_intent == "order" and has_items:
                intent = "order"
            elif model_intent in ("menu", "suggestions"):
                intent = model_intent

        if intent == "menu" and model_intent == "suggestions":
            intent = "suggestions"

    # 4) Safety: cannot be order with no items
    if intent == "order" and not has_items:
        intent = "chitchat"

    # 5) Suggestions
    suggestions: List[Dict[str, Any]] = []
    if intent in ("suggestions", "menu"):
        raw_suggestions = raw_obj.get("suggestions")
        if raw_suggestions:
            suggestions = _normalize_suggestion_like_list(
                raw_suggestions,
                cand_by_id=cand_by_id,
                cand_name_to_id=cand_name_to_id,
                max_len=5,
            )
        elif suggestion_candidates:
            suggestions = _normalize_suggestion_like_list(
                suggestion_candidates,
                cand_by_id=cand_by_id,
                cand_name_to_id=cand_name_to_id,
                max_len=5,
            )

    # 6) Upsell
    upsell: List[Dict[str, Any]] = []
    if intent == "order" and has_items and upsell_candidates:
        upsell = _normalize_suggestion_like_list(
            upsell_candidates,
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
            max_len=5,
        )

    # 7) Decision flags
    decision = _normalize_decision(
        raw_obj.get("decision"),
        has_suggestions=bool(suggestions),
        has_upsell=bool(upsell),
    )

    if intent == "order" and has_items and upsell:
        decision["showUpsellTray"] = True

    if intent == "suggestions" and suggestions:
        decision["showSuggestionsModal"] = True

    if intent == "chitchat":
        decision = {
            "showSuggestionsModal": False,
            "showUpsellTray": False,
        }

    final_items = proposed_items if intent == "order" else []

    return {
        "intent": intent,
        "items": final_items,
        "suggestions": suggestions,
        "upsell": upsell,
        "decision": decision,
    }


# ------------------------- Deterministic menu fallback -------------------------


def _fallback_menu_reply(
    *,
    transcript: str,
    lang: str,
    locked_intent: Optional[str],
    menu_snapshot: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    When model/JSON fails but lockedIntent says menu/suggestions and we have menu data,
    build a short deterministic reply instead of generic apology.
    """
    if locked_intent not in ("menu", "suggestions"):
        return None
    if not menu_snapshot or not menu_snapshot.get("items"):
        return None

    items = menu_snapshot.get("items") or []
    top = items[:5]

    titles = [i.get("name") for i in top if i.get("name")]
    if not titles:
        return None

    if lang == "bn":
        reply_text = "আমাদের মেনু থেকে কিছু অপশন: " + ", ".join(titles) + "।"
    else:
        reply_text = "Here are some options from our menu: " + ", ".join(titles) + "."

    suggestions = []
    for it in top:
        name = it.get("name")
        if not name:
            continue
        suggestions.append(
            {
                "title": name,
                "itemId": _normalize_id(
                    it.get("id") or it.get("_id") or it.get("itemId")
                ),
                "price": it.get("price"),
            }
        )

    return {
        "replyText": reply_text,
        "intent": "menu" if locked_intent == "menu" else "suggestions",
        "language": lang,
        "items": [],
        "suggestions": suggestions,
        "upsell": [],
        "decision": {
            "showSuggestionsModal": locked_intent == "suggestions",
            "showUpsellTray": False,
        },
        "cartOps": [],
        "clearCart": False,
        "fallback": True,
    }


# --------------------- voiceReplyText builder (no dumb phonetics) ---------------------


def _build_voice_reply_text(
    reply_text: str,
    *,
    language: str,
    model_obj: Dict[str, Any],
) -> str:
    """
    Strategy:
      - If model provided voiceReplyText, trust it.
      - If not:
          * For Bangla, fall back to replyText (no naive per-letter transliteration).
          * For others, return empty string (caller/front-end may reuse replyText).
    This guarantees:
      - No garbage like 'কহিকেন পেসটো পাসটা'.
      - Either LLM-crafted Bangla-script voiceReplyText, or a clean fallback.
    """
    explicit = str(model_obj.get("voiceReplyText") or "").strip()
    if explicit:
        return explicit

    if not reply_text:
        return ""

    if language == "bn":
        # Fallback: use replyText as-is (which already contains correct or mixed text),
        # instead of attempting unsafe automatic transliteration.
        return reply_text

    return ""


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
    context: Optional[Dict[str, Any]] = None,
    suggestion_candidates: Optional[List[Dict[str, Any]]] = None,
    upsell_candidates: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Thin-but-strict adapter around the LLM:
      - decide lockedIntent first,
      - call model with strict JSON contract,
      - normalize + enforce constraints,
      - use deterministic fallback on failure,
      - voiceReplyText: LLM primary; for bn fallback to replyText only (no naive phonetics).
    """
    transcript = _clamp(transcript or "", 2000)
    if not transcript:
        lang = "en"
        meta = {
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
            "cartOps": [],
            "clearCart": False,
        }
        reply_text = "Sorry, I didn’t catch that. Could you say that again?"
        voice_reply_text = _build_voice_reply_text(
            reply_text,
            language=lang,
            model_obj={},
        )
        if voice_reply_text:
            meta["voiceReplyText"] = voice_reply_text
        print("[brain] final replyText:", reply_text)
        print("[brain] final voiceReplyText:", meta.get("voiceReplyText", ""))
        try:
            print(
                "[brain] final meta.suggestions:",
                [s.get("title") for s in meta.get("suggestions", [])],
            )
        except Exception:
            print("[brain] final meta.suggestions: <error printing>")
        return {
            "replyText": reply_text,
            "meta": meta,
        }

    # Decide language + locked intent up front
    lang_hint = _resolve_lang_hint(locale, transcript)
    locked_intent = await _decide_locked_intent(
        transcript=transcript,
        context=context,
        dialog_state=dialog_state,
    )

    # ✅ Merge backend shortlists into one unified candidate pool
    unified_candidates = (suggestion_candidates or []) + (upsell_candidates or [])
    if (not unified_candidates) and menu_snapshot and menu_snapshot.get("items"):
        unified_candidates = menu_snapshot["items"]

    cand_by_id, cand_name_to_id = _build_candidate_index(unified_candidates, [])

    # System message
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": _build_system_with_lang(lang_hint, locked_intent)}
    ]

    # Optional DialogState
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

    # Single INPUT payload
    user_payload = _build_user_input_payload(
        transcript=transcript,
        context=context,
        suggestion_candidates=suggestion_candidates,
        upsell_candidates=upsell_candidates,
        menu_snapshot=menu_snapshot,
        locked_intent=locked_intent,
    )
    messages.append({"role": "user", "content": f"[INPUT]: {user_payload}"})

    try:
        raw = await _call_openai(messages)
        obj = _parse_model_json(raw)

        # ---- Extract reply text & language proposal ----
        reply_text = str(obj.get("replyText") or "").strip()
        language = (obj.get("language") or "").strip() or _guess_lang(
            reply_text or transcript
        )

        # Enforce external language hint if fixed
        if lang_hint in ("bn", "en"):
            language = lang_hint

        # ---- Backend final decision ----
        backend = _finalize_backend_decision(
            transcript=transcript,
            lang_hint=language,
            raw_obj=obj,
            menu_snapshot=menu_snapshot,
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
            suggestion_candidates=suggestion_candidates,
            upsell_candidates=upsell_candidates,
            context=context,
            dialog_state=dialog_state,
            locked_intent=locked_intent,
        )

        intent = backend["intent"]
        items = backend["items"]
        suggestions = backend["suggestions"]
        upsell = backend["upsell"]
        decision = backend["decision"]

        # ---- Canonical replyText overrides ----
        if intent == "suggestions" and suggestions:
            if not reply_text:
                names = [s["title"] for s in suggestions if s.get("title")]
                if names:
                    reply_text = (
                        f"এগুলো সাজেস্ট করছি: {', '.join(names)}"
                        if language == "bn"
                        else f"Here are some options I recommend: {', '.join(names)}"
                    )
                else:
                    reply_text = (
                        "এগুলো সাজেস্ট করছি:"
                        if language == "bn"
                        else "Here are some options I recommend:"
                    )

        if intent == "order" and items:
            names = [i["name"] for i in items if i.get("name")]
            if names:
                reply_text = (
                    f"ঠিক আছে, আমি যুক্ত করেছি: {', '.join(names)}।"
                    if language == "bn"
                    else f"Got it, I’ve added: {', '.join(names)}."
                )

        # ---- Normalize cartOps / clearCart ----
        cart_ops, clear_all_from_ops = _normalize_cart_ops(
            obj.get("cartOps"),
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
        )

        clear_cart_flag = bool(obj.get("clearCart") is True or clear_all_from_ops)

        # ---- Canonicalize replyText with menu ----
        reply_text = _canonicalize_reply_text(
            reply_text=reply_text,
            model_items=items,
            menu_snapshot=menu_snapshot,
        )

        # ---- Ensure we always respond with something sane ----
        if not reply_text:
            if intent == "order" and items:
                reply_text = (
                    "ঠিক আছে, আপনার অর্ডারে যুক্ত করেছি।"
                    if language == "bn"
                    else "Got it, I’ve added that to your order."
                )
            elif intent == "suggestions" and suggestions:
                reply_text = (
                    "এই কিছু আইটেম আমি সাজেস্ট করছি।"
                    if language == "bn"
                    else "Here are some options I recommend."
                )
            elif intent == "chitchat":
                reply_text = (
                    "দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন?"
                    if language == "bn"
                    else "Sorry, I didn’t catch that clearly. Could you say that again?"
                )
            else:
                reply_text = "ঠিক আছে।" if language == "bn" else "Alright."

        # ---- Build meta ----
        meta: Dict[str, Any] = {
            "model": OPENAI_CHAT_MODEL,
            "language": language,
            "intent": intent,
            "lockedIntent": locked_intent,
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
            "stateLen": len(dialog_state or [] if isinstance(dialog_state, list) else (dialog_state or {})),
            "hasCandidates": bool(cand_by_id),
            "contextSnapshot": context or None,
            "cartOps": cart_ops,
            "clearCart": clear_cart_flag,
        }

        # ---- voiceReplyText: LLM primary, sane fallback ----
        voice_reply_text = _build_voice_reply_text(
            reply_text,
            language=language,
            model_obj=obj,
        )
        if voice_reply_text:
            meta["voiceReplyText"] = voice_reply_text

        print("[brain] final replyText:", reply_text)
        print("[brain] final voiceReplyText:", meta.get("voiceReplyText", ""))
        try:
            print(
                "[brain] final meta.suggestions:",
                [s.get("title") for s in meta.get("suggestions", [])],
            )
        except Exception:
            print("[brain] final meta.suggestions: <error printing>")

        return {
            "replyText": reply_text,
            "meta": meta,
        }

    except Exception as e:
        # Smart fallback: deterministic menu answer when possible
        lang = _guess_lang(transcript)
        menu_fallback = _fallback_menu_reply(
            transcript=transcript,
            lang=lang,
            locked_intent=locked_intent,
            menu_snapshot=menu_snapshot,
        )

        if menu_fallback:
            reply_text = menu_fallback["replyText"]
            meta: Dict[str, Any] = {
                "model": OPENAI_CHAT_MODEL,
                "language": menu_fallback["language"],
                "intent": menu_fallback["intent"],
                "lockedIntent": locked_intent,
                "items": menu_fallback["items"],
                "suggestions": menu_fallback["suggestions"],
                "upsell": menu_fallback["upsell"],
                "decision": menu_fallback["decision"],
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "error": str(e),
                "fallback": True,
                "ctxLen": len(history or []),
                "stateLen": len(dialog_state or {} if isinstance(dialog_state, dict) else {}),
                "hasCandidates": bool(menu_snapshot and menu_snapshot.get("items")),
                "cartOps": menu_fallback["cartOps"],
                "clearCart": menu_fallback["clearCart"],
            }
            voice_reply_text = _build_voice_reply_text(
                reply_text,
                language=menu_fallback["language"],
                model_obj={},
            )
            if voice_reply_text:
                meta["voiceReplyText"] = voice_reply_text
            print("[brain] fallback menu replyText:", reply_text)
            print("[brain] final voiceReplyText:", meta.get("voiceReplyText", ""))
            try:
                print(
                    "[brain] final meta.suggestions:",
                    [s.get("title") for s in meta.get("suggestions", [])],
                )
            except Exception:
                print("[brain] final meta.suggestions: <error printing>")
            return {
                "replyText": reply_text,
                "meta": meta,
            }

        # Otherwise: generic apology (last resort)
        text = (
            "দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?"
            if lang == "bn"
            else "Sorry, I’m having trouble. Could you try once more?"
        )
        meta = {
            "model": OPENAI_CHAT_MODEL,
            "language": lang,
            "intent": "chitchat",
            "lockedIntent": locked_intent,
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
            "stateLen": len(dialog_state or {} if isinstance(dialog_state, dict) else {}),
            "hasCandidates": bool(suggestion_candidates or upsell_candidates),
            "cartOps": [],
            "clearCart": False,
        }
        voice_reply_text = _build_voice_reply_text(
            text,
            language=lang,
            model_obj={},
        )
        if voice_reply_text:
            meta["voiceReplyText"] = voice_reply_text

        print("[brain] final replyText:", text)
        print("[brain] final voiceReplyText:", meta.get("voiceReplyText", ""))
        try:
            print(
                "[brain] final meta.suggestions:",
                [s.get("title") for s in meta.get("suggestions", [])],
            )
        except Exception:
            print("[brain] final meta.suggestions: <error printing>")

        return {
            "replyText": text,
            "meta": meta,
        }


__all__ = ["generate_reply"]
