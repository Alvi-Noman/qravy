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

# --------------------------- Debug helpers ---------------------------

_DEBUG_KEYWORDS = ("calamari", "shrimp")


def _debug_has_kw(name: str) -> bool:
    if not name:
        return False
    n = name.lower()
    return any(k in n for k in _DEBUG_KEYWORDS)


def _debug_log_kw(prefix: str, data: Any):
    try:
        if isinstance(data, dict):
            name = (data.get("name") or data.get("title") or "").strip()
            if _debug_has_kw(name):
                print(prefix, json.dumps(data, ensure_ascii=False))
        elif isinstance(data, list):
            for d in data:
                _debug_log_kw(prefix, d)
        else:
            s = str(data)
            if _debug_has_kw(s):
                print(prefix, s)
    except Exception as e:
        print("[debug][error]", prefix, "log failed:", e)


# --------------------------- Small utils ---------------------------


def _clamp(s: str, max_chars: int) -> str:
    if not s:
        return ""
    return s if len(s) <= max_chars else (s[: max_chars - 1] + "…")


_BENGALI = re.compile(r"[\u0980-\u09FF]")


def _guess_lang(text: str) -> str:
    return "bn" if _BENGALI.search(text or "") else "en"


def _safe_snip(s: str | bytes, n: int = 800) -> str:
    if s is None:
        return ""
    if isinstance(s, bytes):
        try:
            s = s.decode("utf-8", errors="replace")
        except Exception:
            s = str(s)
    return s if len(s) <= n else (s[:n] + "…")


# ---------------------- Bangla quantity helpers ----------------------

_BN_DIGIT_MAP = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

_BN_QTY_WORDS = {
    # 1
    "এক": 1,
    "একটা": 1,
    "একটি": 1,
    "১": 1,
    "১টা": 1,
    # 2
    "দুই": 2,
    "দুইটা": 2,
    "২": 2,
    "২টা": 2,
    # 3
    "তিন": 3,
    "তিনটা": 3,
    "৩": 3,
    "৩টা": 3,
    # 4
    "চার": 4,
    "চারটা": 4,
    "৪": 4,
    "৪টা": 4,
    # 5
    "পাঁচ": 5,
    "পাঁচটা": 5,
    "৫": 5,
    "৫টা": 5,
    # 6
    "ছয়": 6,
    "ছয়": 6,
    "ছয়টা": 6,
    "ছয়টা": 6,
    "৬": 6,
    "৬টা": 6,
    # 7
    "সাত": 7,
    "সাতটা": 7,
    "৭": 7,
    "৭টা": 7,
    # 8
    "আট": 8,
    "আটটা": 8,
    "৮": 8,
    "৮টা": 8,
    # 9
    "নয়": 9,
    "নয়": 9,
    "নয়টা": 9,
    "নয়টা": 9,
    "৯": 9,
    "৯টা": 9,
    # 10
    "দশ": 10,
    "দশটা": 10,
    "১০": 10,
    "১০টা": 10,
}


def _parse_quantity_any(value: Any, *, allow_zero: bool = False) -> Optional[int]:
    """
    Parse quantity from:
    - int / float
    - strings with ASCII or Bangla digits (e.g. '2', '২', '২টা')
    - common Bangla words ('দুইটা', 'একটি', etc.)
    Returns None if nothing valid found.
    """
    if value is None:
        return None

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        n = int(value)
        if n < 0:
            return None
        if n == 0 and not allow_zero:
            return None
        return n

    s = str(value).strip()
    if not s:
        return None

    s_norm = s.translate(_BN_DIGIT_MAP)
    m = re.search(r"(-?\d+)", s_norm)
    if m:
        n = int(m.group(1))
        if n < 0:
            return None
        if n == 0 and not allow_zero:
            return None
        return n

    token = s.lower()
    if token in _BN_QTY_WORDS:
        n = _BN_QTY_WORDS[token]
        if n == 0 and not allow_zero:
            return None
        return n

    for word, n in _BN_QTY_WORDS.items():
        if token.startswith(word):
            if n == 0 and not allow_zero:
                return None
            return n

    return None


def _parse_delta_any(value: Any) -> Optional[int]:
    """
    Parse signed delta for 'delta' ops. Supports ASCII/Bangla digits.
    """
    if value is None:
        return None

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        d = int(value)
        return d if d != 0 else None

    s = str(value).strip()
    if not s:
        return None

    s_norm = s.translate(_BN_DIGIT_MAP)
    m = re.search(r"(-?\d+)", s_norm)
    if not m:
        return None

    d = int(m.group(1))
    return d if d != 0 else None


def _is_very_short_turn(transcript: str) -> bool:
    return len((transcript or "").strip()) <= 24


def _is_price_or_availability_query(transcript: str) -> bool:
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
      by_id: itemId -> candidate dict
      name_to_id: normalized name -> itemId
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
            if key:
                name_to_id[key] = item_id

        # aliases
        for alias in c.get("aliases") or []:
            a = (alias or "").strip().lower()
            if a:
                name_to_id[a] = item_id

        if _debug_has_kw(title):
            print("[debug][candidate_index] ingest:", title, "->", item_id)

    for src in (suggestion_candidates or []):
        ingest_one(src)
    for src in (upsell_candidates or []):
        ingest_one(src)

    print(
        "[debug][candidate_index] total_by_id:",
        len(by_id),
        "total_name_to_id:",
        len(name_to_id),
    )
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
        _id = _normalize_id(
            it.get("id") or it.get("_id") or it.get("itemId")
        )
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

        if _debug_has_kw(name):
            print("[debug][menu_maps] item:", name, "->", _id)

    print("[debug][menu_maps] built ids:", len(id_to_name))
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

        if _debug_has_kw(reply_text):
            print("[debug][canonicalize_replyText] before:", reply_text)
            print("[debug][canonicalize_replyText] after :", out)

        return out
    except Exception:
        return reply_text


# -------- Availability-aware fix: don't lie about items that exist ---------


def _fix_false_unavailability(
    reply_text: str,
    menu_snapshot: Optional[Dict[str, Any]],
) -> str:
    """
    If the model claims 'X not in menu / not available' but X clearly exists and
    is active+visible, strip that sentence fragment.
    """
    if not reply_text or not menu_snapshot:
        return reply_text

    try:
        valid_names: List[str] = []

        for it in (menu_snapshot.get("items") or []):
            name = (it.get("name") or "").strip()
            if not name:
                continue

            # treat as available if active & not hidden (or explicit available=True)
            status = (it.get("status") or "active").lower()
            hidden = bool(it.get("hidden"))
            available = it.get("available", True)
            if status == "active" and not hidden and available:
                valid_names.append(name)

        if not valid_names:
            return reply_text

        text = reply_text
        lower = reply_text.lower()
        neg_patterns = ("নেই", "not available", "nai", " নেই", " নাই")

        for name in valid_names:
            name_l = name.lower()
            if name_l not in lower:
                continue

            for neg in neg_patterns:
                # name ... neg OR neg ... name (loose window)
                if re.search(
                    re.escape(name_l) + r".{0,16}" + re.escape(neg),
                    lower,
                ) or re.search(
                    re.escape(neg) + r".{0,16}" + re.escape(name_l),
                    lower,
                ):
                    # remove the full sentence containing that claim
                    pattern = (
                        r"[^।.!?]*" + re.escape(name) +
                        r"[^।.!?]*(?:।|\.|!|\?)"
                    )
                    new_text = re.sub(pattern, "", text).strip()
                    if new_text:
                        text = new_text
                        lower = text.lower()
                    break

        return text or reply_text
    except Exception:
        return reply_text


