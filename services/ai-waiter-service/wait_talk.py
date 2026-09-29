"""
What the virtual waiter SAYS about wait times — built from real numbers only (wait_time.py + the server's
kitchen view), never guessed by the model.

    kitchen = server.kitchen_now(...) → {"queueMinutes", "busy", "ordersInKitchen", "myOrders": [...], "settings"}

Every function is pure and returns the finished sentence in English or Bangla (dish names stay as on the menu;
server.py turns them into Bangla script for Bangla guests, like every other reply).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from wait_time import (
    dish_minutes,
    dish_range,
    has_own_time,
    kitchen_settings,
    line_minutes,
    order_prep_minutes,
    round_for_guest,
    say_minutes,
    say_range,
)

Kitchen = Optional[Dict[str, Any]]


def _settings(kitchen: Kitchen) -> Dict[str, int]:
    return (kitchen or {}).get("settings") or kitchen_settings(None)


def _queue(kitchen: Kitchen) -> int:
    return int((kitchen or {}).get("queueMinutes") or 0)


# ------------------------------------------------------------------ numbers


def cart_estimate(rows: List[Dict[str, Any]], by_id: Dict[str, Dict[str, Any]], kitchen: Kitchen) -> Optional[Dict[str, Any]]:
    """The tray if ordered now: the order's cooking time + the current kitchen queue, and its slowest dish."""
    st = _settings(kitchen)
    lines: List[Tuple[int, int]] = []
    slowest, slow_m = None, -1
    for r in rows:
        it = by_id.get(str(r.get("itemId")))
        qty = int(r.get("quantity") or 0)
        if not it or qty <= 0:
            continue
        m, _ = dish_minutes(it, r.get("variation"), st["defaultPrepMinutes"])
        lines.append((m, qty))
        if line_minutes(m, qty) > slow_m:
            slowest, slow_m = it, line_minutes(m, qty)
    if not lines:
        return None
    prep = order_prep_minutes(lines)
    return {"prepMinutes": prep, "queueMinutes": _queue(kitchen), "totalMinutes": prep + _queue(kitchen),
            "slowest": slowest, "lines": len(lines)}


def quickest(candidates: List[Dict[str, Any]], kitchen: Kitchen, limit: int = 3) -> List[Tuple[Dict[str, Any], int]]:
    """Fastest dishes by their own prep time. Dishes with no time set can't be ranked honestly, so they're left out."""
    st = _settings(kitchen)
    timed = [(it, dish_range(it, st["defaultPrepMinutes"])[0]) for it in candidates if has_own_time(it)]
    timed.sort(key=lambda x: (x[1], str(x[0].get("name") or "")))
    return timed[:limit]


# ------------------------------------------------------------------ sentences


def _dish_line(item: Dict[str, Any], lang: str, fallback: int) -> str:
    """"the Kacchi Biryani takes about 10 minutes to make" (a range when its sizes differ)."""
    lo, hi = dish_range(item, fallback)
    name = item.get("name")
    if lang == "bn":
        return f"{name} তৈরি হতে {say_range(lo, hi, lang)} লাগে"
    return f"The {name} takes {say_range(lo, hi, lang)} to make{', depending on the size' if lo != hi else ''}"


def placed_order_reply(kitchen: Kitchen, lang: str) -> Optional[str]:
    """"Where's my food?" — from the guest's own orders still in the kitchen (oldest first)."""
    mine = list((kitchen or {}).get("myOrders") or [])
    if not mine:
        return None
    bn = lang == "bn"
    waiting = [o for o in mine if o.get("status") != "ready"]
    if not waiting:
        return ("আপনার খাবার তৈরি হয়ে গেছে — এখনই আপনার টেবিলে চলে আসবে।" if bn
                else "Your food is ready — it'll be at your table any moment now.")
    o = waiting[-1]
    left, status = int(o.get("minutesLeft") or 0), o.get("status")
    extra = ""
    if len(waiting) < len(mine):
        extra = " আপনার আগের অর্ডারটা তৈরি হয়ে গেছে।" if bn else " Your earlier order is ready already."
    if not o.get("hasEta"):
        if status == "preparing":
            text = "আপনার খাবার তৈরি হচ্ছে — একটু অপেক্ষা করুন।" if bn else "Your food is being prepared right now."
        else:
            text = ("আপনার অর্ডার কিচেনে আছে, শিগগিরই তৈরি শুরু হবে।" if bn
                    else "The kitchen has your order and will start on it shortly.")
        return text + extra
    if status == "placed":
        # not accepted yet — no time is given until they accept (the estimate appears on the screen then)
        text = ("রেস্টুরেন্ট এখনো আপনার অর্ডারটি গ্রহণ করেনি — অনুগ্রহ করে একটু অপেক্ষা করুন, গ্রহণ করলেই স্ক্রিনে আনুমানিক সময় দেখতে পাবেন।"
                if bn else "The restaurant hasn't accepted your order yet — please wait a moment; "
                "you'll see the estimated time on your screen as soon as they do.")
        return text + extra
    if o.get("late") or left <= 0:
        return ("একটু বেশি সময় লাগছে, দুঃখিত — আর কয়েক মিনিটের মধ্যেই চলে আসবে।" if bn
                else "It's taking a little longer than expected, sorry — it should be with you in a few minutes.") + extra
    if status == "preparing":
        text = (f"আপনার খাবার তৈরি হচ্ছে — আর {say_minutes(left, lang)} লাগবে।" if bn
                else f"Your food is being prepared — {say_minutes(left, lang)} to go.")
    else:
        text = (f"কিচেন আপনার অর্ডার পেয়েছে — প্রায় {round_for_guest(left)} মিনিটের মধ্যে তৈরি হয়ে যাবে।" if bn
                else f"The kitchen has your order — it should be ready in {say_minutes(left, lang)}.")
    return text + extra


