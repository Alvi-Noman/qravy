"""The owner's own "what can I eat now?" (now_answers.py): said with the first choice of each dish that can be ordered,
a dish with none left out with its joining word, a sentence with all its dishes gone skipped — and the waiter's own
sentence turned into the owner's starting point (pills with same-kind backups)."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import bangla_meal  # noqa: E402
import brain  # noqa: E402
import now_answers as N  # noqa: E402

ITEMS = {
    "d1": {"id": "d1", "name": "সাদা ভাত (মিনিকেট)", "category": "ভাত", "price": 40},
    "d2": {"id": "d2", "name": "রুই মাছ (গ্লাসি)", "category": "মাছ", "price": 220},
    "d3": {"id": "d3", "name": "হাওরের বোয়াল মাছ", "category": "মাছ", "price": 380},
    "d4": {"id": "d4", "name": "বাইম মাছ", "category": "মাছ", "price": 350},
    "d5": {"id": "d5", "name": "গরুর লাল ভুনা", "category": "কারি", "price": 350},
}
dish = lambda i, b=(), say="": {"t": "dish", "id": i, "backups": list(b), "say": say}  # noqa: E731
text = lambda v: {"t": "text", "v": v}  # noqa: E731
LUNCH = [[text("এখন "), dish("d1", say="ভাত"), text(" খেতে পারেন — মাছের মধ্যে "), dish("d2", ["d4"]), text(" আর "),
          dish("d3"), text(" আছে।")],
         [text("মাংসের মধ্যে "), dish("d5"), text(" আছে।")]]


def say(off=()):
    return N.render(LUNCH, ITEMS, lambda i: i not in off, bangla_meal.said_name)


def test_each_dish_is_its_first_choice_that_can_be_ordered():
    t, named = say()
    assert t == "এখন ভাত খেতে পারেন — মাছের মধ্যে রুই মাছ আর হাওরের বোয়াল মাছ আছে। মাংসের মধ্যে গরুর লাল ভুনা আছে।", t
    assert named == ["d1", "d2", "d3", "d5"]
    t, _ = say(off={"d2"})  # রুই sold out → its backup, by its own name
    assert "মাছের মধ্যে বাইম মাছ আর হাওরের বোয়াল মাছ আছে" in t, t


def test_a_dish_with_nothing_left_goes_with_its_joining_word():
    t, _ = say(off={"d3"})
    assert "মাছের মধ্যে রুই মাছ আছে।" in t, t
    t, _ = say(off={"d2", "d4"})
    assert "মাছের মধ্যে হাওরের বোয়াল মাছ আছে।" in t, t


def test_a_sentence_whose_dishes_are_all_gone_is_skipped():
    t, named = say(off={"d5"})
    assert "মাংসের" not in t and "d5" not in named, t
    assert N.render(LUNCH, ITEMS, lambda i: False, bangla_meal.said_name) is None


def test_stored_answers_are_checked():
    raw = {"lunch": {"lines": [[text("এখন "), dish("d1", ["d1", "bad id", "d4", "d5", "d2"], "ভাত"), {"t": "x"}],
                               [], [text("   ")]]},
           "brunch": {"lines": [[text("hi")]]}}
    got = N.clean(raw)
    assert list(got) == ["lunch"] and len(got["lunch"]) == 1
    assert got["lunch"][0][1]["backups"] == ["d4", "d5"]  # (not itself, a real id, at most two)
    assert N.clean(None) == {} and N.clean({"lunch": "x"}) == {}


def test_the_time_of_day():
    assert [N.slot_of(m) for m in (9 * 60, 13 * 60, 19 * 60, 21 * 60, 23 * 60, 2 * 60)] == \
        ["morning", "lunch", "evening", "night", "night", "night"]


def test_the_waiters_own_sentence_becomes_pills():
    items = list(ITEMS.values())
    lines = N.as_lines("এখন ভাত খেতে পারেন — মাছের মধ্যে রুই মাছ আর হাওরের বোয়াল মাছ আছে। কোনটা দেব?", items,
                       set(ITEMS), bangla_meal.said_name, lambda it: bangla_meal.role(it) or "", lambda it: it["id"])
    assert len(lines) == 2
    pills = [t for t in lines[0] if t["t"] == "dish"]
    assert [p["id"] for p in pills] == ["d2", "d3"]
    assert pills[0]["backups"] == ["d4"]  # (a fish for a fish — not the other one named)


def test_the_waiter_says_the_owners_answer():
    calls = []

    async def fake(messages):
        calls.append(1)
        return json.dumps({"topic": "recommendation", "intent": "suggestions", "language": "bn", "mentionedItems": [],
                           "cartOps": [], "clearCart": False, "confirmOrder": False, "checkout": "none",
                           "understood": True, "answerItems": [], "serviceRequest": None, "suggestions": [],
                           "foodsNamed": [], "guestPrefs": None, "replyText": "(the AI)"})
    orig, ai_first = brain._call_openai, brain.AI_FIRST
    brain._call_openai = fake
    try:
        for mode in (True, False):
            brain.AI_FIRST = mode
            items = [dict(i, available=(i["id"] != "d2")) for i in ITEMS.values()]
            out = asyncio.run(brain.generate_reply(
                "এখন কি খেতে পারি?", locale="bn", menu_snapshot={"items": items},
                restaurant={"nowAnswers": {"lunch": {"lines": LUNCH}}},
                context={"cartItems": [], "localTime": "13:30"}))
            assert out["replyText"].startswith("এখন ভাত খেতে পারেন — মাছের মধ্যে বাইম মাছ"), (mode, out["replyText"])
            assert "owner_now_answer" in out["meta"]["guards"]
        assert not calls
        # another time of day has no answer of the owner's → as before
        out = asyncio.run(brain.generate_reply(
            "এখন কি খেতে পারি?", locale="bn", menu_snapshot={"items": list(ITEMS.values())},
            restaurant={"nowAnswers": {"lunch": {"lines": LUNCH}}}, context={"cartItems": [], "localTime": "19:30"}))
        assert "owner_now_answer" not in out["meta"]["guards"]
        # a question with more in it ("ঝাল ছাড়া") is never the owner's fixed answer
        out = asyncio.run(brain.generate_reply(
            "ঝাল ছাড়া কি খেতে পারি?", locale="bn", menu_snapshot={"items": list(ITEMS.values())},
            restaurant={"nowAnswers": {"lunch": {"lines": LUNCH}}}, context={"cartItems": [], "localTime": "13:30"}))
        assert "owner_now_answer" not in out["meta"]["guards"]
    finally:
        brain._call_openai, brain.AI_FIRST = orig, ai_first
