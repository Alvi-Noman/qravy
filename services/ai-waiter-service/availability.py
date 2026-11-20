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
import time
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
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


def _said(hhmm: str) -> Tuple[int, int]:
    """A time as people say it: within 5 minutes of the hour is that hour — periods are stored 12:02 / 17:01 so they
    don't overlap, but "দুপুর ১২টা ২ মিনিট" / "বিকাল ৫:০১" is no time a waiter says."""
    h, m = [int(x) for x in hhmm.split(":")[:2]]
    if m <= 5:
        return h, 0
    if m >= 55:
        return (h + 1) % 24, 0
    return h, m


def _fmt_time(hhmm: str) -> str:
    h, m = _said(hhmm)
    suffix = "am" if h < 12 else "pm"
    h12 = 12 if h % 12 == 0 else h % 12
    return f"{h12}:{m:02d}{suffix}" if m else f"{h12}{suffix}"


_DAY_BN = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"]
_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def _fmt_time_bn(hhmm: str) -> str:
    """'17:00' → 'বিকাল ৫টা', '06:30' → 'সকাল ৬:৩০' — the time as a Bangla guest says it."""
    h, m = _said(hhmm)
    part = ("রাত" if h < 4 or h >= 20 else "ভোর" if h < 6 else "সকাল" if h < 12 else "দুপুর" if h < 15
            else "বিকাল" if h < 18 else "সন্ধ্যা")
    h12 = 12 if h % 12 == 0 else h % 12
    return (f"{part} {h12}:{m:02d}" if m else f"{part} {h12}টা").translate(_BN_DIGITS)


def _fmt_days(days: List[int], bn: bool = False) -> str:
    d = sorted(set(int(x) for x in days))
    if len(d) == 7:
        return ""
    names = _DAY_BN if bn else _DAY_EN
    runs, i = [], 0
    while i < len(d):
        j = i
        while j + 1 < len(d) and d[j + 1] == d[j] + 1:
            j += 1
        runs.append(f"{names[d[i]]}–{names[d[j]]}" if j - i >= 2 else ", ".join(names[x] for x in d[i : j + 1]))
        i = j + 1
    return ", ".join(runs)


def format_windows(windows: Optional[Iterable[Dict[str, Any]]], lang: str = "en") -> str:
    """[{days:[1..5], start:'07:00', end:'11:00'}] → 'Mon–Fri 7am–11am' (bn: 'সোম–বৃহস্পতি সকাল ৭টা–সকাল ১১টা')"""
    bn = (lang or "").lower() == "bn"
    t = _fmt_time_bn if bn else _fmt_time
    # overlapping windows on the same days are one span ("evening 5–10" + "dinner 6–11" → 5–11), said once
    merged: List[Dict[str, Any]] = []
    try:
        for w in sorted((dict(x) for x in windows or []), key=lambda x: (tuple(sorted(x.get("days") or [])), _to_min(x["start"]))):
            last = merged[-1] if merged else None
            wraps = last and (_to_min(last["end"]) <= _to_min(last["start"]) or _to_min(w["end"]) <= _to_min(w["start"]))
            if (last and not wraps and sorted(last.get("days") or []) == sorted(w.get("days") or [])
                    and _to_min(last["start"]) <= _to_min(w["end"]) and _to_min(w["start"]) <= _to_min(last["end"])):
                if _to_min(w["end"]) > _to_min(last["end"]):
                    last["end"] = w["end"]
                continue
            merged.append(w)
        windows = merged
    except Exception:  # noqa: BLE001 — a malformed window: say them as they are
        pass
    parts = []
    for w in windows or []:
        try:
            a, b = t(w["start"]), t(w["end"])
            if bn and a.split()[0] == b.split()[0]:
                b = b.split(" ", 1)[1]  # "সকাল ৭টা–১১টা", not "সকাল ৭টা–সকাল ১১টা"
            label = " ".join(x for x in [_fmt_days(w.get("days") or [], bn), f"{a}–{b}"] if x)
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


