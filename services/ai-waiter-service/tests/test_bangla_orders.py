"""Ordering from a menu written in Bangla — run: python -m pytest tests/test_bangla_orders.py

"চিকেন ঝাল ফ্রাই দাও দুইটা আর চিকেন চাপ মাসালা দাও একটা।" added nothing: a dish name's Bangla words weren't name words
at all (only a–z were), and 'চাপ' (no English twin) counted as "a word that names no dish" — so both dishes were
taken for guesses, the cart change was refused, and the waiter asked about a "variant or size" the dish doesn't have."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

_ROWS = [
    ("ভোরের শহর", ["চিকেন সুপ", "পরোটা"]),
    ("কারির কাহিনী", ["চিকেন ঝাল ফ্রাই 🌶", "দেশি মুরগির ঝোল ✓", "গরুর মাংস ভুনা"]),
    ("ফ্যাকাথোর (বেকারের নাম)", ["চিকেন চাপ মাসালা", "চিকেন গ্রিল", "চিকেন টিক্কা", "চিকেন বটি কাবাব 🌶"]),
    ("দিন দুপুরে", ["চিকেন বিরিয়ানি", "চিকেন শাহী পোলাও", "সাদা ভাত"]),
    ("মাছের মেলা", ["রুই মাছ (গ্রাসি)", "আইর মাছ", "ছোট মাছ (জুনা)"]),
    ("ভর্তা ভাজির মাখামাখি", ["বেগুন ভাজা", "মাছ ভর্তা", "চিকেন ভর্তা"]),
]
MENU = [{"id": f"m{c}{n}", "name": name, "price": 120, "category": cat} for c, (cat, names) in enumerate(_ROWS) for n, name in enumerate(names)]
IDX = MenuIndex(MENU)
ORDERABLE = {it["id"]: True for it in MENU}
BY = {it["name"]: it for it in MENU}


def _add(name, q=1):
    return {"op": "add", "item": IDX.ref_by_id[BY[name]["id"]], "name": name, "quantity": q}


def _check(transcript, ops):
    out, problems = brain._validate_ops(ops, IDX, {}, ORDERABLE, transcript, transcript, pick_said=transcript)
    return [(o["name"], o.get("quantity")) for o in out], problems


def test_bangla_name_words_count():
    assert {"chicken", "চাপ"} <= brain._name_tokens("চিকেন চাপ মাসালা")
    assert brain._name_tokens("চিকেন চাপ মাসালা") <= brain._guest_tokens("চিকেন চাপ মাসালা দাও", brain._menu_rev(IDX))
    assert "fish" in brain._name_tokens("রুই মাছের কালিয়া")  # the ending doesn't matter: মাছের = মাছ = fish
    assert "কালিয়া" in brain._name_tokens("রুই মাছের কালিয়া")  # no English twin: the word itself
    assert "ও" not in brain._name_tokens("ডাল ও ভাত")


def test_two_bangla_dishes_in_one_sentence_are_both_added():
    ops, problems = _check("চিকেন ঝাল ফ্রাই দাও দুইটা আর চিকেন চাপ মাসালা দাও একটা।",
                           [_add("চিকেন ঝাল ফ্রাই 🌶", 2), _add("চিকেন চাপ মাসালা")])
    assert ops == [("চিকেন ঝাল ফ্রাই 🌶", 2), ("চিকেন চাপ মাসালা", 1)] and problems == []
    ops, problems = _check("একটা চিকেন বিরিয়ানি আর দুইটা বেগুন ভাজা দেন", [_add("চিকেন বিরিয়ানি"), _add("বেগুন ভাজা", 2)])
    assert ops == [("চিকেন বিরিয়ানি", 1), ("বেগুন ভাজা", 2)] and problems == []


def test_the_guards_still_hold_on_a_bangla_menu():
    # a word we can't place + a dish the guest never named → not added, asked again
    ops, problems = _check("আরেকটি ছোলাক বানাও", [_add("চিকেন সুপ")])
    assert ops == [] and any("not heard clearly" in p for p in problems)
    # "chicken" fits many dishes → which one?
    ops, problems = _check("চিকেন দাও একটা", [_add("চিকেন গ্রিল")])
    assert ops == [] and any("fit several dishes" in p for p in problems)
    # a question isn't an order
    ops, problems = _check("চিকেন বিরিয়ানি কেমন?", [_add("চিকেন বিরিয়ানি")])
    assert ops == [] and any("asked a question" in p for p in problems)
