"""
Wait-time estimation for the virtual waiter — mirrors services/auth-service/src/services/orders/waitTime.ts
(keep the two in step; tests/test_wait_time.py checks the same vectors as waitTime.test.ts).

    dish time   = the variation's prepMinutes → the item's → the restaurant default
    line time   = dish time + ~20% per extra portion (max double)
    order prep  = the slowest line + 1 min per extra dish (max 5)
    queue       = orders ahead scheduled onto `parallelOrders` kitchen stations; start on the first free one

Plus the guest-facing words: "about 20 minutes", "কুড়ি মিনিটের মতো", and a detector for time questions.
Pure (no I/O).
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_PREP_MINUTES = 15
DEFAULT_PARALLEL_ORDERS = 3
MAX_PREP = 240
# an order this long past its due time was served but never marked done — not kitchen load (mirrors waitTime.ts)
FORGOTTEN_AFTER_MIN = 30


def clamp_prep(v: Any) -> Optional[int]:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or n <= 0:
        return None
    return int(min(MAX_PREP, max(1, math.floor(n + 0.5))))


def kitchen_settings(tenant: Optional[Dict[str, Any]]) -> Dict[str, int]:
    k = (tenant or {}).get("kitchen") or {}
    par = k.get("parallelOrders")
    return {
        "defaultPrepMinutes": clamp_prep(k.get("defaultPrepMinutes")) or DEFAULT_PREP_MINUTES,
        "parallelOrders": min(int(par), 50) if isinstance(par, int) and par >= 1 else DEFAULT_PARALLEL_ORDERS,
    }


def dish_minutes(item: Dict[str, Any], variation: Optional[str] = None,
                 fallback: int = DEFAULT_PREP_MINUTES) -> Tuple[int, bool]:
    """(minutes for one portion, estimated?) — estimated means nobody set a time for this dish."""
    want = str(variation or "").strip().lower()
    if want:
        for v in item.get("variations") or []:
            if str(v.get("name") or "").strip().lower() == want:
                vm = clamp_prep(v.get("prepMinutes"))
                if vm is not None:
                    return vm, False
                break
    im = clamp_prep(item.get("prepMinutes"))
    if im is not None:
        return im, False
    return fallback, True


def dish_range(item: Dict[str, Any], fallback: int = DEFAULT_PREP_MINUTES) -> Tuple[int, int]:
    base = clamp_prep(item.get("prepMinutes"))
    times = [clamp_prep(v.get("prepMinutes")) or base or fallback for v in item.get("variations") or []]
    if not times:
        times = [base or fallback]
    return min(times), max(times)


def has_own_time(item: Dict[str, Any]) -> bool:
    return clamp_prep(item.get("prepMinutes")) is not None or any(
        clamp_prep(v.get("prepMinutes")) is not None for v in item.get("variations") or []
    )


def line_minutes(prep: int, qty: int) -> int:
    q = max(1, int(qty or 1))
    return min(prep * 2, prep + math.ceil(prep * 0.2) * (q - 1))


def order_prep_minutes(lines: Iterable[Tuple[int, int]]) -> int:
    """lines: (prep minutes, qty)."""
    rows = list(lines)
    if not rows:
        return 0
    return max(line_minutes(p, q) for p, q in rows) + min(5, len(rows) - 1)


def _ts(v: Any) -> Optional[float]:
    if isinstance(v, datetime):
        return v.timestamp() if v.tzinfo else (v - datetime(1970, 1, 1)).total_seconds()
    return None


def is_forgotten(o: Dict[str, Any], now: datetime) -> bool:
    """Served but never marked done: 30+ min past its due time (mirrors isForgotten in waitTime.ts)."""
    due = _ts(o.get("readyAt"))
    if due is None and _ts(o.get("createdAt")) is not None:
        due = _ts(o.get("createdAt")) + float(o.get("prepMinutes") or 0) * 60
    return due is not None and ((_ts(now) or 0.0) - due) / 60.0 > FORGOTTEN_AFTER_MIN


def queue_minutes(ahead: List[Dict[str, Any]], parallel: int, now: datetime) -> int:
    """ahead: [{status, prepMinutes, readyAt}] oldest first. Naive datetimes are UTC (pymongo)."""
    stations = [0.0] * max(1, int(parallel or 1))
    now_ts = _ts(now) or 0.0
    for o in ahead:
        st = o.get("status")
        if is_forgotten(o, now):
            continue
        if st == "preparing":
            ready = _ts(o.get("readyAt"))
            work = max(0.0, (ready - now_ts) / 60.0) if ready is not None else float(o.get("prepMinutes") or 0)
        elif st in ("placed", "accepted"):
            work = max(0.0, float(o.get("prepMinutes") or 0))
        else:
            continue
        i = min(range(len(stations)), key=lambda s: stations[s])
        stations[i] += work
    return int(math.ceil(min(stations) - 1e-9))


def estimate(lines: List[Tuple[Dict[str, Any], Optional[str], int]], ahead: List[Dict[str, Any]],
             settings: Dict[str, int], now: datetime) -> Dict[str, Any]:
    """lines: (menu item, variation, qty)."""
    estimated = False
    timed = []
    for item, variation, qty in lines:
        m, est = dish_minutes(item, variation, settings["defaultPrepMinutes"])
        estimated = estimated or est
        timed.append((m, qty))
    prep = order_prep_minutes(timed)
    queue = queue_minutes(ahead, settings["parallelOrders"], now)
    return {"prepMinutes": prep, "queueMinutes": queue, "totalMinutes": prep + queue, "estimated": estimated}


def busy_level(queue: int) -> str:
    if queue <= 2:
        return "quiet"
    return "normal" if queue <= 15 else "busy"


def minutes_left(ready_at: Any, now: datetime) -> int:
    r, n = _ts(ready_at), _ts(now)
    if r is None or n is None:
        return 0
    return max(0, int(math.ceil((r - n) / 60.0 - 1e-9)))


# ------------------------------------------------------------------ how a waiter says it

_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def round_for_guest(minutes: int) -> int:
    """Waiters don't say "23 minutes": under 10 exact, then to the nearest 5."""
    if minutes <= 10:
        return max(1, minutes)
    return int(5 * math.ceil(minutes / 5.0))


