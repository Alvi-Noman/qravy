"""H: what the waiter's offers do — every offer (offers.py), its outcome next turn, and each conversation's tray total,
per restaurant. The admin's "Upsell this week" card reads stats().

  upsell_offers    one per offer: type, moment, A/B arm, outcome (pending → accepted / declined / ignored), revenue
  upsell_sessions  one per conversation: its arm, offers / outcomes, revenue, the tray's last total, whether the
                   conversation stopped right after an offer
"""
import time
from collections import defaultdict
from typing import Any, Dict, Optional

ENDED_AFTER_S = 10 * 60  # quiet this long after an offer → the conversation ended on it


def record(db: Any, *, tenant: Optional[str], branch: Optional[str], session: Optional[str], meta: Dict[str, Any],
           now: Optional[float] = None) -> None:
    """Called after every waiter turn. Never raises (stats must not break a reply)."""
    if db is None or not tenant or not session:
        return
    now = now or time.time()
    try:
        sid = f"{tenant}|{session}"
        inc: Dict[str, float] = {"turns": 1}
        offer = meta.get("upsellOffer") if isinstance(meta.get("upsellOffer"), dict) else None
        outcome = meta.get("upsellOutcome") if isinstance(meta.get("upsellOutcome"), dict) else None
        if outcome and outcome.get("offerId"):
            kind = str(outcome.get("outcome") or "ignored")
            revenue = float(outcome.get("value") or 0) if kind == "accepted" else 0.0
            db.upsell_offers.update_one({"_id": outcome["offerId"], "outcome": "pending"},
                                        {"$set": {"outcome": kind, "outcomeAt": now, "revenue": revenue}})
            inc[kind] = 1
            inc["revenue"] = revenue
        if offer and offer.get("id"):
            db.upsell_offers.insert_one({
                "_id": offer["id"], "tenant": tenant, "branch": branch, "session": session, "at": now,
                "type": offer.get("type"), "moment": offer.get("moment"), "arm": offer.get("arm") or {},
                "itemIds": offer.get("item_ids") or [], "value": float(offer.get("value") or 0),
                "outcome": "pending", "revenue": 0.0,
            })
            inc["offers"] = 1
        sets: Dict[str, Any] = {"lastAt": now, "lastWasOffer": bool(offer)}
        if isinstance(meta.get("traySubtotal"), (int, float)):
            sets["lastSubtotal"] = float(meta["traySubtotal"])
        if (meta.get("decision") or {}).get("orderPlaced"):
            sets["placed"] = True
            total = (meta.get("order") or {}).get("total")
            if isinstance(total, (int, float)):
                sets["lastSubtotal"] = float(total)
        on_insert: Dict[str, Any] = {"tenant": tenant, "branch": branch, "session": session, "firstAt": now}
        arm = meta.get("upsellArm") or (offer or {}).get("arm")
        if isinstance(arm, dict) and arm:
            sets["arm"] = arm  # every conversation, offered or not — the arms are compared on all of them
        db.upsell_sessions.update_one({"_id": sid}, {"$set": sets, "$inc": inc, "$setOnInsert": on_insert}, upsert=True)
    except Exception as e:
        print("[upsell-stats] record failed:", repr(e))


def _arm_key(arm: Any) -> str:
    arm = arm if isinstance(arm, dict) else {}
    return f"{arm.get('wording') or '—'} · {arm.get('timing') or '—'}"


def _mean(xs: list) -> Optional[float]:
    return round(sum(xs) / len(xs), 2) if xs else None


def stats(db: Any, tenant: str, days: int = 7, now: Optional[float] = None) -> Dict[str, Any]:
    """The restaurant's last `days`: take rate, extra revenue, order value with vs without an accepted offer, how
    often a conversation ended right after an offer — overall, per offer type and per A/B arm."""
    now = now or time.time()
    since = now - days * 86400
    offers = list(db.upsell_offers.find({"tenant": tenant, "at": {"$gte": since}}))
    sessions = list(db.upsell_sessions.find({"tenant": tenant, "lastAt": {"$gte": since}}))

    def summary(off: list, ses: list) -> Dict[str, Any]:
        n = {k: sum(1 for o in off if o.get("outcome") == k) for k in ("accepted", "declined", "ignored", "pending")}
        decided = n["accepted"] + n["declined"] + n["ignored"]
        with_offer = [s for s in ses if s.get("offers")]
        ended = [s for s in with_offer if s.get("lastWasOffer") and now - float(s.get("lastAt") or now) > ENDED_AFTER_S]
        took = [float(s.get("lastSubtotal") or 0) for s in ses if s.get("accepted") and s.get("lastSubtotal")]
        not_took = [float(s.get("lastSubtotal") or 0) for s in ses if not s.get("accepted") and s.get("lastSubtotal")]
        aov_with, aov_without = _mean(took), _mean(not_took)
        return {
            "offers": len(off), **n,
            "takeRate": round(n["accepted"] / decided, 3) if decided else None,
            "revenue": round(sum(float(o.get("revenue") or 0) for o in off), 2),
            "sessions": len(ses), "sessionsWithOffer": len(with_offer),
            "aovWithAccepted": aov_with, "aovWithout": aov_without,
            "aovLift": round(aov_with - aov_without, 2) if aov_with is not None and aov_without is not None else None,
            "endedAfterOfferRate": round(len(ended) / len(with_offer), 3) if with_offer else None,
        }

    by_type: Dict[str, list] = defaultdict(list)
    for o in offers:
        by_type[str(o.get("type") or "other")].append(o)
    arms_off: Dict[str, list] = defaultdict(list)
    for o in offers:
        arms_off[_arm_key(o.get("arm"))].append(o)
    arms_ses: Dict[str, list] = defaultdict(list)
    for s in sessions:
        if s.get("arm"):
            arms_ses[_arm_key(s.get("arm"))].append(s)
    return {
        "tenant": tenant, "days": days, **summary(offers, sessions),
        "byType": {t: {k: v for k, v in summary(o, []).items() if k in ("offers", "accepted", "takeRate", "revenue")}
                   for t, o in sorted(by_type.items())},
        "byArm": {a: summary(arms_off.get(a, []), arms_ses.get(a, [])) for a in sorted(set(arms_off) | set(arms_ses))},
    }
