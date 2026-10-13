"""The admin's "AI conversations" page: every conversation the waiter had at a restaurant, and turn by turn what it
heard, what it understood and what it said. Read from the transcripts the waiter already stores (one per turn,
kept 30 days); owners and admins only (server.handle_conversations)."""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

# the turns the guest wasn't understood at all — stored for this page, never exported as training data
UNHEARD = "unheard"

_LIST_FIELDS = {"session": 1, "ts": 1, "text": 1, "status": 1, "engine": 1, "ai.meta.language": 1,
                "ai.meta.guards": 1, "ai.meta.fallback": 1, "ai.meta.decision.orderPlaced": 1,
                "branch": 1, "location": 1, "table": 1, "channel": 1}


def _iso(ts: Any) -> Optional[str]:
    return ts.isoformat() + "Z" if isinstance(ts, datetime) else None


def _flags(doc: Dict[str, Any]) -> List[str]:
    meta = (doc.get("ai") or {}).get("meta") or {}
    out = [str(g) for g in meta.get("guards") or []]
    if meta.get("fallback"):
        out.append("model_unavailable")
    return list(dict.fromkeys(out))


def list_conversations(db: Any, tenant: str, *, days: int = 7, location: Optional[str] = None, limit: int = 100,
                       now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """The restaurant's conversations in the last `days`, newest first (one per guest session)."""
    since = (now or datetime.utcnow()) - timedelta(days=days)
    q: Dict[str, Any] = {"tenant": tenant, "ts": {"$gte": since}}
    if location:
        q["location"] = location
    convos: Dict[str, Dict[str, Any]] = {}
    for d in db.transcripts.find(q, _LIST_FIELDS).sort("ts", 1):
        sid = d.get("session") or "anon"
        c = convos.get(sid)
        if c is None:
            c = convos[sid] = {"session": sid, "startedAt": d.get("ts"), "lastAt": d.get("ts"), "turns": 0,
                               "unheard": 0, "flagged": 0, "ordered": False, "preview": "", "language": None,
                               "table": None, "channel": None, "branch": None}
        meta = (d.get("ai") or {}).get("meta") or {}
        c["turns"] += 1
        c["lastAt"] = d.get("ts")
        if d.get("status") == UNHEARD:
            c["unheard"] += 1
        elif not c["preview"]:
            c["preview"] = str(d.get("text") or "")[:120]
        if _flags(d):
            c["flagged"] += 1
        if (meta.get("decision") or {}).get("orderPlaced"):
            c["ordered"] = True
        for k in ("table", "channel", "branch"):
            c[k] = d.get(k) or c[k]
        c["language"] = meta.get("language") or c["language"]
    out = sorted(convos.values(), key=lambda c: c["lastAt"] or datetime.min, reverse=True)[:limit]
    for c in out:
        c["startedAt"], c["lastAt"] = _iso(c["startedAt"]), _iso(c["lastAt"])
    return out


def turn_view(doc: Dict[str, Any]) -> Dict[str, Any]:
    """One turn as the admin reads it: heard → understood → said."""
    ai = doc.get("ai") or {}
    meta = ai.get("meta") or {}
    heard = str(doc.get("text") or "")
    cleaned = str(doc.get("text_norm") or "")
    corrections = []
    for ch in doc.get("norm_changes") or []:
        if isinstance(ch, (list, tuple)) and len(ch) >= 2 and ch[0] != ch[1]:
            corrections.append({"from": str(ch[0]), "to": str(ch[1])})
    actions = []
    for op in meta.get("cartOps") or []:
        if isinstance(op, dict) and op.get("op"):
            actions.append({k: op.get(k) for k in ("op", "name", "quantity", "variant", "note") if op.get(k) not in (None, "")})
    if meta.get("clearCart"):
        actions.append({"op": "clear"})
    decision = meta.get("decision") or {}
    order = meta.get("order") or {}
    service = meta.get("serviceRequest") if isinstance(meta.get("serviceRequest"), dict) else None
    return {
        "at": _iso(doc.get("ts")),
        "input": "typed" if doc.get("engine") == "typed" else "voice",
        "heard": heard,
        "unheard": doc.get("status") == UNHEARD,
        "understood": {
            "text": cleaned if cleaned and cleaned != heard else None,
            "corrections": corrections,
            "language": meta.get("language"),
            "intent": meta.get("intent"),
            "topic": meta.get("topic"),
            "actions": actions,
            "mentioned": [m.get("name") for m in meta.get("mentionedItems") or [] if isinstance(m, dict) and m.get("name")],
            "suggested": [s.get("title") for s in meta.get("suggestions") or [] if isinstance(s, dict) and s.get("title")],
            "serviceRequest": {"type": service.get("type"), "note": service.get("note")} if service else None,
            "orderPlaced": bool(decision.get("orderPlaced")),
            "orderNumber": order.get("orderNumber"),
        },
        "said": ai.get("replyText") or "",
        "flags": _flags(doc),
    }


def conversation(db: Any, tenant: str, session: str, limit: int = 500) -> List[Dict[str, Any]]:
    """Every turn of one conversation at this restaurant, oldest first."""
    docs = db.transcripts.find({"tenant": tenant, "session": session}).sort("ts", 1).limit(limit)
    return [turn_view(d) for d in docs]