# -------------------- Dialog State Helper ----------------------


def _build_state_line(
    dialog_state: Optional[Dict[str, Any]]
) -> Optional[Dict[str, str]]:
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
    for src in (dialog_state, context):
        if isinstance(src, dict):
            v = src.get("lastIntent") or src.get("last_intent")
            if isinstance(v, str) and v.strip():
                return v.strip().lower()
    return None


def _extract_locked_intent(context: Optional[Dict[str, Any]]) -> Optional[str]:
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
    v = (locale or "").strip().lower()
    if v in ("bn", "en"):
        return v
    return _guess_lang(transcript)


_LANG_DIRECTIVE = {
    "bn": "Respond ONLY in Bangla (Bengali).",
    "en": "Respond ONLY in English.",
}


def _build_system_with_lang(
    lang_hint: str,
    locked_intent: Optional[str],
) -> str:
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
        "You MUST interpret the user's utterance (Bangla, English, or mixed) and map it to REAL menu items "
        "from the provided unified candidates.\n"
        "When the user mentions an item in Bangla, Banglish, or phonetic form (e.g. \"ক্রিস্পি কলামারি\", \"কলামারি\", "
        "\"ডাইনামাইট শ্রিম্প\"), you MUST resolve it to the closest matching candidate item name such as "
        "\"Crispy Calamari\" or \"Dynamite Shrimp\". "
        "Be robust to minor ASR noise and spelling errors: always choose the best-matching item from the candidates "
        "by semantic/phonetic similarity instead of defaulting to a random or popular item.\n"
        "If lockedIntent=\"order\", you MUST reflect the user's requested items in the items[] array using those "
        "resolved candidate IDs and quantities.\n"
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
        " {\"name\": string, \"itemId\": string, \"quantity\": integer >=1}"
        "], "
        "\"suggestions\": ["
        " {\"title\": string, \"subtitle\"?: string, \"itemId\"?: string, \"categoryId\"?: string, \"price\"?: number}"
        "], "
        "\"upsell\": ["
        " {\"title\": string, \"subtitle\"?: string, \"itemId\"?: string, \"categoryId\"?: string, \"price\"?: number}"
        "], "
        "\"decision\": {"
        " \"showSuggestionsModal\"?: boolean, "
        " \"showUpsellTray\"?: boolean"
        "}, "
        "\"cartOps\"?: ["
        " {"
        " \"op\": \"add\"|\"set\"|\"delta\"|\"remove\", "
        " \"itemId\"?: string, "
        " \"name\"?: string, "
        " \"quantity\"?: integer, "
        " \"delta\"?: integer"
        " }"
        "], "
        "\"clearCart\"?: boolean, "
        "\"notes\"?: string, "
        "\"voiceReplyText\"?: string "
        "}. "
        "For Bangla users (language=\"bn\"), UI item names in replyText MUST remain exactly as in candidates/menu "
        "(English or mixed) so they match the real menu. "
        "In addition, when language=\"bn\" you MUST ALWAYS provide \"voiceReplyText\" as a natural Bangla-script reading "
        "of the FULL replyText, including phonetic Bangla spellings for any English menu item names. "
        "If language=\"en\", you MAY omit voiceReplyText or set it equal to replyText. "
        "Do NOT add items that are not in candidates/menu. "
        "Only suggest clearing the cart when the user clearly asks to cancel everything. "
        "If the user specifies a number or quantity in their request (in any language), "
        "use that count to limit how many suggestions or items you include."
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
    t = (transcript or "").strip()
    if not t:
        return "chitchat"

    if has_items:
        return "order"

    if "?" in t:
        return "menu"

    if last_intent in (
        "menu",
        "suggestions",
        "availability",
        "availability_check",
    ):
        return "chitchat"

    if _is_very_short_turn(t) and not has_items:
        return "chitchat"

    return "chitchat"


# -------------------- Lightweight LLM intent classifier ----------------------


async def _call_openai_intent(messages: List[Dict[str, str]]) -> str:
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
        print(
            "[brain:intent] >>>",
            _safe_snip(json.dumps(payload, ensure_ascii=False)),
        )
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=INTENT_TIMEOUT_S) as client:
        r = await client.post(
            OPENAI_CHAT_URL,
            headers=headers,
            json=payload,
        )
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
    transcript = (transcript or "").strip()
    if not transcript:
        return None, 0.0

    ctx: Dict[str, Any] = {}
    if isinstance(context, dict):
        for k in ("timeOfDay", "channel", "tenant", "branch", "languageHint"):
            if k in context:
                ctx[k] = context[k]
        locked = context.get("lockedIntent") or context.get(
            "locked_intent"
        )
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
        {
            "role": "user",
            "content": json.dumps(
                user_payload,
                ensure_ascii=False,
            ),
        },
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
    print(f"[brain:intent] classified intent={intent} conf={confidence}")
    return intent, confidence


# -------------------- Locked intent decision ----------------------


async def _decide_locked_intent(
    transcript: str,
    context: Optional[Dict[str, Any]],
    dialog_state: Optional[Dict[str, Any]],
) -> str:
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
        print(
            f"[brain:intent] LLM classifier lockedIntent={intent_llm} conf={conf_llm}"
        )
        return intent_llm or "chitchat"

    intent = _infer_intent_from_query(
        transcript=transcript,
        has_items=False,
        last_intent=last_intent,
    )
    if intent not in ("order", "menu", "suggestions", "chitchat"):
        intent = "chitchat"

    print(
        f"[brain:intent] heuristic lockedIntent={intent} (LLM_conf={conf_llm})"
    )
    return intent


# -------------------- User/content payload builder ----------------------


