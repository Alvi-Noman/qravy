"""A dish the menu doesn't have AT ALL (not one that's off now): the waiter says so plainly and offers the closest real
dishes — and never talks about it as if it had it, nor puts another dish in the tray in its place.

Nov 20, a bench of 20 asks on a Bangla rice house's live menu: only pizza and burger got "not on this menu"; "পেপসি",
"আইসক্রিম", "সুশি", "পায়েস", "ইলিশ ভাজা" got no fact at all, and "মাটন বিরিয়ানি" was hinted as the চিকেন বিরিয়ানি.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brain  # noqa: E402
from waiter_knowledge import MenuIndex  # noqa: E402

MENU = MenuIndex([
    {"id": "b1", "name": "চিকেন বিরিয়ানি", "price": 240},
    {"id": "k1", "name": "স্পেশাল মাটন কাচ্চি", "price": 420},
    {"id": "m1", "name": "মাটন খিচুড়ি", "price": 300},
    {"id": "f1", "name": "সরষে ইলিশ", "price": 450},
    {"id": "f2", "name": "ইলিশ কচু", "price": 60},
    {"id": "c1", "name": "গরুর কালা ভুনা", "price": 280},
    {"id": "j1", "name": "চিকেন ঝাল ফ্রাই 🌶", "price": 220},
    {"id": "s1", "name": "কোকা কোলা", "price": 25},
    {"id": "s2", "name": "স্প্রাইট", "price": 25},
    {"id": "d1", "name": "নূর-ই-কেশর ফিরনি", "price": 120},
    {"id": "d2", "name": "বগুড়ার বিখ্যাত সরা দই", "price": 320},
])
ON = {}


def reading(*dishes):
    return {"intent": "availability", "dishes": [{"name": n, "qty": 0, "size": "", "change": c, "kind": k}
                                                 for n, k, c in dishes]}


def test_on_the_menu_only_when_one_dish_has_every_word():
    for name in ("চিকেন বিরিয়ানি", "কাচ্চি", "চিকেন ফ্রাই", "কোকা কোলা", "চিকেন ঝালফ্রাই", "ফুল চিকেন বিরিয়ানি"):
        assert brain._on_this_menu(name, MENU), name
    for name in ("পিজ্জা", "সুশি", "পেপসি", "আইসক্রিম", "ইলিশ ভাজা", "গরুর রেজালা", "থাই স্যুপ"):
        assert not brain._on_this_menu(name, MENU), name


def test_the_closest_real_dishes_are_of_the_same_kind():
    ids = lambda xs: [MENU.item_id(x) for x in xs]  # noqa: E731
    assert set(ids(brain._nearest_on_menu("পেপসি", "soft drink", MENU, ON))) == {"s1", "s2"}
    assert "f1" in ids(brain._nearest_on_menu("ইলিশ ভাজা", "fish fry", MENU, ON))
    assert ids(brain._nearest_on_menu("গরুর রেজালা", "beef curry", MENU, ON))[0] == "c1"
    assert set(ids(brain._nearest_on_menu("পায়েস", "dessert", MENU, ON))) == {"d1", "d2"}
    assert brain._nearest_on_menu("সুশি", "sushi", MENU, ON) == []  # nothing like it — never a stand-in
    assert brain._nearest_on_menu("পিজ্জা", "pizza", MENU, ON) == []


def test_the_fact_says_not_on_the_menu_and_names_the_closest():
    asks = brain._off_menu_asks(reading(("চিকেন বিরিয়ানি", "rice dish", "add"), ("পেপসি", "soft drink", "add")), MENU)
    assert asks == [("পেপসি", "soft drink")]  # (the biryani is on the menu: half the order is fine)
    [fact] = brain._off_menu_facts(asks, MENU, ON)
    assert fact.startswith('NOT ON THIS MENU AT ALL: "পেপসি"') and "কোকা কোলা" in fact and "never \"sold out\"" in fact
    [none] = brain._off_menu_facts([("সুশি", "sushi")], MENU, ON)
    assert "Nothing on this menu is like it" in none
    assert brain._off_menu_asks(reading(("পিজ্জা", "pizza", "remove")), MENU) == []  # (taking out isn't asking for it)


def test_a_reply_that_sounds_like_we_have_it_is_caught():
    assert brain._sounds_available("জি, পেপসি আছে। কয়টা দেব?", "পেপসি")
    assert not brain._sounds_available("দুঃখিত, পেপসি আমাদের মেনুতে নেই। কোকা কোলা দেব?", "পেপসি")
    assert not brain._sounds_available("Sorry, we don't have Pepsi — Coke?", "Pepsi")
    assert not brain._sounds_available("কোকা কোলা দেব?", "পেপসি")  # (not named at all)


def test_no_short_name_hint_against_the_guests_other_words():
    # "মাটন বিরিয়ানি": the biryani here is chicken — never hinted as the চিকেন বিরিয়ানি
    hints = brain._word_dish_hints("মাটন বিরিয়ানি আছে?", MENU)
    assert all("b1" not in [MENU.item_id(i) for i in its] for _w, its in hints)


def _turn(said, reading_, answers):
    """One turn, AI-first: the guest's meaning given, the AI's answers in turn; → (reply, what the AI was told)."""
    import asyncio
    import json
    sent = []

    async def fake(messages):
        sent.append(messages)
        reply, ops = answers[min(len(sent), len(answers)) - 1]
        return json.dumps({"topic": "menu_question", "intent": "menu", "language": "bn", "mentionedItems": [],
                           "cartOps": ops, "clearCart": False, "confirmOrder": False, "checkout": "none",
                           "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [],
                           "foodsNamed": [], "guestPrefs": None, "replyText": reply})

    async def understood(*_a, **_k):
        return reading_

    saved = brain._call_openai, brain.AI_FIRST, brain._understand
    brain._call_openai, brain.AI_FIRST, brain._understand = fake, True, understood
    try:
        out = asyncio.run(brain.generate_reply(said, locale="bn", menu_snapshot={"items": list(MENU.items)},
                                               context={"cartItems": [], "localTime": "19:00"}))
    finally:
        brain._call_openai, brain.AI_FIRST, brain._understand = saved
    return out, sent


def test_the_ai_is_told_and_rewrites_a_yes():
    out, sent = _turn("একটা পেপসি দেন", reading(("পেপসি", "soft drink", "add")),
                      [("জি, পেপসি আছে। একটা দিচ্ছি।", []), ("দুঃখিত, পেপসি আমাদের মেনুতে নেই — কোকা কোলা দেব?", [])])
    told = "\n".join(m["content"] for m in sent[0])
    assert 'NOT ON THIS MENU AT ALL: "পেপসি"' in told and "কোকা কোলা" in told
    assert len(sent) == 2 and "NOT on this menu — you wrote as if it were" in "\n".join(m["content"] for m in sent[1])
    assert out["replyText"].startswith("দুঃখিত, পেপসি আমাদের মেনুতে নেই")


def test_another_dish_is_never_put_in_the_tray_in_its_place():
    swap = [{"op": "add", "item": "s1", "line": "", "quantity": 1, "variant": "", "note": "", "removeNote": False, "choices": []}]
    out, sent = _turn("একটা পেপসি দেন", reading(("পেপসি", "soft drink", "add")),
                      [("একটা কোকা কোলা দিলাম।", swap), ("পেপসি নেই — কোকা কোলা দেব?", [])])
    assert len(sent) == 2 and "don't add কোকা কোলা in its place" in "\n".join(m["content"] for m in sent[1])
    assert not (out["meta"].get("cartOps") or [])