def _as_datetime(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=dt_timezone.utc)
    if isinstance(v, str) and v.strip():
        try:
            d = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=dt_timezone.utc)
        except ValueError:
            return None
    return None


def switched_off(item: Dict[str, Any], rules: Optional[Dict[str, Any]] = None) -> bool:
    """Switched off by the restaurant (sold out, or off at this branch) — not a matter of the hour: no time of day
    brings it back. `switchedOff` is set on the menu snapshot (our reading or the public menu's)."""
    return bool(item.get("switchedOff") or item.get("offline")
                or str(item.get("id")) in ((rules or {}).get("sold_out") or set()))


def back_at(item: Dict[str, Any], rules: Optional[Dict[str, Any]] = None, now: Optional[datetime] = None) -> Optional[datetime]:
    """When a sold-out dish comes back (the owner's "Sold out → until …"); None when no time was set or it passed."""
    base = now or datetime.now(dt_timezone.utc)
    base = base if base.tzinfo else base.replace(tzinfo=dt_timezone.utc)
    for v in (((rules or {}).get("sold_out_until") or {}).get(str(item.get("id"))), item.get("offlineResumeAt"),
              item.get("soldOutUntil")):
        d = _as_datetime(v)
        if d and d > base:
            return d
    return None


def format_when(at: datetime, tz: Optional[str], now: Optional[datetime] = None, lang: str = "en") -> str:
    """A moment as a waiter says it, from now: "বিকাল ৫টা" / "কাল সকাল ৬টা" / "শুক্রবার দুপুর ১২টা";
    "at 5pm" / "tomorrow at 6am" / "on Fri at 12pm"."""
    bn = (lang or "").lower() == "bn"
    t, cur = local_now(tz, at), local_now(tz, now)
    hhmm = f"{t.hour:02d}:{t.minute:02d}"
    clock = _fmt_time_bn(hhmm) if bn else _fmt_time(hhmm)
    days = (t.date() - cur.date()).days
    if days <= 0:
        return clock if bn else f"at {clock}"
    if days == 1:
        return f"কাল {clock}" if bn else f"tomorrow at {clock}"
    return f"{_DAY_BN[_weekday_sun0(t)]}বার {clock}" if bn else f"on {_DAY_EN[_weekday_sun0(t)]} at {clock}"