def _build_menu_hint(
    menu_snapshot: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not menu_snapshot:
        return None

    try:
        items_src = sorted(
            (menu_snapshot.get("items") or []),
            key=lambda z: (z.get("name") or "").lower(),
        )

        compact = {
            "categories": [
                {
                    "id": c.get("id") or c.get("_id"),
                    "name": c.get("name"),
                }
                for c in (menu_snapshot.get("categories") or [])[:8]
            ],
            "items": [
                {
                    "id": i.get("id")
                    or i.get("_id")
                    or i.get("itemId"),
                    "name": i.get("name"),
                    "price": i.get("price"),
                    "aliases": i.get("aliases") or [],
                    "categoryIds": (
                        i.get("categoryIds")
                        or (
                            [i.get("categoryId")]
                            if i.get("categoryId")
                            else []
                        )
                    )[:2],
                }
                for i in items_src[:120]
            ],
        }

        _debug_log_kw(
            "[debug][menu_hint] item:",
            compact["items"],
        )
        return compact
    except Exception as e:
        print("[debug][menu_hint] error building menu hint:", e)
        return None


def _build_user_input_payload(
    transcript: str,
    context: Optional[Dict[str, Any]],
    suggestion_candidates: Optional[List[Dict[str, Any]]],
    upsell_candidates: Optional[List[Dict[str, Any]]],
    menu_snapshot: Optional[Dict[str, Any]],
    locked_intent: Optional[str],
) -> str:
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

    s = json.dumps(payload, ensure_ascii=False)
    if any(k in s.lower() for k in _DEBUG_KEYWORDS):
        print("[debug][user_input_payload]", _safe_snip(s, 400))
    return s


# --------------------------- OpenAI Call (main brain) ---------------------------


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
        r = await client.post(
            OPENAI_CHAT_URL,
            headers=headers,
            json=payload,
        )
        print("[brain] HTTP", r.status_code)
        print("[brain] <<<", _safe_snip(r.text))
        r.raise_for_status()
        data = r.json()

    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )

    if any(k in content.lower() for k in _DEBUG_KEYWORDS):
        print(
            "[debug][model_raw_content]",
            _safe_snip(content, 800),
        )

    return content


# ------------------------ JSON Parse Helpers ------------------------

_JSON_FIRST_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


def _parse_model_json(text: str) -> Dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Empty model response")

    # 1) Direct parse
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            if any(k in raw.lower() for k in _DEBUG_KEYWORDS):
                print(
                    "[debug][parse_model_json] parsed_direct:",
                    _safe_snip(raw, 600),
                )
            return obj
        print("[brain:json] Top-level is not an object. raw=", _safe_snip(raw, 800))
    except json.JSONDecodeError:
        pass

    # 2) First {...} span
    candidate = raw
    if not candidate.lstrip().startswith("{"):
        m = _JSON_FIRST_OBJECT.search(raw)
        if m:
            candidate = m.group(0)

    try:
        obj = json.loads(candidate)
        if isinstance(obj, dict):
            if any(k in candidate.lower() for k in _DEBUG_KEYWORDS):
                print(
                    "[debug][parse_model_json] parsed_span:",
                    _safe_snip(candidate, 600),
                )
            return obj
    except json.JSONDecodeError:
        pass

    # 3) Trim trailing garbage
    s = candidate
    last_brace = max(s.rfind("}"), s.rfind("]"))
    if last_brace != -1:
        trimmed = s[: last_brace + 1]
        try:
            obj = json.loads(trimmed)
            if isinstance(obj, dict):
                print("[brain:json] Salvaged valid JSON after trimming")
                if any(k in trimmed.lower() for k in _DEBUG_KEYWORDS):
                    print(
                        "[debug][parse_model_json] parsed_trimmed:",
                        _safe_snip(trimmed, 600),
                    )
                return obj
        except json.JSONDecodeError:
            pass

    # 4) Minimal fallback on replyText
    try:
        m = re.search(r'"replyText"\s*:\s*"([^"]*)"', raw)
        if m:
            reply_text = m.group(1).strip()
            if reply_text:
                lang = _guess_lang(reply_text)
                print(
                    "[brain:json] Using minimal fallback object with replyText"
                )
                if any(k in reply_text.lower() for k in _DEBUG_KEYWORDS):
                    print(
                        "[debug][parse_model_json] minimal_replyText:",
                        reply_text,
                    )
                return {
                    "replyText": reply_text,
                    "language": lang,
                    "_minimalFromFallback": True,
                }
    except Exception:
        pass

    try:
        json.loads(candidate)
    except json.JSONDecodeError as e:
        print("[brain:json] JSONDecodeError:", repr(e))
        print(
            "[brain:json] raw (truncated):",
            _safe_snip(candidate, 1500),
        )

    raise ValueError("Unable to parse JSON object from model response")


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
    Normalize items[] using candidates.
    - IDs are ONLY trusted if they match a known candidate.
    - If both name and id present but mismatch, name wins.
    - If nothing resolves to a candidate, the item is dropped.
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
        raw_id = _normalize_id(it.get("itemId"))

        if _debug_has_kw(name):
            print("[debug][normalize_items] raw_in:", name, raw_id)

        resolved_id = ""
        resolved_name = name

        if have_candidates:
            # 1) Try by name first
            if name:
                key = name.lower()
                resolved_id = cand_name_to_id.get(key, "")

            # 2) If id given but different, verify it matches that candidate's name/aliases
            if not resolved_id and raw_id:
                cand = cand_by_id.get(raw_id)
                if cand:
                    cand_name = (cand.get("name") or cand.get("title") or "").strip()
                    aliases = [
                        a.strip().lower()
                        for a in (cand.get("aliases") or [])
                        if a
                    ]
                    if not name:
                        resolved_id = raw_id
                        resolved_name = cand_name
                    else:
                        key = name.lower()
                        if (
                            key == (cand_name or "").lower()
                            or key in aliases
                        ):
                            resolved_id = raw_id
                            resolved_name = cand_name or name
                        else:
                            # name/id disagree → prefer name mapping if exists, else drop
                            nid = cand_name_to_id.get(key, "")
                            if nid and nid in cand_by_id:
                                resolved_id = nid
                                cc = cand_by_id[nid]
                                resolved_name = (
                                    cc.get("name")
                                    or cc.get("title")
                                    or name
                                ).strip()

            # 3) If we still only have name
            if not resolved_id and name:
                key = name.lower()
                nid = cand_name_to_id.get(key, "")
                if nid and nid in cand_by_id:
                    resolved_id = nid
                    cand = cand_by_id[nid]
                    resolved_name = (
                        cand.get("name")
                        or cand.get("title")
                        or name
                    ).strip()

            # 4) If we still don't have valid id → drop
            if not resolved_id or resolved_id not in cand_by_id:
                continue
        else:
            # No candidate info: very defensive, but keep if some id or name
            if not (raw_id or name):
                continue
            resolved_id = raw_id or name
            resolved_name = name or resolved_id

        if resolved_id in seen_ids:
            continue

        q = _parse_quantity_any(it.get("quantity"))
        qty = q if q is not None else 1

        row = {
            "name": resolved_name or resolved_id,
            "itemId": resolved_id,
            "quantity": qty,
        }
        out.append(row)
        seen_ids.add(resolved_id)

        if _debug_has_kw(resolved_name):
            print("[debug][normalize_items] kept:", row)

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
    Normalize suggestions[] or upsell[].
    - Only keep entries resolvable to known candidates (when candidates are present).
    - Cross-check id/name like in _normalize_items.
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
        raw_id = _normalize_id(it.get("itemId"))
        category_id = _normalize_id(it.get("categoryId"))
        price = it.get("price")
        subtitle = (it.get("subtitle") or "").strip()

        resolved_id = ""
        resolved_title = title

        if have_candidates:
            if title:
                key = title.lower()
                resolved_id = cand_name_to_id.get(key, "")

            if not resolved_id and raw_id:
                cand = cand_by_id.get(raw_id)
                if cand:
                    cand_name = (cand.get("name") or cand.get("title") or "").strip()
                    aliases = [
                        a.strip().lower()
                        for a in (cand.get("aliases") or [])
                        if a
                    ]
                    if not title:
                        resolved_id = raw_id
                        resolved_title = cand_name
                    else:
                        key = title.lower()
                        if (
                            key == (cand_name or "").lower()
                            or key in aliases
                        ):
                            resolved_id = raw_id
                            resolved_title = cand_name or title
                        else:
                            nid = cand_name_to_id.get(key, "")
                            if nid and nid in cand_by_id:
                                resolved_id = nid
                                cc = cand_by_id[nid]
                                resolved_title = (
                                    cc.get("name")
                                    or cc.get("title")
                                    or title
                                ).strip()

            if not resolved_id or resolved_id not in cand_by_id:
                # if we can't resolve, skip
                continue

            cand = cand_by_id[resolved_id]

            if not category_id:
                category_id = _normalize_id(
                    cand.get("categoryId")
                    or (cand.get("categoryIds") or [None])[0]
                )

            if price in (None, ""):
                price = cand.get("price")
        else:
            if not title:
                continue
            resolved_title = title
            if raw_id:
                resolved_id = raw_id
            if have_candidates and (not resolved_id or resolved_id in seen_ids):
                continue

        row: Dict[str, Any] = {
            "title": resolved_title or (resolved_id or ""),
        }
        if subtitle:
            row["subtitle"] = subtitle
        if resolved_id:
            row["itemId"] = resolved_id
        if category_id:
            row["categoryId"] = category_id
        if isinstance(price, (int, float)) and price >= 0:
            row["price"] = price

        out.append(row)
        if resolved_id:
            seen_ids.add(resolved_id)

        if _debug_has_kw(resolved_title):
            print("[debug][normalize_suggestions] kept:", row)

        if len(out) >= max_len:
            break

    return out


