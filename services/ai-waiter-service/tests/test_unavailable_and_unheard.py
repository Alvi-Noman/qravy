"""Nov 14–19 conversations (Cortex export): what the waiter got wrong, as facts the code now gets right.

- A dish switched off with no time to come back is "not available right now" — never "sold out today" (a branch
  that never serves kebabs said "কাবাব আজ শেষ হয়ে গেছে" every day). "Sold out → until 6pm" says when it's back.
- Nothing orderable in opening hours: the waiter is told WHEN it can be again (it said "I can't say when").
- One word of praise ("ভালো") asks for nothing — it got the whole "what's on now" list again.
- A word from one dish's name is that dish said short ("ওরিও") — not nonsense to "say again".
- "Was anything said?" is the voice model's call on the whole clip, with its levels kept for unheard turns.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability as av  # noqa: E402

ALL = [0, 1, 2, 3, 4, 5, 6]
# Mon 2026-11-16, 12:03 in Dhaka (UTC+6)
NOON = datetime(2026, 11, 16, 6, 3, tzinfo=timezone.utc)


def _dish(i, cat=None, **kw):
    return {"id": i, "name": f"Dish {i}", "categoryId": cat, "status": "active", **kw}


# ------------------------------------------------------------------ switched off vs sold out

def test_switched_off_without_a_time_is_not_sold_out_today():
    rules = {"sold_out": {"k1"}}
    bn = av.unavailable_reason(_dish("k1"), rules, now=NOON, lang="bn")
    en = av.unavailable_reason(_dish("k1"), rules, now=NOON, lang="en")
    assert "আজ শেষ" not in bn and "শেষ হয়ে গেছে" not in bn and "এখন পাওয়া যাচ্ছে না" in bn
    assert "sold out" not in en and "isn't available right now" in en
    assert av.switched_off(_dish("k1"), rules) and av.switched_off(_dish("x", offline=True))
    assert av.switched_off({"id": "y", "switchedOff": True}) and not av.switched_off(_dish("z"), rules)


def test_sold_out_until_says_when_it_is_back():
    back = NOON + timedelta(hours=5, minutes=57)  # 18:00 Dhaka
    rules = {"sold_out": {"k1"}, "sold_out_until": {"k1": back}}
    assert av.unavailable_reason(_dish("k1"), rules, now=NOON, lang="bn") == "Dish k1 শেষ হয়ে গেছে — আবার পাওয়া যাবে সন্ধ্যা ৬টা।"
    assert av.unavailable_reason(_dish("k1"), rules, now=NOON, lang="en") == "Sorry, Dish k1 is sold out right now — back at 6pm."
    # the public menu's soldOutUntil (ISO) counts too; a time already passed doesn't
    item = _dish("k2", switchedOff=True, soldOutUntil=(NOON + timedelta(days=1)).isoformat())
    assert "কাল" in av.unavailable_reason(item, {}, now=NOON, lang="bn")
    gone = _dish("k3", offline=True, offlineResumeAt=NOON - timedelta(hours=1))
    assert "এখন পাওয়া যাচ্ছে না" in av.unavailable_reason(gone, {}, now=NOON, lang="bn")


def test_format_when():
    tz = "Asia/Dhaka"
    assert av.format_when(NOON + timedelta(minutes=27), tz, NOON, "bn") == "দুপুর ১২:৩০"
    assert av.format_when(NOON + timedelta(minutes=27), tz, NOON, "en") == "at 12:30pm"
    assert av.format_when(NOON + timedelta(hours=18), tz, NOON, "en") == "tomorrow at 6am"
    assert av.format_when(NOON + timedelta(days=4), tz, NOON, "bn").startswith("শুক্রবার")


# ------------------------------------------------------------------ nothing orderable: when again

def _rules(**kw):
    return {
        "tz": "Asia/Dhaka",
        "opening": [{"days": ALL, "start": "06:00", "end": "23:00"}],
        "categories": {
            "breakfast": {"name": "Breakfast", "hours": [{"days": ALL, "start": "06:00", "end": "11:30"}]},
            "lunch": {"name": "Lunch", "hours": [{"days": ALL, "start": "12:30", "end": "16:00"}]},
        },
        "periods": av.DEFAULT_PERIODS,
        **kw,
    }


def test_nothing_orderable_between_meals_gives_the_next_time():
    items = [_dish("b", "breakfast"), _dish("l", "lunch")]
    rules = _rules()
    assert all(av.unavailable_reason(it, rules, now=NOON) for it in items)  # 12:03: neither section is on
    at = av.next_orderable_at(items, rules, NOON)
    assert at is not None and av.format_when(at, "Asia/Dhaka", NOON, "bn") == "দুপুর ১২:৩০"


def test_closed_gives_the_opening_time_tomorrow():
    late = NOON + timedelta(hours=11)  # 23:03
    at = av.next_orderable_at([_dish("b", "breakfast")], _rules(), late)
    assert av.format_when(at, "Asia/Dhaka", late, "en") == "tomorrow at 6am"


def test_everything_switched_off_has_no_time():
    items = [_dish("b", "breakfast"), _dish("l", "lunch")]
    assert av.next_orderable_at(items, _rules(sold_out={"b", "l"}), NOON) is None


# ------------------------------------------------------------------ the brain's facts

def test_the_turn_block_tells_when_ordering_is_possible_again():
    import brain
    from waiter_knowledge import MenuIndex

    index = MenuIndex([{"id": "a", "name": "Plain Rice", "price": 40}])
    kw = dict(transcript="এখন কী খেতে পারি?", lang="bn", index=index, cart_rows=[], subtotal=0, recent=[],
              asked_to_confirm=False, any_orderable=False)
    with_time = brain._turn_block(context={"nextOrderable": "দুপুর ১২:৩০"}, **kw)
    assert "ordering is possible again দুপুর ১২:৩০" in with_time
    no_time = brain._turn_block(context={"nextOrderable": ""}, **kw)
    assert "no time is set" in no_time and "never invent a time" in no_time


def test_closed_a_guest_planning_for_later_gets_dishes_and_the_menu():
    # Nov 19, 23:46, closed: "Menue dekhan, kalker jonne dekhbo" / "regular menue ta dekhan ektu?" — the menu never
    # opened and no dish was named, three times
    import brain
    from waiter_knowledge import MenuIndex

    for t in ("Menue dekhan,kalker jonne dekhbo.", "Thikache,but regular menue ta dekhan ektu?", "menu ta dao"):
        assert brain._SEE_MENU.search(t), t
    for t in ("menu te ki ache?", "biryani den"):
        assert not brain._SEE_MENU.search(t), t
    index = MenuIndex([{"id": "a", "name": "Plain Rice", "price": 40}])
    block = brain._turn_block(transcript="Menue dekhan, kalker jonne dekhbo.", lang="bn", index=index, cart_rows=[],
                              subtotal=0, context={"nextOrderable": "কাল সকাল ৬টা"}, recent=[], asked_to_confirm=False,
                              any_orderable=False)
    assert "name a few MENU dishes they can order then" in block and "never only tell them to look" in block


def test_a_lone_good_asks_for_nothing():
    import brain
    from waiter_knowledge import MenuIndex

    index = MenuIndex([{"id": "a", "name": "Chicken Biryani", "price": 240}])
    assert not brain._general_pick_ask("ভালো", index)
    assert not brain._general_pick_ask("good", index)
    assert brain._general_pick_ask("ভালো কি আছে?", index)
    assert brain._general_pick_ask("কিছু সাজেস্ট করেন", index)


def test_a_word_from_one_dish_name_is_that_dish():
    import brain
    from waiter_knowledge import MenuIndex

    index = MenuIndex([
        {"id": "o", "name": "ওরিও ব্লাস্ট 🌶🌶", "price": 250},
        {"id": "p", "name": "ডাবের পুডিং", "price": 120},
        {"id": "c1", "name": "চিকেন বিরিয়ানি", "price": 240},
        {"id": "c2", "name": "চিকেন রোস্ট", "price": 180},
        {"id": "c3", "name": "চিকেন গ্রিল", "price": 150},
    ])
    hints = brain._word_dish_hints("ওরিও", index)
    assert [(w, [i["id"] for i in its]) for w, its in hints] == [("ওরিও", ["o"])]
    assert brain._word_dish_hints("চিকেন", index) == []  # a word three dishes share names none
    block = brain._turn_block(transcript="ওরিও", lang="bn", index=index, cart_rows=[], subtotal=0, context={},
                              recent=[], asked_to_confirm=False)
    assert "WORDS THAT ARE PART OF A DISH NAME" in block and "ওরিও ব্লাস্ট" in block


def test_bhaja_pora_is_not_a_bhaji_ask():
    # "ভাজাপোড়া কিছু নাই?" is deep-fried snacks (পুরি, সিঙ্গারা) — it got "ডিম ভাজি, ঢ্যাঁড়স ভাজি…" (Nov 20)
    import bhorta_bhaji as bb

    for t in ("ভাজাপোড়া কিছু নাই?", "ভাজা পোড়া আছে?", "ভাজা-পোড়া", "ভাজাপোরা কিছু আছে", "bhaja pora ache?", "bhajapora"):
        assert bb.asked(t) == [], t
    for t in ("ভাজি কি আছে?", "লাউ ভাজা আছে?", "bhaja ache"):
        assert bb.asked(t) == ["bhaji"], t
    assert bb.group({"name": "ঝুরি ভাজা আলু"}) == "bhaji"


# ------------------------------------------------------------------ was anything said?

def test_clip_levels_measures_the_clip():
    import endpointer

    rate = 16000
    t = np.arange(rate) / rate
    quiet = (np.sin(2 * np.pi * 220 * t) * 300).astype("<i2").tobytes()  # 1 s, about -40 dBFS
    lv = endpointer.clip_levels(quiet, rate)
    assert lv["ms"] == 1000 and -45 < lv["peakDb"] < -35 and lv["roomDb"] is not None
    assert "speechMs" in lv  # (None when the voice model isn't installed — then the loudness bar decides)
    assert endpointer.clip_levels(b"", rate)["peakDb"] is None
