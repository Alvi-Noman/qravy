"""ভর্তা and ভাজি the way a Bengali waiter says them: the kind asked for (never the dishes that only share their menu
section), "ভাজি" = every bhaji, "আর কি কি ভর্তা আছে?" = the ones not said yet, and "সাথে ভর্তা বা ভাজি কিছু নেবেন?" with
a fish or meat curry. Run: python -m pytest tests/test_bhorta_bhaji.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bhorta_bhaji  # noqa: E402
from test_night_fixes import run  # noqa: E402

S = "ভর্তা ভাজির মাখামাখি"
MENU = [
    {"id": "bhat", "name": "সাদা ভাত", "price": 20, "category": "ভাত"},
    {"id": "rui", "name": "রুই মাছ", "price": 220, "category": "মাছ"},
    {"id": "ilish", "name": "সরষে ইলিশ", "price": 450, "category": "মাছ"},
    {"id": "beef", "name": "গরুর কালা ভুনা", "price": 280, "category": "মাংস"},
    {"id": "alu", "name": "আলু ভর্তা", "price": 30, "category": S},
    {"id": "begun", "name": "বেগুন ভর্তা", "price": 40, "category": S},
    {"id": "chingri", "name": "চিংড়ির ভর্তা", "price": 60, "category": S},
    {"id": "shak", "name": "শাক ভাজি", "price": 40, "category": S},
    {"id": "korola", "name": "করলা ভাজি 🌶🌶🌶", "price": 40, "category": S},
    {"id": "sobji", "name": "পাঁচমিশালি সবজি", "price": 50, "category": S},
    {"id": "kochu", "name": "ইলিশ কচু", "price": 60, "category": S},
    {"id": "bhaji", "name": "ভাজি", "price": 30, "category": "ভোরের শহর", "available": False,
     "unavailableReason": "আজ শেষ হয়ে গেছে"},
]


def ask(text, **kw):
    out, calls = run(text, items=MENU, **kw)
    return out, calls


def test_the_kind_is_its_dishes_not_its_menu_section():
    assert [bhorta_bhaji.group(i) for i in MENU[4:11]] == ["bhorta"] * 3 + ["bhaji"] * 3 + [""]
    out, calls = ask("ভর্তার মধ্যে কি কি আছে?")
    assert not calls and out["meta"]["guards"] == ["side_kind_list"], out["replyText"]
    assert out["replyText"].startswith("ভর্তার মধ্যে আলু ভর্তা, বেগুন ভর্তা আর চিংড়ির ভর্তা আছে"), out["replyText"]
    assert "কচু" not in out["replyText"] and "ভাজি" not in out["replyText"], out["replyText"]


def test_bhaji_is_every_bhaji_and_both_are_said_together():
    for q in ("ভাজি আছে।", "কি কি ভাজি আছে তোমাদের?", "সবজি কি আছে?"):
        out, calls = ask(q)
        assert not calls and out["replyText"].startswith("ভাজির মধ্যে শাক ভাজি, করলা ভাজি আর পাঁচমিশালি সবজি আছে"), (q, out["replyText"])
    out, calls = ask("ভর্তা বা ভাজির মধ্যে কিছু আছে?")
    assert not calls and out["replyText"].startswith(
        "ভর্তার মধ্যে আলু ভর্তা, বেগুন ভর্তা আর চিংড়ির ভর্তা আছে, আর ভাজির মধ্যে"), out["replyText"]
    assert out["replyText"].endswith("কোনটা নেবেন?"), out["replyText"]


def test_a_bhaji_we_dont_have_and_one_we_do_by_another_name():
    out, calls = ask("বাঁধা ভাজি আছে?")
    assert not calls and out["replyText"].startswith("দুঃখিত, বাঁধাকপি ভাজি নেই। ভাজির মধ্যে"), out["replyText"]
    out, calls = ask("ভর্তার মধ্যে ঝাল কোনটা?")
    assert out["meta"]["guards"] != ["side_kind_list"]  # (no spicy bhorta on this menu: the model answers)
    out, calls = ask("ভাজির মধ্যে ঝাল কোনটা?")
    assert not calls and out["replyText"].startswith("ঝাল চাইলে করলা ভাজি — এটাতে ঝাল আছে"), out["replyText"]


def test_a_named_bhorta_and_a_fish_fry_go_the_usual_way():
    out, _calls = ask("আলু ভর্তা আছে?")
    assert out["meta"]["guards"] == ["have_named"], out["replyText"]
    assert bhorta_bhaji.answer("ইলিশ ভাজা আছে?", MENU, lambda i: i["id"], {}, [], "bn", lambda i: i) is None


def test_more_of_the_same_kind_is_the_ones_not_said():
    many = MENU + [{"id": f"b{i}", "name": f"{n} ভর্তা", "price": 40, "category": S}
                   for i, n in enumerate(("টমেটো", "ডিম", "মাছ", "ইলিশ", "চিকেন"))]
    first = bhorta_bhaji.answer("ভর্তার মধ্যে কি কি আছে?", many, lambda i: i["id"], {}, [], "bn", lambda i: {"itemId": i["id"]})
    text, _rows, note, shown = first
    assert note == "side_kind_list" and len(shown) == 7 and "এছাড়া আরও আছে" in text, text
    more = bhorta_bhaji.answer("আর কি কি ভর্তা আছে?", many, lambda i: i["id"], {}, [], "bn", lambda i: {"itemId": i["id"]},
                               seen=((), shown), said_before=text)
    assert more[2] == "side_kind_more" and more[0].startswith("আরও আছে — ভর্তার মধ্যে") and set(more[3]).isdisjoint(shown), more[0]
    done = bhorta_bhaji.answer("আর কি কি ভর্তা আছে?", many, lambda i: i["id"], {}, [], "bn", lambda i: {"itemId": i["id"]},
                               seen=(shown, more[3]), said_before=more[0])
    assert done[2] == "side_kind_other" and done[0].startswith("ভর্তা বলতে এগুলোই আছে — চাইলে ভাজির মধ্যে"), done[0]


def test_with_a_curry_the_waiter_asks_bhorta_or_bhaji():
    import session_ctx
    sid, cart, hist, state = "bb-test", [], [], None
    for said in ("একটা রুই মাছ আর একটা ভাত দেন", "হ্যাঁ", "আলু ভর্তা দেন"):
        out, _ = ask(said, cart=cart, state=state, history=hist)
        m = out["meta"]
        cart = cart + [(o["itemId"], o.get("quantity") or 1) for o in m.get("cartOps") or [] if o.get("op") == "add"]
        session_ctx.update_state("t", sid, meta=m, user_text=said)
        state = session_ctx.get_state("t", sid)
        hist = hist + [{"role": "user", "content": said}, {"role": "assistant", "content": out["replyText"]}]
        if said == "একটা রুই মাছ আর একটা ভাত দেন":
            assert out["replyText"].endswith("সাথে ভর্তা বা ভাজি কিছু নেবেন?"), out["replyText"]
        elif said == "হ্যাঁ":
            assert out["replyText"].startswith("ভর্তার মধ্যে আলু ভর্তা"), out["replyText"]
        else:
            assert [(o["op"], o["itemId"]) for o in m["cartOps"]] == [("add", "alu")], out["replyText"]


def test_all_but_one_and_which_one():
    out, calls = ask("বেগুন ভর্তা বাদে আর কী আছে?")
    assert not calls and out["meta"]["guards"] == ["side_kind_except"], out["replyText"]
    assert out["replyText"].startswith("বেগুন ভর্তা ছাড়া ভর্তার মধ্যে আলু ভর্তা আর চিংড়ির ভর্তা আছে"), out["replyText"]
    out, calls = ask("একটা ভর্তা দাও")
    assert not calls and out["replyText"] == "কোন ভর্তা দেব? আমাদের মেনুতে আছে আলু ভর্তা, বেগুন ভর্তা আর চিংড়ির ভর্তা।", out["replyText"]


def test_which_bhorta_is_answered_by_its_word_and_rice_is_asked_with_a_curry():
    import session_ctx
    sid, cart, hist, state = "bb-which", [("rui", 1)], [], None
    for said in ("দুইটা ভর্তা দাও", "আলু"):
        out, _ = ask(said, cart=cart, state=state, history=hist)
        m = out["meta"]
        session_ctx.update_state("t", sid, meta=m, user_text=said)
        state = session_ctx.get_state("t", sid)
        hist = hist + [{"role": "user", "content": said}, {"role": "assistant", "content": out["replyText"]}]
        if said == "দুইটা ভর্তা দাও":
            assert out["replyText"].endswith("নাকি ভাত বলেছিলেন?"), out["replyText"]  # (a curry, no rice yet)
    assert [(o["op"], o["itemId"], o["quantity"]) for o in m["cartOps"]] == [("add", "alu", 2)], out["replyText"]