def _normalize_decision(
    raw: Any,
    has_suggestions: bool,
    has_upsell: bool,
) -> Dict[str, bool]:
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
    if not raw_ops or not isinstance(raw_ops, list):
        print("[debug][cartOps] no raw_ops from model")
        return [], False

    print(
        "[debug][cartOps] raw_ops_in:",
        _safe_snip(json.dumps(raw_ops, ensure_ascii=False), 400),
    )

    out: List[Dict[str, Any]] = []
    have_candidates = bool(cand_by_id)
    clear_all = False

    def resolve_item(op: Dict[str, Any]) -> Tuple[str, str]:
        name = (op.get("name") or op.get("title") or "").strip()
        raw_id = _normalize_id(op.get("itemId"))

        if have_candidates:
            if name:
                nid = cand_name_to_id.get(name.lower())
                if nid and nid in cand_by_id:
                    cand = cand_by_id[nid]
                    return nid, (
                        cand.get("name")
                        or cand.get("title")
                        or name
                    )

            if raw_id and raw_id in cand_by_id:
                cand = cand_by_id[raw_id]
                return raw_id, (
                    cand.get("name")
                    or cand.get("title")
                    or name
                )
            return "", ""
        else:
            if raw_id:
                return raw_id, name or raw_id
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
            print("[debug][cartOps] detected clear_all op")
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
            q = _parse_quantity_any(
                quantity
                if quantity is not None
                else (1 if op == "add" else 0),
                allow_zero=(op == "set"),
            )
            if q is None:
                q = 1 if op == "add" else 0
            if op == "add" and q <= 0:
                q = 1
            if op == "set" and q < 0:
                q = 0
            norm_quantity = q
        elif op == "delta":
            d = _parse_delta_any(delta)
            if d is None:
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

        if _debug_has_kw(name):
            print("[debug][cartOps] kept_op:", op_obj)

        if len(out) >= max_ops:
            break

    print("[debug][cartOps] normalized_ops:", out, "clear_all:", clear_all)
    return out, clear_all


# -------------------- NEW: merge DB cart + cartOps --------------------


def _merge_cart_state(
    context: Optional[Dict[str, Any]],
    cart_ops: List[Dict[str, Any]],
    clear_cart_flag: bool,
) -> Dict[str, int]:
    """
    Build final cart quantities:
    - start from Context.cartItems (DB / upstream tray)
    - apply cartOps from this turn
    - respect clearCart

    Returns: { itemId: quantity }
    """
    base: Dict[str, int] = {}

    # Seed from existing cartItems
    for it in (context or {}).get("cartItems", []):
        iid = _normalize_id(
            it.get("itemId")
            or it.get("id")
            or it.get("_id")
        )
        if not iid:
            continue
        try:
            q = int(
                it.get("quantity", it.get("qty", 0)) or 0
            )
        except Exception:
            q = 0
        if q > 0:
            base[iid] = q

    # If clearCart is triggered, start from empty
    if clear_cart_flag:
        base = {}

    # Apply ops from model
    for op in cart_ops:
        op_type = (op.get("op") or "").strip().lower()
        iid = _normalize_id(op.get("itemId"))
        if not iid:
            continue

        if op_type == "add":
            q = _parse_quantity_any(
                op.get("quantity"),
                allow_zero=False,
            ) or 1
            base[iid] = base.get(iid, 0) + q

        elif op_type == "set":
            q = _parse_quantity_any(
                op.get("quantity"),
                allow_zero=True,
            )
            if q is None:
                continue
            if q > 0:
                base[iid] = q
            else:
                base.pop(iid, None)

        elif op_type == "delta":
            d = _parse_delta_any(op.get("delta"))
            if d is None:
                continue
            new_q = base.get(iid, 0) + d
            if new_q > 0:
                base[iid] = new_q
            else:
                base.pop(iid, None)

        elif op_type == "remove":
            base.pop(iid, None)

    return base