def next_orderable_at(items: List[Dict[str, Any]], rules: Dict[str, Any], now: Optional[datetime] = None,
                      days: int = 7) -> Optional[datetime]:
    """When nothing can be ordered now: the first moment (within `days`) something on this menu can be — from the
    opening hours, the sections' and the dishes' own hours. None when no hour brings anything back (every dish is
    switched off): then nobody knows when, and the waiter must not make a time up."""
    tz = rules.get("tz") or DEFAULT_TZ
    t0 = local_now(tz, now)
    live = [it for it in items if not switched_off(it, rules) and not it.get("hidden")
            and it.get("status") in (None, "active")]
    if not live:
        return None
    periods = rules.get("periods") or DEFAULT_PERIODS
    windows: List[Dict[str, Any]] = list(rules.get("opening") or [])
    for c in (rules.get("categories") or {}).values():
        windows += list(c.get("hours") or [])
    for it in live:
        windows += resolve_windows(it.get("servicePeriodIds"), it.get("availability"), periods)
    starts = set()
    for w in windows:
        try:
            m = _to_min(str(w["start"]))
            on_days = [int(x) for x in (w.get("days") or [])]
        except (KeyError, TypeError, ValueError):
            continue
        for off in range(days + 1):
            d = t0 + timedelta(days=off)
            if _weekday_sun0(d) in on_days:
                at = d.replace(hour=m // 60, minute=m % 60, second=0, microsecond=0)
                if at > t0:
                    starts.add(at)
    for at in sorted(starts):
        if any(unavailable_reason(it, rules, now=at) is None for it in live):
            return at
    return None


# ------------------------------------------------------------------ rules

_LOCATION_ID_CACHE: Dict[Tuple[str, str], Tuple[float, Any]] = {}
LOCATION_ID_TTL_S = 10 * 60


def resolve_location_id(db, tenant_oid, branch_hint: Optional[str]):
    """Branch slug/name → location _id (same matching as the Node public menu). Cached — it's asked several times a turn."""
    if tenant_oid is None:
        return None
    key = (str(tenant_oid), str(branch_hint or ""))
    hit = _LOCATION_ID_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < LOCATION_ID_TTL_S:
        return hit[1]
    # no branch in the link → the branch its orders go to (the only one, or the main link's) — as the Node services do
    loc_id = _lookup_location_id(db, tenant_oid, branch_hint) if branch_hint else _default_location_id(db, tenant_oid)
    if loc_id is not None:
        _LOCATION_ID_CACHE[key] = (time.monotonic(), loc_id)
    return loc_id


def _default_location_id(db, tenant_oid):
    """Same as Node's branchForUnnamed: one open branch → it; two or more → the owner's main-link branch, if open."""
    try:
        open_ids = [d["_id"] for d in db["locations"].find({"tenantId": tenant_oid, "disabled": {"$ne": True}}, {"_id": 1}).limit(2)]
        if len(open_ids) == 1:
            return open_ids[0]
        if len(open_ids) >= 2:
            main = (db["tenants"].find_one({"_id": tenant_oid}, {"mainBranchId": 1}) or {}).get("mainBranchId")
            if main and db["locations"].find_one({"_id": main, "tenantId": tenant_oid, "disabled": {"$ne": True}}, {"_id": 1}):
                return main
        return None
    except Exception:
        return None


def _lookup_location_id(db, tenant_oid, branch_hint: str):
    """Same matching as the Node services (resolveBranchLocationId): the id, the branch's link name (slug — what the
    guest's link carries, "gulshan-2-main"), its code, its name in any case, or the name written as a link."""
    from bson import ObjectId

    b = str(branch_hint).strip()
    if ObjectId.is_valid(b):
        try:
            doc = db["locations"].find_one({"_id": ObjectId(b), "tenantId": tenant_oid, "disabled": {"$ne": True}}, {"_id": 1})
            return doc["_id"] if doc else None
        except Exception:
            return None
    linkish = re.sub(r"^-|-$", "", re.sub(r"--+", "-", re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", b.lower()))))
    ors: List[Dict[str, Any]] = [
        {"slug": b.lower()},
        {"code": b},
        {"name": {"$regex": f"^{re.escape(b)}$", "$options": "i"}},
    ]
    if linkish:
        ors.append({"name": {"$regex": "^" + "[\\s-]+".join(re.escape(p) for p in linkish.split("-")) + "$", "$options": "i"}})
    try:
        docs = list(db["locations"].find({"tenantId": tenant_oid, "disabled": {"$ne": True}, "$or": ors}, {"_id": 1, "slug": 1}))
        best = next((d for d in docs if d.get("slug") == b.lower()), docs[0] if docs else None)  # a slug match wins
        return best["_id"] if best else None
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
        t = db["tenants"].find_one(
            {"_id": tenant_oid}, {"timezone": 1, "openingHours": 1, "servicePeriods": 1, "categoryHoursMode": 1}
        ) or {}
        # the restaurant switches its categories on and off by hand: no category follows its serving hours
        manual_cats = t.get("categoryHoursMode") == "manual"
        rules["tz"] = t.get("timezone") or DEFAULT_TZ
        rules["opening"] = t.get("openingHours") or []
        if isinstance(t.get("servicePeriods"), list):
            rules["periods"] = t["servicePeriods"]
        if location_id is not None:
            loc = db["locations"].find_one({"_id": location_id, "tenantId": tenant_oid}, {"openingHours": 1}) or {}
            if isinstance(loc.get("openingHours"), list):
                rules["opening"] = loc["openingHours"]

        for c in db["categories"].find(
            {"tenantId": tenant_oid},
            {"name": 1, "availability": 1, "branchAvailability": 1, "servicePeriodIds": 1, "scope": 1, "locationId": 1},
        ):
            hours = resolve_windows(c.get("servicePeriodIds"), c.get("availability"), rules["periods"])
            if location_id is not None:
                for b in c.get("branchAvailability") or []:
                    if str(b.get("locationId")) == str(location_id):
                        hours = b.get("availability") or []
                        break
            # (by hand: the owner's switch decides what can be ordered — but its serving hours still say WHEN it is
            # usually served, so "কাবাব কি আছে?" at 4pm is "from 5pm", never "we have no kebabs")
            usual = hours
            if manual_cats:
                hours = []
            rules["categories"][str(c["_id"])] = {
                "name": c.get("name"),
                "hours": hours,
                "usualHours": usual,
                # a branch's own category ("scope: location") is only on that branch's menu
                "branchOnly": str(c.get("locationId") or "") if c.get("scope") == "location" else None,
            }

        if location_id is not None:
            rules["location_id"] = str(location_id)
            ch_q: Dict[str, Any] = {"channel": channel} if channel in ("dine-in", "online") else {}
            q: Dict[str, Any] = {"tenantId": tenant_oid, "locationId": location_id, **ch_q}
            sold_out: set = set()
            sold_out_until: Dict[str, datetime] = {}
            removed: Dict[str, set] = {}
            turned_on: Dict[str, set] = {}
            for o in db["itemAvailability"].find(q, {"itemId": 1, "channel": 1, "available": 1, "removed": 1, "resumeAt": 1}):
                if o.get("removed") is True:
                    removed.setdefault(str(o["itemId"]), set()).add(o.get("channel"))
                elif o.get("available") is False:
                    sold_out.add(str(o["itemId"]))
                    # "Sold out → until 6pm": when it comes back (none = switched off with no time — not "sold out today")
                    if isinstance(o.get("resumeAt"), datetime):
                        sold_out_until[str(o["itemId"])] = o["resumeAt"]
                elif o.get("available") is True:
                    turned_on.setdefault(str(o["itemId"]), set()).add(o.get("channel"))
            rules["sold_out"] = sold_out
            rules["sold_out_until"] = sold_out_until
            rules["removed_items"] = removed
            # switched on at this branch for a channel the dish is otherwise not on ("online only" → also dine-in here)
            rules["turned_on"] = turned_on
            # categories taken off (or hidden on) this branch's menu
            off: Dict[str, set] = {}
            for v in db["categoryVisibility"].find(q, {"categoryId": 1, "channel": 1, "removed": 1, "visible": 1}):
                if v.get("removed") is True or v.get("visible") is False:
                    off.setdefault(str(v["categoryId"]), set()).add(v.get("channel"))
            rules["removed_categories"] = off
            rules["channel"] = channel if channel in ("dine-in", "online") else None
    except Exception as e:  # never break the waiter over availability
        print("[ai-waiter-service] ⚠️ availability rules failed:", e)
    return rules


def on_branch_menu(item: Dict[str, Any], rules: Dict[str, Any]) -> bool:
    """Is the item on this branch's menu at all? Mirrors the Node public menu (routes/publicRoutes.ts): another branch's
    own item or category isn't; neither is one the branch took off its menu (for this channel — or, with no channel,
    for both). No branch → the whole restaurant's menu."""
    loc = rules.get("location_id")
    if not loc:
        return True
    item_loc = item.get("locationId")
    if item_loc and str(item_loc) != loc:
        return False
    cid = str(item.get("categoryId") or "")
    cat = rules.get("categories", {}).get(cid) or {}
    if cat.get("branchOnly") is not None and cat.get("branchOnly") != loc:
        return False
    channels = {rules["channel"]} if rules.get("channel") else {"dine-in", "online"}
    if channels <= (rules.get("removed_categories", {}).get(cid) or set()):
        return False
    if channels <= (rules.get("removed_items", {}).get(str(item.get("id"))) or set()):
        return False
    return True


def on_channel_menu(item: Dict[str, Any], rules: Dict[str, Any], channel: Optional[str]) -> bool:
    """Is the dish served on this channel? An "online only" dish isn't on the dine-in menu (nor offered at the table)
    unless this branch switched it on there — as the menu page and checkout decide. No channel → on either."""
    vis = item.get("visibility") or {}
    if channel == "dine-in":
        ok = vis.get("dineIn", True) is not False
    elif channel == "online":
        ok = vis.get("online", True) is not False
    else:
        return True
    return ok or channel in (rules.get("turned_on", {}).get(str(item.get("id"))) or set())


def _spans(windows: Iterable[Dict[str, Any]]) -> List[Tuple[int, int]]:
    """Windows as minute ranges of a day (past midnight → two ranges); the days are left out."""
    out: List[Tuple[int, int]] = []
    for w in windows or []:
        try:
            a, b = _to_min(str(w["start"])), _to_min(str(w["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        out += [(a, b)] if a < b else [(a, 24 * 60), (0, b)] if a > b else [(0, 24 * 60)]
    return out


def _overlap(x: List[Tuple[int, int]], y: List[Tuple[int, int]], at_least: int = 30) -> bool:
    return any(min(b1, b2) - max(a1, a2) >= at_least for a1, b1 in x for a2, b2 in y)


def served_periods(item: Dict[str, Any], rules: Dict[str, Any]) -> Optional[List[str]]:
    """The service periods (Settings → Hours: Breakfast, Lunch, Afternoon…) this dish is served in — from its
    category's hours and its own; None when neither is set (all day: it belongs to no particular period)."""
    periods = rules.get("periods") or DEFAULT_PERIODS
    cat = (rules.get("categories") or {}).get(str(item.get("categoryId") or "")) or {}
    limits = [s for s in (_spans(cat.get("hours") or cat.get("usualHours") or []),
                          _spans(resolve_windows(item.get("servicePeriodIds"), item.get("availability"), periods)))
              if s]
    if not limits:
        return None
    out = []
    for p in periods:
        span = _spans([p])
        if span and all(_overlap(span, lim) for lim in limits):
            out.append(str(p.get("id")))
    return out


def periods_at(minute_of_day: int, rules: Dict[str, Any]) -> List[str]:
    """The service periods running at that time of day ("এখন", or "বিকেলে" read as 4:30 pm)."""
    return [str(p.get("id")) for p in rules.get("periods") or DEFAULT_PERIODS
            if any(a <= minute_of_day < b for a, b in _spans([p]))]


def _next_start(windows: Iterable[Dict[str, Any]], tz: Optional[str], now: Optional[datetime] = None) -> Optional[datetime]:
    """When the windows next begin (later today or on a coming day), as an aware datetime; None without windows."""
    t = local_now(tz, now)
    cur = t.hour * 60 + t.minute
    for offset in range(8):
        day = (_weekday_sun0(t) + offset) % 7
        starts = sorted(_to_min(w["start"]) for w in windows if isinstance(w, dict) and w.get("start")
                        and day in [int(x) for x in (w.get("days") or [])] and (offset > 0 or _to_min(w["start"]) > cur))
        if starts:
            base = (t + timedelta(days=offset)).replace(hour=0, minute=0, second=0, microsecond=0)
            return base + timedelta(minutes=starts[0])
    return None


def _ended_today(windows: Iterable[Dict[str, Any]], tz: Optional[str], now: Optional[datetime] = None) -> bool:
    """A window of today's has already closed (its time is over for today)."""
    t = local_now(tz, now)
    cur, day = t.hour * 60 + t.minute, _weekday_sun0(t)
    return any(isinstance(w, dict) and w.get("start") and w.get("end") and day in [int(x) for x in (w.get("days") or [])]
               and _to_min(w["start"]) < _to_min(w["end"]) <= cur for w in windows)


def _not_now(label: str, windows: List[Dict[str, Any]], tz: Optional[str], now: Optional[datetime], lang: str,
             served: str) -> str:
    """Outside its hours, said by WHEN: not started yet today ("from 5pm"), over for today, or the days it's served.
    "আজ শেষ হয়ে গেছে" is never an hour's reason — that is sold out (Nov 20: kebabs at noon)."""
    bn = (lang or "").lower() == "bn"
    hours = format_windows(windows, lang)
    nxt = _next_start(windows, tz, now)
    if nxt is not None and nxt.date() == local_now(tz, now).date():
        when = format_when(nxt, tz, now, lang)
        return f"{label} এখনো শুরু হয়নি — পাওয়া যাবে {when} থেকে।" if bn else f"{label} hasn't started yet — from {when[3:]}."
    if _ended_today(windows, tz, now):
        return f"{label} আজকের মতো শেষ — পাওয়া যায় {hours}।" if bn else f"{label} is over for today — {served} {hours}."
    return f"{label} পাওয়া যায় {hours}।" if bn else f"{label} is {served} {hours}."


def _hours_reason(item: Dict[str, Any], rules: Dict[str, Any], now: Optional[datetime], lang: str,
                  usual: bool = False) -> Optional[str]:
    """Why the item is outside its hours now (restaurant closed, its section's hours, its own), or None.
    `usual`: a section switched by hand still has its usual hours — they say when a switched-off dish is served."""
    tz = rules.get("tz") or DEFAULT_TZ
    bn = (lang or "").lower() == "bn"
    opening = rules.get("opening") or []
    if not is_within(opening, tz, now):
        when = next_opening(opening, tz, now)
        if bn:
            return "এখন রেস্টুরেন্ট বন্ধ" + (f" — খুলবে {when}।" if when else "।")
        return "We're closed right now" + (f" — we open at {when}." if when else ".")

    cat = rules.get("categories", {}).get(str(item.get("categoryId") or ""))
    cat_hours = (cat.get("hours") or (cat.get("usualHours") if usual else None)) if cat else None
    if cat_hours and not is_within(cat_hours, tz, now):
        return _not_now(cat.get("name") or "This section", cat_hours, tz, now, lang, "served")

    own = resolve_windows(item.get("servicePeriodIds"), item.get("availability"), rules.get("periods") or DEFAULT_PERIODS)
    if own and not is_within(own, tz, now):
        return _not_now(item.get("name") or "That item", own, tz, now, lang, "available")
    return None


def unavailable_reason(item: Dict[str, Any], rules: Dict[str, Any], now: Optional[datetime] = None, lang: str = "en") -> Optional[str]:
    """None when the item can be ordered now; otherwise a short customer-facing reason."""
    tz = rules.get("tz") or DEFAULT_TZ
    name = item.get("name") or "That item"
    bn = (lang or "").lower() == "bn"

    if switched_off(item, rules):
        # sold out WITH a time it comes back ("until 6pm") is "sold out — back at 6pm"
        back = back_at(item, rules, now)
        if back:
            when = format_when(back, tz, now, lang)
            return f"{name} শেষ হয়ে গেছে — আবার পাওয়া যাবে {when}।" if bn else f"Sorry, {name} is sold out right now — back {when}."
        # switched off with no time, outside its own hours: the hours are the reason — staff switch kebabs off until
        # the evening, and "কাবাব আজ শেষ হয়ে গেছে" at noon was wrong: "এখনো শুরু হয়নি — বিকাল ৫টা থেকে" (Nov 20)
        hours = _hours_reason(item, rules, now, lang, usual=True)
        if hours:
            return hours
        # within its hours: only "not available right now" — never "sold out today" (a branch that never serves kebabs)
        return f"{name} এখন পাওয়া যাচ্ছে না।" if bn else f"Sorry, {name} isn't available right now."

    hours = _hours_reason(item, rules, now, lang)
    if hours:
        return hours

    frm, until = item.get("availableFrom"), item.get("availableUntil")
    if not _within_dates(frm, until, tz, now):
        today = local_now(tz, now).strftime("%Y-%m-%d")
        if frm and today < frm:
            return f"{name} পাওয়া যাবে {frm} থেকে।" if bn else f"{name} is available from {frm}."
        return f"{name} এখন আর পাওয়া যায় না।" if bn else f"{name} is no longer available."
    return None