def dishes_reply(items: List[Tuple[Dict[str, Any], int, Optional[str]]], kitchen: Kitchen, lang: str, offer: bool) -> str:
    """"How long does the Kacchi take?" — each dish's own time, then how long it'd be if ordered now."""
    st = _settings(kitchen)
    bn = lang == "bn"
    items = items[:2]
    head = ("। ".join(_dish_line(it, lang, st["defaultPrepMinutes"]) for it, _q, _v in items) + "।" if bn
            else ". ".join(_dish_line(it, lang, st["defaultPrepMinutes"]) for it, _q, _v in items) + ".")
    prep = order_prep_minutes([(dish_minutes(it, v, st["defaultPrepMinutes"])[0], q) for it, q, v in items])
    q = _queue(kitchen)
    if q > 2:
        tail = (f" এখন কিচেনে কয়েকটা অর্ডার আগে আছে, তাই অর্ডার দিলে {say_minutes(prep + q, lang)} লাগবে।" if bn
                else f" There are a few orders ahead right now, so if you order now it'd be ready in {say_minutes(prep + q, lang)}.")
    else:
        tail = " কিচেন এখন ফাঁকা, তাই অর্ডার দিলেই তৈরি শুরু হবে।" if bn else " The kitchen is free right now, so it would go straight on."
    ask = ""
    if offer:
        ask = " অর্ডার করতে চান?" if bn else " Would you like to order?"
    return head + tail + ask


def cart_reply(est: Dict[str, Any], kitchen: Kitchen, lang: str) -> str:
    """"How long will my order take?" before it's placed."""
    total, slowest = est["totalMinutes"], est.get("slowest") or {}
    several = est["lines"] > 1 and slowest.get("name")
    if lang == "bn":
        text = f"এখন অর্ডার দিলে আপনার খাবার প্রায় {round_for_guest(total)} মিনিটের মধ্যে তৈরি হয়ে যাবে"
        text += f" — {slowest['name']} তৈরি হতেই সবচেয়ে বেশি সময় লাগে।" if several else "।"
        if _queue(kitchen) > 2:
            text += " এর মধ্যে আগের অর্ডারগুলোর জন্য একটু অপেক্ষাও ধরা আছে।"
        return text + " আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
    text = f"If you order now, your food should be ready in {say_minutes(total, lang)}"
    text += f" — the {slowest['name']} takes the longest." if several else "."
    if _queue(kitchen) > 2:
        text += " That includes a short wait for the orders ahead of you."
    return text + " Anything else, or shall I confirm your order?"