def say_minutes(minutes: int, lang: str) -> str:
    """"about 20 minutes" / "২০ মিনিটের মতো" (Western digits are converted later for Bangla voice)."""
    m = round_for_guest(minutes)
    if lang == "bn":
        return f"{m} মিনিটের মতো"
    return "about a minute" if m == 1 else f"about {m} minutes"


def say_range(lo: int, hi: int, lang: str) -> str:
    a, b = round_for_guest(lo), round_for_guest(hi)
    if a == b:
        return say_minutes(lo, lang)
    return f"{a}–{b} মিনিট" if lang == "bn" else f"{a}–{b} minutes"


# ------------------------------------------------------------------ is the guest asking about time?

# "how long", "how much time", "when will it come", "is it quick", "কতক্ষণ", "কত সময়", "কখন আসবে", "koto khon"
TIME_Q = re.compile(
    r"\bhow long\b|\bhow much time\b|\bhow many min(ute)?s?\b|\bwait(ing)? time\b|\bwhen (will|would|is|does|do)\b.*\b(come|ready|arrive|be served|be done|be here|get here|serve)\b|"
    r"\b(eta)\b|\bready (in|by)\b|\btake (long|a while|much time)\b|\bis it (quick|fast)\b|\b(still|much) (longer|more)\b|"
    r"\bwhere('?s| is) (my|our) (food|order)\b|\bhow (far|close) (along )?is (my|our) (food|order)\b|"
    r"কতক্ষণ|কতক্ষন|কত সময়|কত সময়|কত মিনিট|কখন (আসবে|দেবে|দিবে|দেবেন|দিবেন|হবে|পাব|পাবো|রেডি)|আর কত(ক্ষণ)?|দেরি হবে|দেরী হবে|দেরি হচ্ছে|দেরী হচ্ছে|তাড়াতাড়ি হবে|সময় লাগবে|"
    r"\bkoto ?khon\b|\bkoto (shomoy|somoy|minute)\b|\bkokhon (ashbe|asbe|dibe|pabo)\b|\bar koto\b",
    re.I,
)
# "what's quickest?", "something fast", "in a hurry", "সবচেয়ে তাড়াতাড়ি", "কম সময়ে"
QUICKEST_Q = re.compile(
    r"\b(quickest|fastest|fast(est)? to (make|serve|prepare)|quick(ly)? (to )?(make|serve|prepare|bite)|ready (quickly|fast|soon)|"
    r"(something|anything|what'?s) (quick|fast)|in a (hurry|rush)|short on time|no time|takes? (the )?least time)\b|"
    r"সবচেয়ে (তাড়াতাড়ি|তারাতারি|কম সময়|কম সময়|দ্রুত)|কম সময়ে|কম সময়ে|তাড়াতাড়ি (হয়|হবে|পাওয়া|দেওয়া)|তাড়া আছে|তাড়াহুড়|দ্রুত (কী|কি|কোনটা)|"
    r"\b(tara ?tari|taratari|druto)\b",
    re.I,
)
# about an order already sent: "where's my food", "how much longer", "is my order ready"
PLACED_Q = re.compile(
    r"\bmy (food|order)\b|\bour (food|order)\b|\b(much|any) longer\b|\bstill (waiting|not here)\b|\bready yet\b|\bis it ready\b|"
    r"আমার (খাবার|অর্ডার)|আমাদের (খাবার|অর্ডার)|খাবার কখন|অর্ডার কখন|আর কত(ক্ষণ)?|এখনো আসেনি|এখনও আসেনি|রেডি হয়েছে|রেডি হলো|"
    r"\b(amar|amader) (khabar|order)\b",
    re.I,
)
# the guest is asking about the tray / the whole order they're about to place
ORDER_WORDS = re.compile(
    r"\b(my|our|the|this|whole|full|entire) (order|tray|cart|food|meal)\b|\beverything\b|\ball (of )?(this|it|that)\b|\bif i order\b|"
    r"অর্ডার|ট্রে|সব মিলিয়ে|সবগুলো|সবকিছু|এগুলো|খাবার",
    re.I,
)


def asks_time(text: str) -> bool:
    return bool(TIME_Q.search(text or ""))


def asks_quickest(text: str) -> bool:
    return bool(QUICKEST_Q.search(text or ""))