def _materialize_items_from_qty(
    qty_map: Dict[str, int],
    cand_by_id: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Convert {itemId: qty} into [{itemId, name, quantity}],
    using menu/candidate names.
    """
    items: List[Dict[str, Any]] = []

    for iid, qty in qty_map.items():
        if qty <= 0:
            continue
        cand = cand_by_id.get(iid, {})
        name = (
            cand.get("name")
            or cand.get("title")
            or ""
        ).strip() or iid

        items.append(
            {
                "itemId": iid,
                "name": name,
                "quantity": int(qty),
            }
        )

    return items


# --------- Recover items from replyText when JSON is minimal/broken ---------


def _extract_items_from_text(
    text: str,
    cand_by_id: Dict[str, Dict[str, Any]],
    cand_name_to_id: Dict[str, str],
) -> List[Dict[str, Any]]:
    """
    Very lightweight NER: if replyText mentions known item names, treat those as items.
    Quantities default to 1 (we keep it simple).
    """
    if not text or not cand_name_to_id:
        return []

    t = text.lower()
    seen = set()
    out: List[Dict[str, Any]] = []

    for name_l, item_id in cand_name_to_id.items():
        if (
            name_l
            and name_l in t
            and item_id in cand_by_id
            and item_id not in seen
        ):
            cand = cand_by_id[item_id]
            name = (
                cand.get("name")
                or cand.get("title")
                or name_l
            ).strip()
            if not name:
                continue
            out.append(
                {
                    "name": name,
                    "itemId": item_id,
                    "quantity": 1,
                }
            )
            seen.add(item_id)

    return out


def _maybe_adjust_quantities_from_transcript(
    transcript: str,
    items: List[Dict[str, Any]],
) -> None:
    """
    If items all have default-ish qty but the transcript clearly contains a
    quantity near the item name, adjust it.
    """
    t = (transcript or "").strip().lower()
    if not t or not items:
        return

    def find_qty_for_label(label: str) -> Optional[int]:
        key = (label or "").strip().lower()
        if not key:
            return None
        idx = t.find(key)
        if idx == -1:
            return None

        before = t[max(0, idx - 24) : idx]
        after = t[idx + len(key) : idx + len(key) + 24]

        q = _parse_quantity_any(before)
        if q:
            return q
        q = _parse_quantity_any(after)
        if q:
            return q
        return None

    for it in items:
        try:
            current_q = int(it.get("quantity", 0) or 0)
        except Exception:
            current_q = 0

        if current_q > 1:
            continue

        label = (it.get("name") or "").strip()
        q = find_qty_for_label(label)
        if q and q > 0:
            it["quantity"] = q


# --------------------- voiceReplyText builder ---------------------


def _build_voice_reply_text(
    reply_text: str,
    *,
    language: str,
    model_obj: Dict[str, Any],
) -> str:
    explicit = str(model_obj.get("voiceReplyText") or "").strip()
    if explicit:
        if _debug_has_kw(explicit):
            print("[debug][voiceReplyText] explicit:", explicit)
        return explicit

    if not reply_text:
        return ""

    if language == "bn":
        return reply_text

    return ""


# --------------------- Helpers for BN templates ---------------------


def _bn_qty(n: int) -> str:
    try:
        n = int(n)
    except Exception:
        n = 1
    return f"{n}টি" if n > 0 else "১টি"


def _format_items_summary_bn(items: List[Dict[str, Any]]) -> str:
    """
    Build: '2 Crispy Chicken Burger এবং 3 Coke'
    Uses digits for clarity.
    """
    parts: List[str] = []
    for it in items:
        name = (it.get("name") or "").strip() or "আইটেম"
        try:
            q = int(it.get("quantity", 1) or 1)
        except Exception:
            q = 1
        parts.append(f"{q} {name}")

    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return " এবং ".join(parts)

    # 3+ → "a, b এবং c"
    return ", ".join(parts[:-1]) + " এবং " + parts[-1]


def _pick_upsell_pair(upsell: List[Dict[str, Any]]) -> List[str]:
    names: List[str] = []
    for u in upsell:
        t = (u.get("title") or u.get("name") or "").strip()
        if t and t not in names:
            names.append(t)
        if len(names) >= 2:
            break
    return names


def _is_negative_reply(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    # Very simple: "না" in Bangla, or short no-ish replies
    neg_kw = [
        "না",
        "না লাগবে",
        "লাগবে না",
        "চাই না",
        "dont want",
        "don't want",
        "no",
    ]
    return any(k in t for k in neg_kw) and len(t) <= 32


def _is_confirm_message(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    # Accept both bn+en confirmation cues
    confirm_kw = [
        "কনফার্ম",
        "confirm",
        "হ্যা কনফার্ম",
        "হ্যাঁ কনফার্ম",
        "অর্ডার কনফার্ম",
        "place order",
        "done",
        "ডান",
    ]
    return any(k in t for k in confirm_kw)


# --------------------- cartOps → replyText (hardcoded logic) ---------------------


def _build_reply_from_cart_ops(
    *,
    cart_ops: List[Dict[str, Any]],
    items: List[Dict[str, Any]],
    upsell: List[Dict[str, Any]],
    transcript: str,
    language: str,
    last_intent: Optional[str],
) -> str:
    """
    Hardcoded Bangla-first behavior.

    Bangla rules:
    1) Initial order with only add ops:
       "অসাধারণ চয়েস! আপনি {items} অর্ডার করতে চাইছেন। সাথে কি আপনি {u1} কিংবা {u2} নিতে চান?"
       (if upsell available)
       Else: "অসাধারণ চয়েস! আপনি {items} অর্ডার করতে চাইছেন। অর্ডারটা কি কনফার্ম করবো?"
    2) Add new product (single add) after order flow:
       "{name} আপনার ট্রে তে যোগ করা হলো, আর কিছু নিতে চান? নাকি অর্ডার কনফার্ম করবো?"
    3) Quantity change:
       Add: "{name} Xটি যোগ করা হলো। আপনি অর্ডার করতে চাইছেন {items}। অর্ডারটা কি কনফার্ম করবো?"
       Remove: "{name} Xটি বাদ দেয়া হলো। আপনি অর্ডার করতে চাইছেন {items}। অর্ডারটা কি কনফার্ম করবো?"
    English: simple generic confirmations (fallback).
    """
    if not cart_ops and not items:
        return ""

    # If English or other: lightweight generic behavior
    if language != "bn":
        parts: List[str] = []
        for op in cart_ops:
            t = (op.get("op") or "").strip().lower()
            name = (op.get("name") or "").strip() or "item"

            if t == "add":
                q = int(op.get("quantity", 1) or 1)
                parts.append(f"Added {q} x {name}")
            elif t == "delta":
                d = int(op.get("delta", 0) or 0)
                if d > 0:
                    parts.append(f"Added {d} x {name}")
                elif d < 0:
                    parts.append(f"Removed {abs(d)} x {name}")
            elif t == "set":
                q = int(op.get("quantity", 0) or 0)
                if q <= 0:
                    parts.append(f"Removed all of {name}")
                else:
                    parts.append(f"Set {name} to {q}")
            elif t == "remove":
                parts.append(f"Removed {name}")

        msg = "; ".join(parts) if parts else ""

        if items:
            items_str = ", ".join(
                f"{int(i.get('quantity', 1) or 1)} x "
                f"{(i.get('name') or '').strip() or 'item'}"
                for i in items
            )
            if msg:
                msg += f". Current order: {items_str}."
            else:
                msg = f"Current order: {items_str}."

        if msg:
            return msg + " Shall I confirm the order?"
        return "Shall I confirm the order?"

    # Bangla-specific logic from here
    t = (transcript or "").strip()

    # Priority: confirmation / negative handled outside, but keep safe
    if _is_confirm_message(t):
        return (
            "আপনার অর্ডার টি কনফার্ম করা হলো। দয়া করে ১৫ মিনিট সময় দিন, "
            "আমরা খাবারটি প্রস্তুত করছি।"
        )

    if _is_negative_reply(t):
        return (
            "গ্রেট! সব কিছু ঠিক আছে কিনা দেখে আমাকে অর্ডার কনফার্ম করতে বলুন।"
        )

    items_summary = _format_items_summary_bn(items)

    # Inspect ops
    def _op_kind(op: Dict[str, Any]) -> str:
        return (op.get("op") or "").strip().lower()

    def _op_qty(op: Dict[str, Any]) -> int:
        try:
            return int(op.get("quantity", op.get("qty", 0)) or 0)
        except Exception:
            return 0

    only_add = bool(cart_ops) and all(
        _op_kind(op) == "add" for op in cart_ops
    )

    # All ops are set with positive quantity → treat as fresh adds
    only_positive_set = bool(cart_ops) and all(
        _op_kind(op) == "set" and _op_qty(op) > 0
        for op in cart_ops
    )

    has_delta = any(_op_kind(op) == "delta" for op in cart_ops)

    # Now, only treat set as "remove-ish" when qty <= 0
    has_remove = any(
        _op_kind(op) == "remove"
        or (_op_kind(op) == "set" and _op_qty(op) <= 0)
        for op in cart_ops
    )

    # 1) Initial order: last_intent not 'order', only add ops, we have items
    if (only_add or only_positive_set) and items and (
        not last_intent or last_intent != "order"
    ):
        upsell_names = _pick_upsell_pair(upsell)
        if upsell_names:
            if len(upsell_names) == 1:
                return (
                    f"অসাধারণ চয়েস! আপনি {items_summary} অর্ডার করতে চাইছেন। "
                    f"সাথে কি আপনি {upsell_names[0]} নিতে চান?"
                )
            return (
                f"অসাধারণ চয়েস! আপনি {items_summary} অর্ডার করতে চাইছেন। "
                f"সাথে কি আপনি {upsell_names[0]} কিংবা {upsell_names[1]} নিতে চান?"
            )

        return (
            f"অসাধারণ চয়েস! আপনি {items_summary} অর্ডার করতে চাইছেন। "
            f"অর্ডারটা কি কনফার্ম করবো?"
        )

    # 2) Single add op → treat as "new product added to tray"
    if only_add and len(cart_ops) == 1:
        op = cart_ops[0]
        name = (op.get("name") or "").strip() or "আইটেম"
        return (
            f"{name} আপনার ট্রে তে যোগ করা হলো, আর কিছু নিতে চান? "
            f"নাকি অর্ডার কনফার্ম করবো?"
        )

    # 3) Quantity changes (delta / remove / set) → use first meaningful op
    if has_delta or has_remove:
        for op in cart_ops:
            kind = (op.get("op") or "").lower()
            name = (op.get("name") or "").strip() or "আইটেম"

            if kind == "delta":
                d = int(op.get("delta", 0) or 0)
                if d > 0:
                    return (
                        f"{name} {abs(d)}টি যোগ করা হলো। "
                        f"আপনি অর্ডার করতে চাইছেন {items_summary}। "
                        f"অর্ডারটা কি কনফার্ম করবো?"
                    )
                if d < 0:
                    return (
                        f"{name} {abs(d)}টি বাদ দেয়া হলো। "
                        f"আপনি অর্ডার করতে চাইছেন {items_summary}। "
                        f"অর্ডারটা কি কনফার্ম করবো?"
                    )

            if kind == "set":
                q = int(op.get("quantity", 0) or 0)
                if q <= 0:
                    return (
                        f"{name} কার্ট থেকে বাদ দেয়া হলো। "
                        f"আপনি অর্ডার করতে চাইছেন {items_summary}। "
                        f"অর্ডারটা কি কনফার্ম করবো?"
                    )
                return (
                    f"{name} পরিমাণ {q}টি করা হলো। "
                    f"আপনি অর্ডার করতে চাইছেন {items_summary}। "
                    f"অর্ডারটা কি কনফার্ম করবো?"
                )

            if kind == "remove":
                return (
                    f"{name} কার্ট থেকে বাদ দেয়া হলো। "
                    f"আপনি অর্ডার করতে চাইছেন {items_summary}। "
                    f"অর্ডারটা কি কনফার্ম করবো?"
                )

    # 4) Fallback for multiple adds / complex ops
    if items_summary:
        return (
            f"আপনি অর্ডার করতে চাইছেন {items_summary}। "
            f"অর্ডারটা কি কনফার্ম করবো?"
        )

    return "অর্ডারটা কি কনফার্ম করবো?"


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
    minimal = bool(raw_obj.get("_minimalFromFallback"))

    # 1) Normalize model-proposed items (this turn only)
    proposed_items = _normalize_items(
        raw_obj.get("items"),
        cand_by_id=cand_by_id,
        cand_name_to_id=cand_name_to_id,
    )
    has_items = bool(proposed_items)

    if _debug_has_kw(
        json.dumps(raw_obj.get("items", ""), ensure_ascii=False)
    ):
        print(
            "[debug][finalize] raw_obj.items:",
            raw_obj.get("items"),
        )
        print(
            "[debug][finalize] proposed_items:",
            proposed_items,
        )

    # 1b) If minimal JSON but replyText mentions items, recover them
    if minimal and not has_items:
        recovered = _extract_items_from_text(
            raw_obj.get("replyText", ""),
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
        )
        if recovered:
            proposed_items = _normalize_items(
                recovered,
                cand_by_id=cand_by_id,
                cand_name_to_id=cand_name_to_id,
            )
            has_items = bool(proposed_items)
            print(
                "[debug][finalize] recovered_items_from_replyText_norm:",
                proposed_items,
            )

    # 1c) Adjust quantities from transcript if they look default-ish
    if transcript and proposed_items:
        _maybe_adjust_quantities_from_transcript(
            transcript,
            proposed_items,
        )
        has_items = bool(proposed_items)

    # Minimal fallback path
    if minimal:
        valid_intents = ("order", "menu", "suggestions", "chitchat")
        if locked_intent in valid_intents:
            intent = locked_intent
        else:
            last_intent = _extract_last_intent(
                context,
                dialog_state,
            )
            intent = _infer_intent_from_query(
                transcript=transcript,
                has_items=has_items,
                last_intent=last_intent,
            )
            if intent not in valid_intents:
                intent = "chitchat"

        items = proposed_items if (intent == "order" and has_items) else []
        decision = {
            "showSuggestionsModal": False,
            "showUpsellTray": False,
        }

        print("[debug][finalize] minimal_fallback intent:", intent)
        return {
            "intent": intent,
            "items": items,
            "suggestions": [],
            "upsell": [],
            "decision": decision,
        }

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
        model_intent = _normalize_intent(
            raw_obj.get("intent"),
            has_items=has_items,
        )

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
        if locked_intent == "order":
            intent = "menu"
        else:
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

    if any(_debug_has_kw(i.get("name", "")) for i in final_items):
        print("[debug][finalize] FINAL intent:", intent)
        print("[debug][finalize] FINAL items:", final_items)
        print("[debug][finalize] FINAL suggestions:", suggestions)
        print("[debug][finalize] FINAL upsell:", upsell)
        print("[debug][finalize] FINAL decision:", decision)

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
        reply_text = (
            "আমাদের মেনু থেকে কিছু অপশন: " + ", ".join(titles) + "।"
        )
    else:
        reply_text = (
            "Here are some options from our menu: "
            + ", ".join(titles)
            + "."
        )

    suggestions = []
    for it in top:
        name = it.get("name")
        if not name:
            continue
        suggestions.append(
            {
                "title": name,
                "itemId": _normalize_id(
                    it.get("id")
                    or it.get("_id")
                    or it.get("itemId")
                ),
                "price": it.get("price"),
            }
        )

    if any(
        _debug_has_kw(s.get("title", ""))
        for s in suggestions
    ):
        print("[debug][fallback_menu] reply_text:", reply_text)
        print("[debug][fallback_menu] suggestions:", suggestions)

    return {
        "replyText": reply_text,
        "intent": (
            "menu"
            if locked_intent == "menu"
            else "suggestions"
        ),
        "language": lang,
        "items": [],
        "suggestions": suggestions,
        "upsell": [],
        "decision": {
            "showSuggestionsModal": locked_intent
            == "suggestions",
            "showUpsellTray": False,
        },
        "cartOps": [],
        "clearCart": False,
        "fallback": True,
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
    context: Optional[Dict[str, Any]] = None,
    suggestion_candidates: Optional[List[Dict[str, Any]]] = None,
    upsell_candidates: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
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
            "stateLen": len(
                dialog_state or {}
                if isinstance(dialog_state, dict)
                else {}
            ),
            "cartOps": [],
            "clearCart": False,
        }
        reply_text = (
            "Sorry, I didn’t catch that. Could you say that again?"
        )
        voice_reply_text = _build_voice_reply_text(
            reply_text,
            language=lang,
            model_obj={},
        )
        if voice_reply_text:
            meta["voiceReplyText"] = voice_reply_text

        print("[brain] final replyText:", reply_text)
        print(
            "[brain] final voiceReplyText:",
            meta.get("voiceReplyText", ""),
        )
        try:
            print(
                "[brain] final meta.suggestions:",
                [
                    s.get("title")
                    for s in meta.get(
                        "suggestions", []
                    )
                ],
            )
        except Exception:
            print(
                "[brain] final meta.suggestions: <error printing>"
            )
        return {
            "replyText": reply_text,
            "meta": meta,
        }

    # Debug: does menu_snapshot contain our keywords?
    if menu_snapshot and menu_snapshot.get("items"):
        for it in (menu_snapshot.get("items") or []):
            name = (it.get("name") or "").lower()
            if _debug_has_kw(name):
                print(
                    "[debug][generate_reply] menu_snapshot has:",
                    it.get("name"),
                    it.get("id")
                    or it.get("_id")
                    or it.get("itemId"),
                )

    # Decide language + locked intent up front
    lang_hint = _resolve_lang_hint(locale, transcript)
    locked_intent = await _decide_locked_intent(
        transcript=transcript,
        context=context,
        dialog_state=dialog_state,
    )

    # Unified candidate pool: suggestions + upsell + full menu
    unified_candidates: List[Dict[str, Any]] = (
        suggestion_candidates or []
    ) + (upsell_candidates or [])
    if menu_snapshot and menu_snapshot.get("items"):
        unified_candidates = unified_candidates + (
            menu_snapshot.get("items") or []
        )

    print(
        "[debug][generate_reply] unified_candidates count:",
        len(unified_candidates),
    )
    _debug_log_kw(
        "[debug][generate_reply] unified_candidate:",
        unified_candidates,
    )

    cand_by_id, cand_name_to_id = _build_candidate_index(
        unified_candidates,
        [],
    )

    # System message
    messages: List[Dict[str, str]] = [
        {
            "role": "system",
            "content": _build_system_with_lang(
                lang_hint,
                locked_intent,
            ),
        }
    ]

    # Optional DialogState
    state_line = _build_state_line(dialog_state)
    if state_line:
        messages.append(state_line)

    # Recent history
    if history:
        for t in history[-8:]:
            r = t.get("role")
            c = (t.get("content") or "").strip()
            if r in ("user", "assistant") and c:
                messages.append(
                    {"role": r, "content": c}
                )

    # INPUT payload
    user_payload = _build_user_input_payload(
        transcript=transcript,
        context=context,
        suggestion_candidates=suggestion_candidates,
        upsell_candidates=upsell_candidates,
        menu_snapshot=menu_snapshot,
        locked_intent=locked_intent,
    )
    messages.append(
        {
            "role": "user",
            "content": f"[INPUT]: {user_payload}",
        }
    )

    try:
        raw = await _call_openai(messages)
        obj = _parse_model_json(raw)

        if any(
            _debug_has_kw(
                json.dumps(obj, ensure_ascii=False)
            )
            for _ in [None]
        ):
            print(
                "[debug][generate_reply] model_obj:",
                _safe_snip(
                    json.dumps(
                        obj, ensure_ascii=False
                    ),
                    800,
                ),
            )

        # Model-provided language is advisory; clamp to hint if given
        reply_text = str(obj.get("replyText") or "").strip()
        language = (
            obj.get("language") or ""
        ).strip() or _guess_lang(
            reply_text or transcript
        )
        if lang_hint in ("bn", "en"):
            language = lang_hint

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

        # Normalize cartOps / clearCart
        cart_ops, clear_all_from_ops = _normalize_cart_ops(
            obj.get("cartOps"),
            cand_by_id=cand_by_id,
            cand_name_to_id=cand_name_to_id,
        )

        # If it's an order with items but no cartOps → synthesize ADD ops
        # from the model snapshot (this turn's items)
        if (
            intent == "order"
            and items
            and not cart_ops
            and not clear_all_from_ops
        ):
            synth_ops: List[Dict[str, Any]] = []
            for it in items:
                iid = it.get("itemId")
                qty = int(it.get("quantity", 0) or 0)
                if iid and qty > 0:
                    synth_ops.append(
                        {
                            "op": "add",
                            "itemId": iid,
                            "name": it.get("name"),
                            "quantity": qty,
                        }
                    )
            if synth_ops:
                cart_ops = synth_ops
                print(
                    "[debug][cartOps] synthesized_from_items:",
                    cart_ops,
                )

        clear_cart_flag = bool(
            obj.get("clearCart") is True
            or clear_all_from_ops
        )

        # --- NEW: compute real tray from DB cartItems + this turn's ops ---
        if intent == "order":
            merged_qty = _merge_cart_state(
                context or {},
                cart_ops,
                clear_cart_flag,
            )
            # override items to be the full, merged cart items
            items = _materialize_items_from_qty(
                merged_qty,
                cand_by_id,
            )
        else:
            # for non-order intents, items should not pretend to be full tray
            if clear_cart_flag:
                items = []

        # ---------- Hardcoded replyText logic (order flows first) ----------
        is_neg = _is_negative_reply(transcript)
        is_conf = _is_confirm_message(transcript)

        if clear_cart_flag:
            # Clear cart has highest precedence
            if language == "bn":
                reply_text = (
                    "আপনার ট্রে খালি করা হলো। আর কিছু নিতে চান?"
                )
            else:
                reply_text = (
                    "Your tray has been cleared. Anything else?"
                )

        elif intent == "order" and language == "bn":
            if is_conf:
                # Final confirmation reply
                reply_text = (
                    "আপনার অর্ডার টি কনফার্ম করা হলো। "
                    "দয়া করে ১৫ মিনিট সময় দিন, আমরা খাবারটি প্রস্তুত করছি।"
                )
            elif is_neg:
                # After upsell declined
                reply_text = (
                    "গ্রেট! সব কিছু ঠিক আছে কিনা দেখে আমাকে "
                    "অর্ডার কনফার্ম করতে বলুন।"
                )
            elif cart_ops or items:
                # Use deterministic cart-op-based template
                last_intent = _extract_last_intent(
                    context,
                    dialog_state,
                )
                reply_text = _build_reply_from_cart_ops(
                    cart_ops=cart_ops,
                    items=items,
                    upsell=upsell,
                    transcript=transcript,
                    language=language,
                    last_intent=last_intent,
                )
            # else: keep whatever minimal or fallback (rare edge)

        elif intent == "order":
            # Non-Bangla order → simple deterministic from cartOps/items
            if clear_cart_flag:
                reply_text = (
                    "Your tray has been cleared. Anything else?"
                )
            elif is_conf:
                reply_text = (
                    "Your order is confirmed. Please allow 15 minutes for preparation."
                )
            elif cart_ops or items:
                last_intent = _extract_last_intent(
                    context,
                    dialog_state,
                )
                reply_text = _build_reply_from_cart_ops(
                    cart_ops=cart_ops,
                    items=items,
                    upsell=upsell,
                    transcript=transcript,
                    language=language,
                    last_intent=last_intent,
                )

        # Non-order intents: keep previous behavior if reply_text empty
        if (
            intent == "suggestions"
            and suggestions
            and not reply_text
        ):
            names = [
                s["title"]
                for s in suggestions
                if s.get("title")
            ]
            if names:
                reply_text = (
                    f"এগুলো সাজেস্ট করছি: {', '.join(names)}"
                    if language == "bn"
                    else (
                        "Here are some options I recommend: "
                        + ", ".join(names)
                    )
                )
            else:
                reply_text = (
                    "এগুলো সাজেস্ট করছি:"
                    if language == "bn"
                    else "Here are some options I recommend:"
                )

        if (
            intent in ("menu", "chitchat")
            and not reply_text
        ):
            reply_text = (
                "ঠিক আছে।"
                if language == "bn"
                else "Alright."
            )

        # Canonicalize names & fix false unavailability
        reply_text = _canonicalize_reply_text(
            reply_text=reply_text,
            model_items=items,
            menu_snapshot=menu_snapshot,
        )
        reply_text = _fix_false_unavailability(
            reply_text,
            menu_snapshot,
        )

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
            "stateLen": len(
                dialog_state or {}
                if isinstance(dialog_state, dict)
                else {}
            ),
            "hasCandidates": bool(cand_by_id),
            "contextSnapshot": context or None,
            "cartOps": cart_ops,
            "clearCart": clear_cart_flag,
        }

        voice_reply_text = _build_voice_reply_text(
            reply_text,
            language=language,
            model_obj={},
        )
        if voice_reply_text:
            meta["voiceReplyText"] = voice_reply_text

        if any(
            _debug_has_kw(i.get("name", ""))
            for i in items
        ):
            print(
                "[debug][generate_reply] FINAL intent:",
                intent,
            )
            print(
                "[debug][generate_reply] FINAL items:",
                items,
            )
            print(
                "[debug][generate_reply] FINAL cartOps:",
                cart_ops,
            )
            print(
                "[debug][generate_reply] FINAL replyText:",
                reply_text,
            )

        print("[brain] final replyText:", reply_text)
        print(
            "[brain] final voiceReplyText:",
            meta.get("voiceReplyText", ""),
        )
        try:
            print(
                "[brain] final meta.suggestions:",
                [
                    s.get("title")
                    for s in meta.get(
                        "suggestions", []
                    )
                ],
            )
        except Exception:
            print(
                "[brain] final meta.suggestions: <error printing>"
            )

        return {
            "replyText": reply_text,
            "meta": meta,
        }

    except Exception as e:
        lang = _guess_lang(transcript)
        print(
            "[debug][generate_reply] exception:",
            repr(e),
        )

        menu_fallback = _fallback_menu_reply(
            transcript=transcript,
            lang=lang,
            locked_intent=locked_intent,
            menu_snapshot=menu_snapshot,
        )
        if menu_fallback:
            reply_text = menu_fallback["replyText"]
            meta = {
                "model": OPENAI_CHAT_MODEL,
                "language": menu_fallback[
                    "language"
                ],
                "intent": menu_fallback[
                    "intent"
                ],
                "lockedIntent": locked_intent,
                "items": menu_fallback[
                    "items"
                ],
                "suggestions": menu_fallback[
                    "suggestions"
                ],
                "upsell": menu_fallback[
                    "upsell"
                ],
                "decision": menu_fallback[
                    "decision"
                ],
                "tenant": tenant,
                "branch": branch,
                "channel": channel,
                "conversationId": conversation_id,
                "userId": user_id,
                "error": str(e),
                "fallback": True,
                "ctxLen": len(history or []),
                "stateLen": len(
                    dialog_state or {}
                    if isinstance(
                        dialog_state, dict
                    )
                    else {}
                ),
                "hasCandidates": bool(
                    menu_snapshot
                    and menu_snapshot.get(
                        "items"
                    )
                ),
                "cartOps": menu_fallback[
                    "cartOps"
                ],
                "clearCart": menu_fallback[
                    "clearCart"
                ],
            }

            voice_reply_text = _build_voice_reply_text(
                reply_text,
                language=menu_fallback[
                    "language"
                ],
                model_obj={},
            )
            if voice_reply_text:
                meta["voiceReplyText"] = (
                    voice_reply_text
                )

            print(
                "[brain] fallback menu replyText:",
                reply_text,
            )
            print(
                "[brain] final voiceReplyText:",
                meta.get(
                    "voiceReplyText",
                    "",
                ),
            )
            try:
                print(
                    "[brain] final meta.suggestions:",
                    [
                        s.get("title")
                        for s in meta.get(
                            "suggestions",
                            [],
                        )
                    ],
                )
            except Exception:
                print(
                    "[brain] final meta.suggestions: <error printing>"
                )

            return {
                "replyText": reply_text,
                "meta": meta,
            }

        text = (
            "দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?"
            if lang == "bn"
            else (
                "Sorry, I’m having trouble. Could you try once more?"
            )
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
            "stateLen": len(
                dialog_state or {}
                if isinstance(dialog_state, dict)
                else {}
            ),
            "hasCandidates": bool(
                suggestion_candidates
                or upsell_candidates
            ),
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
        print(
            "[brain] final voiceReplyText:",
            meta.get("voiceReplyText", ""),
        )
        try:
            print(
                "[brain] final meta.suggestions:",
                [
                    s.get("title")
                    for s in meta.get(
                        "suggestions",
                        [],
                    )
                ],
            )
        except Exception:
            print(
                "[brain] final meta.suggestions: <error printing>"
            )

        return {
            "replyText": text,
            "meta": meta,
        }


__all__ = ["generate_reply"]
