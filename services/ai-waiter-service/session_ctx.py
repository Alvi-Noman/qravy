# services/ai-waiter-service/session_ctx.py
from __future__ import annotations
from collections import defaultdict, deque
from typing import Deque, Dict, List, Tuple, Optional, Any
import os

# how many recent turns to keep verbatim
MAX_TURNS = int(os.environ.get("SESSION_CTX_TURNS", "3"))

# session key is (tenant, sessionId)
Key = Tuple[str, str]

SESSION_CTX: Dict[Key, Deque[Dict[str, str]]] = defaultdict(lambda: deque(maxlen=MAX_TURNS))
SESSION_STATE: Dict[Key, Dict[str, Any]] = {}  # tiny dialog state

def skey(tenant: Optional[str], sid: Optional[str]) -> Key:
    return ((tenant or "unknown").strip(), (sid or "anon").strip())

def get_history(tenant: Optional[str], sid: Optional[str]) -> List[Dict[str, str]]:
    return list(SESSION_CTX[skey(tenant, sid)])

def push_user(tenant: Optional[str], sid: Optional[str], text: str) -> None:
    if text:
        SESSION_CTX[skey(tenant, sid)].append({"role": "user", "content": text})

def push_assistant(tenant: Optional[str], sid: Optional[str], text: str) -> None:
    if text:
        SESSION_CTX[skey(tenant, sid)].append({"role": "assistant", "content": text})

def get_state(tenant: Optional[str], sid: Optional[str]) -> Dict[str, Any]:
    return SESSION_STATE.get(skey(tenant, sid), {})

def update_state(tenant: Optional[str], sid: Optional[str], *, meta: Dict[str, Any] | None, user_text: str | None = None) -> None:
    """
    Keep a minimal dialog state:
      - last intent
      - last language
      - last up to 4 items (name+id)
      - naive unresolved slots (if model says order but no quantity)
    """
    key = skey(tenant, sid)
    prev = SESSION_STATE.get(key, {}) or {}

    intent = (meta or {}).get("intent") or prev.get("intent")
    lang   = (meta or {}).get("language") or prev.get("lang")
    items  = (meta or {}).get("items") or prev.get("items") or []

    # cap items to 4, map to compact representation
    comp_items = []
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
        has_qty = any(((it or {}).get("quantity") or 0) for it in (meta or {}).get("items") or [])
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
