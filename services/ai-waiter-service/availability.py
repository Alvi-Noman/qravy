"""
Time-based availability for the AI waiter.

Mirrors the Node rules (services/auth-service/src/utils/availability.ts):
restaurant/branch opening hours, category serving hours (with per-branch
overrides), item hours and "sold out" switches — all evaluated in the
restaurant's IANA time zone (default Asia/Dhaka).

Window format: {"days": [0..6] (0 = Sunday), "start": "HH:mm", "end": "HH:mm"};
end < start means the window runs past midnight.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

DEFAULT_TZ = "Asia/Dhaka"
_DAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
_ALL = [0, 1, 2, 3, 4, 5, 6]

# Same defaults as the Node service (Settings → Hours & availability → Service periods)
DEFAULT_PERIODS = [
    {"id": "breakfast", "name": "Breakfast", "days": _ALL, "start": "07:00", "end": "11:00"},
    {"id": "lunch", "name": "Lunch", "days": _ALL, "start": "12:00", "end": "15:00"},
    {"id": "afternoon", "name": "Afternoon", "days": _ALL, "start": "15:00", "end": "18:00"},
    {"id": "dinner", "name": "Dinner", "days": _ALL, "start": "18:00", "end": "23:00"},
    {"id": "late-night", "name": "Late night", "days": _ALL, "start": "22:00", "end": "02:00"},
]


def resolve_windows(period_ids, custom, periods) -> List[Dict[str, Any]]:
    """Service periods referenced by id + custom windows (unknown ids ignored)."""
    by_id = {p.get("id"): p for p in (periods or [])}
    out = []
    for pid in period_ids or []:
        p = by_id.get(pid)
        if p:
            out.append({"days": p.get("days") or _ALL, "start": p["start"], "end": p["end"]})
    return out + list(custom or [])


def _within_dates(frm: Optional[str], until: Optional[str], tz: Optional[str], now: Optional[datetime]) -> bool:
    today = local_now(tz, now).strftime("%Y-%m-%d")
    if frm and today < frm:
        return False
    if until and today > until:
        return False
    return True


def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _zone(tz: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def local_now(tz: Optional[str], now: Optional[datetime] = None) -> datetime:
    base = now or datetime.now(dt_timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=dt_timezone.utc)
    return base.astimezone(_zone(tz))


def _weekday_sun0(d: datetime) -> int:
    # Python: Monday=0 … Sunday=6  →  Sunday=0 … Saturday=6
    return (d.weekday() + 1) % 7


def is_within(windows: Optional[Iterable[Dict[str, Any]]], tz: Optional[str], now: Optional[datetime] = None) -> bool:
    """True when `now` (restaurant time) is inside any window; empty = always."""
    wins = [w for w in (windows or []) if isinstance(w, dict)]
    if not wins:
        return True
    t = local_now(tz, now)
    day = _weekday_sun0(t)
    prev = (day + 6) % 7
    cur = t.hour * 60 + t.minute
    for w in wins:
        try:
            s, e = _to_min(w["start"]), _to_min(w["end"])
            days = [int(x) for x in (w.get("days") or [])]
        except Exception:
            continue
        if s < e:
            if day in days and s <= cur < e:
                return True
        elif (day in days and cur >= s) or (prev in days and cur < e):
            return True
    return False


def _fmt_time(hhmm: str) -> str:
    h, m = [int(x) for x in hhmm.split(":")]
    suffix = "am" if h < 12 else "pm"
    h12 = 12 if h % 12 == 0 else h % 12
    return f"{h12}:{m:02d}{suffix}" if m else f"{h12}{suffix}"


def _fmt_days(days: List[int]) -> str:
    d = sorted(set(int(x) for x in days))
    if len(d) == 7:
        return ""
    runs, i = [], 0
    while i < len(d):
        j = i
        while j + 1 < len(d) and d[j + 1] == d[j] + 1:
            j += 1
        runs.append(f"{_DAY_EN[d[i]]}–{_DAY_EN[d[j]]}" if j - i >= 2 else ", ".join(_DAY_EN[x] for x in d[i : j + 1]))
        i = j + 1
    return ", ".join(runs)


def format_windows(windows: Optional[Iterable[Dict[str, Any]]]) -> str:
    """[{days:[1..5], start:'07:00', end:'11:00'}] → 'Mon–Fri 7am–11am'"""
    parts = []
    for w in windows or []:
        try:
            label = " ".join(x for x in [_fmt_days(w.get("days") or []), f"{_fmt_time(w['start'])}–{_fmt_time(w['end'])}"] if x)
            parts.append(label)
        except Exception:
            continue
    return " · ".join(parts)


def next_opening(windows: Optional[Iterable[Dict[str, Any]]], tz: Optional[str], now: Optional[datetime] = None) -> Optional[str]:
    """'7am', 'tomorrow 7am' or 'Mon 7am'; None when there are no windows."""
    wins = [w for w in (windows or []) if isinstance(w, dict) and w.get("start")]
    if not wins:
        return None
    t = local_now(tz, now)
    cur = t.hour * 60 + t.minute
    for offset in range(8):
        day = (_weekday_sun0(t) + offset) % 7
        starts = sorted(
            (w["start"] for w in wins if day in [int(x) for x in (w.get("days") or [])] and (offset > 0 or _to_min(w["start"]) > cur)),
            key=_to_min,
        )
        if starts:
            s = _fmt_time(starts[0])
            return s if offset == 0 else f"tomorrow {s}" if offset == 1 else f"{_DAY_EN[day]} {s}"
    return None


# ------------------------------------------------------------------ rules

def resolve_location_id(db, tenant_oid, branch_hint: Optional[str]):
    """Branch slug/name → location _id (same matching as the Node public menu)."""
    if not branch_hint or tenant_oid is None:
        return None
    b = str(branch_hint).strip()
    norm = re.sub(r"^-|-$", "", re.sub(r"--+", "-", re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", b.lower()))))
    try:
        doc = db["locations"].find_one(
            {
                "tenantId": tenant_oid,
                "$or": [
                    {"name": {"$regex": f"^{re.escape(b)}$", "$options": "i"}},
                    {"name": {"$regex": "^" + norm.replace("-", "[\\s-]") + "$", "$options": "i"}},
                ],
            },
            {"_id": 1},
        )
        return doc["_id"] if doc else None
    except Exception:
        return None


def load_rules(db, tenant_oid, location_id=None, channel: Optional[str] = None) -> Dict[str, Any]:
    """Everything needed to decide availability for one tenant/branch, in 3–4 small queries."""
    rules: Dict[str, Any] = {
        "tz": DEFAULT_TZ,
        "opening": [],
        "categories": {},
        "sold_out": set(),
        "periods": DEFAULT_PERIODS,
    }
    if tenant_oid is None:
        return rules
    try:
        t = db["tenants"].find_one({"_id": tenant_oid}, {"timezone": 1, "openingHours": 1, "servicePeriods": 1}) or {}
        rules["tz"] = t.get("timezone") or DEFAULT_TZ
        rules["opening"] = t.get("openingHours") or []
        if isinstance(t.get("servicePeriods"), list):
            rules["periods"] = t["servicePeriods"]
        if location_id is not None:
            loc = db["locations"].find_one({"_id": location_id, "tenantId": tenant_oid}, {"openingHours": 1}) or {}
            if isinstance(loc.get("openingHours"), list):
                rules["opening"] = loc["openingHours"]

        for c in db["categories"].find(
            {"tenantId": tenant_oid}, {"name": 1, "availability": 1, "branchAvailability": 1, "servicePeriodIds": 1}
        ):
            hours = resolve_windows(c.get("servicePeriodIds"), c.get("availability"), rules["periods"])
            if location_id is not None:
                for b in c.get("branchAvailability") or []:
                    if str(b.get("locationId")) == str(location_id):
                        hours = b.get("availability") or []
                        break
            rules["categories"][str(c["_id"])] = {"name": c.get("name"), "hours": hours}

        if location_id is not None:
            q: Dict[str, Any] = {
                "tenantId": tenant_oid,
                "locationId": location_id,
                "$or": [{"available": False}, {"removed": True}],
            }
            if channel in ("dine-in", "online"):
                q["channel"] = channel
            rules["sold_out"] = {str(o["itemId"]) for o in db["itemAvailability"].find(q, {"itemId": 1})}
    except Exception as e:  # never break the waiter over availability
        print("[ai-waiter-service] ⚠️ availability rules failed:", e)
    return rules


def unavailable_reason(item: Dict[str, Any], rules: Dict[str, Any], now: Optional[datetime] = None, lang: str = "en") -> Optional[str]:
    """None when the item can be ordered now; otherwise a short customer-facing reason."""
    tz = rules.get("tz") or DEFAULT_TZ
    name = item.get("name") or "That item"
    bn = (lang or "").lower() == "bn"

    if item.get("offline") or str(item.get("id")) in rules.get("sold_out", set()):
        return f"{name} আজ শেষ হয়ে গেছে।" if bn else f"Sorry, {name} is sold out right now."

    opening = rules.get("opening") or []
    if not is_within(opening, tz, now):
        when = next_opening(opening, tz, now)
        if bn:
            return "এখন রেস্টুরেন্ট বন্ধ" + (f" — খুলবে {when}।" if when else "।")
        return "We're closed right now" + (f" — we open at {when}." if when else ".")

    cat = rules.get("categories", {}).get(str(item.get("categoryId") or ""))
    if cat and not is_within(cat.get("hours"), tz, now):
        hours = format_windows(cat.get("hours"))
        cname = cat.get("name") or "This section"
        return f"{cname} পাওয়া যায় {hours}।" if bn else f"{cname} is served {hours}."

    own = resolve_windows(item.get("servicePeriodIds"), item.get("availability"), rules.get("periods") or DEFAULT_PERIODS)
    if not is_within(own, tz, now):
        hours = format_windows(own)
        return f"{name} পাওয়া যায় {hours}।" if bn else f"{name} is available {hours}."

    frm, until = item.get("availableFrom"), item.get("availableUntil")
    if not _within_dates(frm, until, tz, now):
        today = local_now(tz, now).strftime("%Y-%m-%d")
        if frm and today < frm:
            return f"{name} পাওয়া যাবে {frm} থেকে।" if bn else f"{name} is available from {frm}."
        return f"{name} এখন আর পাওয়া যায় না।" if bn else f"{name} is no longer available."
    return None