def general_reply(foods: List[Dict[str, Any]], kitchen: Kitchen, lang: str) -> str:
    """"How long does food take here?" — the typical range on this menu + how busy the kitchen is now."""
    st = _settings(kitchen)
    times = sorted(dish_minutes(it, None, st["defaultPrepMinutes"])[0] for it in foods) or [st["defaultPrepMinutes"]]
    lo, hi = times[len(times) // 4], times[(3 * len(times)) // 4]
    q = _queue(kitchen)
    if lang == "bn":
        text = f"বেশিরভাগ খাবার তৈরি হতে {say_range(lo, hi, lang)} লাগে।"
        text += (f" এখন কিচেনে একটু চাপ আছে, তাই আরও {say_minutes(q, lang)} বেশি লাগতে পারে।" if q > 2
                 else " কিচেন এখন ফাঁকা, তাই খাবার তাড়াতাড়িই আসবে।")
        return text + " কী দেব বলুন?"
    text = f"Most dishes take {say_range(lo, hi, lang)} to make."
    text += (f" The kitchen is busy right now, so allow {say_minutes(q, lang)} extra." if q > 2
             else " The kitchen is quiet right now, so food comes out quickly.")
    return text + " What can I get you?"


def quickest_reply(picks: List[Tuple[Dict[str, Any], int]], kitchen: Kitchen, lang: str) -> str:
    """"What's quickest?" — the fastest dishes that suit this guest, with their times."""
    q = _queue(kitchen)
    if lang == "bn":
        listed = ", ".join(f"{it.get('name')} ({say_minutes(m, lang)})" for it, m in picks)
        text = f"সবচেয়ে তাড়াতাড়ি হয় {listed}।"
        if q > 2:
            text += f" এখন কিচেনে কয়েকটা অর্ডার আগে আছে, তাই আরও {say_minutes(q, lang)} ধরে রাখুন।"
        return text + " এর মধ্যে কোনটা অর্ডার করতে চান?"
    listed_en = [f"the {it.get('name')} ({say_minutes(m, lang)})" for it, m in picks]
    joined = listed_en[0] if len(listed_en) == 1 else ", ".join(listed_en[:-1]) + " and " + listed_en[-1]
    text = f"Quickest right now: {joined}."
    if q > 2:
        text += f" There are a few orders ahead, so allow {say_minutes(q, lang)} extra."
    return text + " Would you like to order?"


def eta_hint(est: Optional[Dict[str, Any]], lang: str) -> str:
    """For the order read-back: " It'll be ready in about 20 minutes." """
    if not est:
        return ""
    return (f" খাবার প্রায় {round_for_guest(est['totalMinutes'])} মিনিটের মধ্যে তৈরি হবে।" if lang == "bn"
            else f" It'll be ready in {say_minutes(est['totalMinutes'], lang)}.")


def placed_hint(order: Dict[str, Any], lang: str) -> str:
    """After placing: the ETA auth-service computed for this order. The clock only starts when the
    restaurant accepts, so a new order gets "about N minutes once they accept", not a countdown."""
    eta = order.get("eta") if isinstance(order.get("eta"), dict) else None
    if eta and eta.get("startsOnAccept"):
        est = int(eta.get("estimateMinutes") or eta.get("minutesLeft") or 0)
        if est <= 0:
            return ""
        # no time until they accept — the estimate appears on the screen then
        return (" অনুগ্রহ করে অপেক্ষা করুন — রেস্টুরেন্ট অর্ডারটি গ্রহণ করলেই স্ক্রিনে আনুমানিক সময় দেখতে পাবেন।" if lang == "bn"
                else " Please wait for the restaurant to accept it — you'll see the estimated time on your screen as soon as they do.")
    left = int((eta or {}).get("minutesLeft") or 0)
    if left <= 0:
        return ""
    return (f" খাবার প্রায় {round_for_guest(left)} মিনিটের মধ্যে তৈরি হয়ে যাবে — স্ক্রিনে সময়টা দেখতে পাবেন।" if lang == "bn"
            else f" It should be ready in {say_minutes(left, lang)} — you can follow the countdown on your screen.")


def facts(kitchen: Kitchen, *, cart: Optional[Dict[str, Any]] = None,
          mentioned: Optional[List[Dict[str, Any]]] = None,
          fastest: Optional[List[Tuple[Dict[str, Any], int]]] = None) -> str:
    """The WAIT TIMES line for the model — real numbers only."""
    st = _settings(kitchen)
    k = kitchen or {}
    q = _queue(kitchen)
    bits = [
        f"QUEUE: a new order waits ~{q} min before cooking starts ({int(k.get('ordersInKitchen') or 0)} orders ahead) — "
        f"this is waiting, NOT a dish's cooking time; if ordered now, ready = the dish's prep time + {q} min",
        f"a dish without a listed prep time takes ~{st['defaultPrepMinutes']} min to make "
        f"(so ~{st['defaultPrepMinutes'] + q} min if ordered now)",
    ]
    if cart:
        bits.append(
            f"CART if ordered now: ready in ~{cart['totalMinutes']} min"
            + (f" (slowest: {cart['slowest'].get('name')})" if cart.get("slowest") and cart["lines"] > 1 else "")
        )
    for it in mentioned or []:
        lo, hi = dish_range(it, st["defaultPrepMinutes"])
        bits.append(f"{it.get('name')}: {lo if lo == hi else f'{lo}–{hi}'} min to make → ready in "
                    f"~{lo + q if lo == hi else f'{lo + q}–{hi + q}'} min if ordered now")
    if fastest:
        bits.append("quickest dishes for this guest: " + ", ".join(f"{it.get('name')} ~{m} min" for it, m in fastest))
    for o in k.get("myOrders") or []:
        if o.get("status") == "ready":
            state = "READY — on its way to the table"
        elif o.get("late"):
            state = f"{o.get('status')}, running a little late"
        elif o.get("hasEta"):
            state = f"{o.get('status')}, ~{o.get('minutesLeft')} min left"
        else:
            state = str(o.get("status"))
        bits.append(f"GUEST'S PLACED ORDER #{o.get('orderNumber')} ({', '.join(o.get('items') or [])[:80]}): {state}")
    return "; ".join(bits)
