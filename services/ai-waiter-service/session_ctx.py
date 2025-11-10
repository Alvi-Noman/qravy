from __future__ import annotations
from collections import defaultdict, deque
from typing import Deque, Dict, List, Tuple, Optional, Any
import os
import time

# how many recent turns to keep verbatim
MAX_TURNS = int(os.environ.get("SESSION_CTX_TURNS", "3"))

# idle TTL in seconds (default: 10 minutes)
SESSION_IDLE_TTL_SECONDS = int(os.environ.get("SESSION_IDLE_TTL_SECONDS", "600"))

# session key is (tenant, sessionId)
Key = Tuple[str, str]

SESSION_CTX: Dict[Key, Deque[Dict[str, str]]] = defaultdict(
    lambda: deque(maxlen=MAX_TURNS)
)
SESSION_STATE: Dict[Key, Dict[str, Any]] = {}  # tiny dialog state

# optional in-memory cart snapshot (per tenant+session, GC'ed with sessions)
CART_STATE: Dict[Key, Dict[str, Any]] = {}

# last activity timestamps for TTL
SESSION_LAST_ACTIVITY: Dict[Key, float] = {}


def skey(tenant: Optional[str], sid: Optional[str]) -> Key:
    return ((tenant or "unknown").strip(), (sid or "anon").strip())


def _touch(key: Key) -> None:
    """
    Mark a session as active 'now'.
    """
    SESSION_LAST_ACTIVITY[key] = time.time()


def _gc_expired() -> None:
    """
    Remove sessions that have been idle longer than SESSION_IDLE_TTL_SECONDS.
    Called opportunistically on each public API call.
    """
    ttl = SESSION_IDLE_TTL_SECONDS
    if ttl <= 0:
        return

    now = time.time()
    # Collect first to avoid mutating while iterating
    expired: List[Key] = [
        k for k, ts in SESSION_LAST_ACTIVITY.items()
        if (now - ts) > ttl
    ]

    if not expired:
        return

    for k in expired:
        SESSION_LAST_ACTIVITY.pop(k, None)
        SESSION_CTX.pop(k, None)
        SESSION_STATE.pop(k, None)
        CART_STATE.pop(k, None)

    if expired:
        print(f"[session_ctx] GC cleared {len(expired)} idle session(s)")


def get_history(tenant: Optional[str], sid: Optional[str]) -> List[Dict[str, str]]:
    key = skey(tenant, sid)
    _gc_expired()
    _touch(key)
    return list(SESSION_CTX[key])


def push_user(tenant: Optional[str], sid: Optional[str], text: str) -> None:
    if not text:
        return
    key = skey(tenant, sid)
    _gc_expired()
    SESSION_CTX[key].append({"role": "user", "content": text})
    _touch(key)


def push_assistant(tenant: Optional[str], sid: Optional[str], text: str) -> None:
    if not text:
        return
    key = skey(tenant, sid)
    _gc_expired()
    SESSION_CTX[key].append({"role": "assistant", "content": text})
    _touch(key)


def get_state(tenant: Optional[str], sid: Optional[str]) -> Dict[str, Any]:
    key = skey(tenant, sid)
    _gc_expired()
    _touch(key)
    return SESSION_STATE.get(key, {})


def update_state(
    tenant: Optional[str],
    sid: Optional[str],
    *,
    meta: Dict[str, Any] | None,
    user_text: str | None = None,
) -> None:
    """
    Keep a minimal dialog state:
      - last intent
      - last language
      - last up to 4 items (name+id)
      - naive unresolved slots (if model says order but no quantity)
    """
    key = skey(tenant, sid)
    _gc_expired()

    prev = SESSION_STATE.get(key, {}) or {}

    intent = (meta or {}).get("intent") or prev.get("intent")
    lang = (meta or {}).get("language") or prev.get("lang")
    items = (meta or {}).get("items") or prev.get("items") or []

    # cap items to 4, map to compact representation
    comp_items: List[Dict[str, Any]] = []
    seen = set()
    for it in items:
        nm = (it or {}).get("name")
        iid = (it or {}).get("itemId")
        if not nm:
            continue
        k = f"{iid or ''}:{nm}"
        if k in seen:
            continue
        comp_items.append({"name": nm, "id": iid})
        seen.add(k)
        if len(comp_items) >= 4:
            break

    unresolved: List[str] = list(prev.get("unresolved", []))
    # naive slot guess: if intent=order and no explicit quantity in items → unresolved "quantity"
    if intent == "order":
        has_qty = any(
            ((it or {}).get("quantity") or 0)
            for it in (meta or {}).get("items") or []
        )
        if not has_qty and "quantity" not in unresolved:
            unresolved.append("quantity")
    else:
        # clear quantity slot for non-order intents
        unresolved = [u for u in unresolved if u != "quantity"]

    SESSION_STATE[key] = {
        "intent": intent,
        "lang": lang,
        "items": comp_items,
        "unresolved": unresolved[:4],
    }

    _touch(key)


# -------- Optional cart helpers (used by cart HTTP API / other services) --------

def get_cart(tenant: Optional[str], sid: Optional[str]) -> Dict[str, Any]:
    """
    Return in-memory cart snapshot for this (tenant, session).
    Shape is flexible; typically: { "items": [...], "updatedAt": ts }.
    """
    key = skey(tenant, sid)
    _gc_expired()
    _touch(key)
    return CART_STATE.get(key, {})


def set_cart(
    tenant: Optional[str],
    sid: Optional[str],
    items: List[Dict[str, Any]],
    updated_at: Optional[float] = None,
) -> None:
    """
    Store/replace cart for this (tenant, session).
    If items is empty, cart entry is removed.
    """
    key = skey(tenant, sid)
    _gc_expired()

    if items:
        CART_STATE[key] = {
            "items": items,
            "updatedAt": float(updated_at or time.time()),
        }
        _touch(key)
    else:
        CART_STATE.pop(key, None)
        _touch(key)
