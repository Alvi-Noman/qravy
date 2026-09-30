"""The tray is changed only when it's clear what the guest wants — and then exactly as they said it. Real failing turns
from the transcripts (the model's own output replayed) plus the ways people count, size and change an order."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import brain  # noqa: E402

ITEMS = [
    {"id": "wns", "name": "Won Thon Noodle Soup", "price": 320, "category": "Soup"},
    {"id": "fwt", "name": "Fried Won Thon", "price": 230, "category": "Appetizer"},
    {"id": "crs", "name": "Crispy Rice Soup", "price": 300, "category": "Soup"},
    {"id": "ccs", "name": "Chicken Corn Soup", "price": 300, "category": "Soup"},
    {"id": "ff", "name": "French Fry", "price": 160, "category": "Appetizer"},
    {"id": "mws", "name": "Mineral Water (small)", "price": 15, "category": "Drinks"},
    {"id": "mwl", "name": "Mineral Water (large)", "price": 25, "category": "Drinks"},
    {"id": "coke", "name": "Coca-Cola", "price": 60, "category": "Drinks"},
    {"id": "sfp", "name": "Special Fried Prawn", "price": 380, "category": "Prawn"},
    {"id": "mch", "name": "Masala Chicken", "price": 350, "category": "Chicken"},
    {"id": "kb", "name": "Kacchi Biryani", "price": 450, "category": "Biryani",
     "variations": [{"name": "Half", "price": 450}, {"name": "Full", "price": 850}]},
    {"id": "pz", "name": "Chicken Pizza", "price": 600, "category": "Pizza",
     "variations": [{"name": "Small", "price": 400}, {"name": "Medium", "price": 600}, {"name": "Large", "price": 900}]},
    {"id": "bs", "name": "Beef Sizzling", "price": 550, "category": "Sizzling", "available": False},
    {"id": "cs", "name": "Chicken Sizzling", "price": 500, "category": "Sizzling"},
    {"id": "ps", "name": "Prawn Sizzling", "price": 650, "category": "Sizzling"},
    {"id": "sr", "name": "Spring Roll", "price": 200, "category": "Appetizer"},
]
IDX = brain.MenuIndex(ITEMS)
BY = {i["id"]: i for i in ITEMS}
BASE = {"topic": "order_change", "intent": "order", "language": "bn", "mentionedItems": [], "clearCart": False,
        "confirmOrder": False, "checkout": "none", "understood": True, "answerItems": [], "serviceRequest": None,
        "suggestions": [], "voiceReplyText": "", "replyText": ""}


def ref(i):
    return IDX.ref(IDX.by_id[i])


def add(i, q=1, v=None):
    return {"op": "add", "item": ref(i), "quantity": q, **({"variant": v} if v else {})}


def tray(*pairs):
    return [{"itemId": i, "quantity": q, "price": IDX.by_id[i]["price"]} for i, q in pairs]


def run(text, model=None, cart=(), last_waiter=None):
    async def fake(messages):
        return json.dumps({**BASE, **(model or {"replyText": "…"})})

    orig = brain._call_openai
    brain._call_openai = fake
    hist = [{"role": "user", "content": "…"}, {"role": "assistant", "content": last_waiter}] if last_waiter else None
    try:
        out = asyncio.run(brain.generate_reply(
            text, menu_snapshot={"items": ITEMS}, locale="bn", history=hist,
            context={"cartItems": [dict(c) for c in cart], "mealKinds": ["dinner"], "table": "12"}))
    finally:
        brain._call_openai = orig
    return out


def ops(out):
    return [(o["op"], o["itemId"], o.get("quantity"), o.get("variant")) for o in out["meta"].get("cartOps") or []]


def labels(out):
    return [c["label"] for c in (out["meta"].get("decision") or {}).get("chooseOptions") or []]


def test_never_guesses():
    # garbled speech → nothing added / changed, "please say it again"
    out = run("আমি ক্ছ কম ধারের মান্থে কেছে কায় তেল আছে কি কা আজে তে বারেত করানে",
              {"cartOps": [add("crs"), add("sfp")], "replyText": "যোগ করা হলো।"})
    assert ops(out) == [] and "স্পষ্ট শুনতে পারিনি" in out["replyText"], out["replyText"]
    out = run("বলন্তনসুক দুইটা করেন।", {"cartOps": [{"op": "set", "item": ref("mws"), "quantity": 2}],
                                        "replyText": "করা হলো।"}, cart=tray(("mws", 1), ("crs", 1)))
    assert ops(out) == [] and "স্পষ্ট শুনতে পারিনি" in out["replyText"], out["replyText"]
    # a bare "হ্যাঁ, দেন" after something that offered no dish → never a random dish
    out = run("হ্যাঁ, দেন.", {"cartOps": [add("mch")], "replyText": "মাসালা চিকেন যোগ করলাম।"},
              last_waiter="আপনার অর্ডার রেস্টুরেন্টে পাঠানো হয়েছে। অনুগ্রহ করে অপেক্ষা করুন।")
    assert ops(out) == [] and out["replyText"] == "জি, কী দেব বলবেন?", out["replyText"]
    # "maybe later" is not an order
    out = run("পরে হয়তো একটা কোক নেব", {"cartOps": [add("coke")], "replyText": "Coca-Cola যোগ করলাম।"})
    assert ops(out) == [] and "পরে লাগলে বলবেন" in out["replyText"], out["replyText"]


def test_the_right_dish():
    # "ওয়ান্টন স্যুপ" is the soup, not Fried Won Thon
    out = run("আমাকে একটা ওয়ান্টন স্যুপ দিবেন।", {"cartOps": [add("fwt")], "replyText": "একটা ফ্রাইড ওয়ান্টন যোগ করলাম।"})
    assert ops(out) == [("add", "wns", 1, None)], out["replyText"]
    assert "Won Thon Noodle Soup" in out["replyText"]
    # said differently from the menu's spelling: "পিজ্জা" (পিৎজা), "কোক" (Coca-Cola)
    out = run("একটা লার্জ চিকেন পিজ্জা", {"cartOps": [add("pz", 1, "Large")], "replyText": "যোগ করলাম।"})
    assert ops(out) == [("add", "pz", 1, "Large")], (ops(out), out["replyText"])
    out = run("কোক একটা কম দিন", {"cartOps": [{"op": "set", "item": ref("coke"), "quantity": 2}], "replyText": "…"},
              cart=tray(("coke", 3)))
    assert ops(out) == [("set", "coke", 2, None)], out["replyText"]
    # a generic word that fits several → which one (only what can be ordered now)
    out = run("একটা সিজলিং দিন", {"cartOps": [add("cs")], "replyText": "Chicken Sizzling যোগ করলাম।"})
    assert ops(out) == [] and labels(out) == ["Chicken Sizzling", "Prawn Sizzling"], out["replyText"]


def test_sizes():
    for said, want in (("একটা ফুল প্লেট কাচ্চি দিন", "Full"), ("একটা বড় কাচ্চি দিন", "Full"), ("একটা ছোট কাচ্চি দিন", "Half")):
        out = run(said, {"cartOps": [add("kb", 1, "Full")], "replyText": "যোগ করলাম।"})
        assert ops(out) == [("add", "kb", 1, want)], (said, ops(out), out["replyText"])
    # no size said → ask, with the sizes as buttons (never the model's guess)
    out = run("একটা চিকেন পিজ্জা দিন", {"cartOps": [add("pz", 1, "Medium")], "replyText": "যোগ করলাম।"})
    assert ops(out) == [] and labels(out) == ["Small", "Medium", "Large"], out["replyText"]
    out = run("একটা হাফ আর একটা ফুল কাচ্চি দিন", {"cartOps": [add("kb", 1, "Half"), add("kb", 1, "Full")], "replyText": "…"})
    assert ops(out) == [("add", "kb", 1, "Half"), ("add", "kb", 1, "Full")]


def test_quantities_as_people_say_them():
    q = brain._said_quantity
    assert (q("হাফ ডজন স্প্রিং রোল"), q("এক ডজন"), q("২ ডজন"), q("এক জোড়া"), q("দুই জোড়া"), q("a couple of cokes"),
            q("half a dozen"), q("দু'টো"), q("গোটা চারেক"), q("বারোটা")) == (6, 12, 24, 2, 4, 2, 6, 2, 4, 12)
    out = run("হাফ ডজন স্প্রিং রোল দিন", {"cartOps": [add("sr", 1)], "replyText": "Spring Roll যোগ করলাম।"})
    assert ops(out) == [("add", "sr", 6, None)] and "6টা Spring Roll" in out["replyText"], out["replyText"]
    out = run("চিকেন সিজলিং আর ফ্রেঞ্চ ফ্রাই দুইটা করে দিন", {"cartOps": [add("cs", 1), add("ff", 2)], "replyText": "…"})
    assert ops(out) == [("add", "cs", 2, None), ("add", "ff", 2, None)], out["replyText"]
    out = run("ফ্রেঞ্চ ফ্রাই ডাবল করে দিন", {"cartOps": [], "replyText": "…"}, cart=tray(("ff", 2)))
    assert ops(out) == [("set", "ff", 4, None)], out["replyText"]
    # a table number is not a count
    out = run("বারো নম্বর টেবিলে দুইটা কোক দিন", {"cartOps": [add("coke", 2)], "replyText": "…"})
    assert ops(out) == [("add", "coke", 2, None)], out["replyText"]


def test_already_in_the_tray_is_asked_the_same_way_every_time():
    # "দাও চিকেন কর্ন স্যুপ দুইটা" with 1 there: the model silently made it 2 — 2 MORE or 2 in all? ask, with buttons;
    # the clear part of the sentence (3 fries) is done right away
    out = run("ঠিক আছে, দাও চিকেন কর্ন স্যুপ দুইটা আর ফ্রেঞ্চ ফ্রাই তিনটা।",
              {"cartOps": [{"op": "set", "item": ref("ccs"), "quantity": 2}, add("ff", 3)], "replyText": "…"},
              cart=tray(("ccs", 1), ("sfp", 1)))
    assert ops(out) == [("add", "ff", 3, None)], out["replyText"]
    assert out["replyText"].endswith("আপনার ট্রেতে আগে থেকেই 1টা Chicken Corn Soup আছে — আরও 2টা যোগ করে মোট 3টা করব?")
    assert labels(out) == ["হ্যাঁ, মোট 3টা", "না, মোট 2টা"], labels(out)
    # "দুইটা করে দিন" / "মোট দুইটা" says the total → just done
    out = run("চিকেন কর্ন স্যুপ মোট দুইটা করে দিন", {"cartOps": [{"op": "set", "item": ref("ccs"), "quantity": 2}],
                                                "replyText": "…"}, cart=tray(("ccs", 1)))
    assert ops(out) == [("set", "ccs", 2, None)], out["replyText"]


def test_removing_what_isnt_there_and_saying_no():
    out = run("স্প্রিং রোলটা বাদ দেন।", {"cartOps": [], "replyText": "স্প্রিং রোল কার্ট থেকে বাদ দেওয়া হয়েছে।"},
              cart=tray(("sfp", 1), ("ff", 2)))
    assert "বাদ দেওয়া হয়েছে" not in out["replyText"] and "ট্রেতে নেই" in out["replyText"], out["replyText"]
    assert labels(out) == ["Special Fried Prawn", "French Fry"]
    # "আর কিছু লাগবে না" is never "that isn't in your tray"
    out = run("না, আর কিছু লাগবে না", {"replyText": "ঠিক আছে।"}, cart=tray(("sfp", 1)))
    assert "ট্রেতে নেই" not in out["replyText"], out["replyText"]
    # "না" to the waiter's own offer declines THAT dish — not "read my order back"
    out = run("না।", {"replyText": "ঠিক আছে।"}, cart=tray(("mws", 1), ("crs", 2)),
              last_waiter="যোগ করলাম। সকালের জন্য Chicken Corn Soup দারুণ হবে, নেবেন?")
    assert out["replyText"] == "ঠিক আছে! আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
    assert (out["meta"].get("checkout") or {}).get("stage") in (None, "none")


def test_sold_out_offers_the_closest():
    out = run("একটা বিফ সিজলিং দিন", {"cartOps": [add("bs")], "replyText": "Beef Sizzling যোগ করলাম।"})
    assert ops(out) == []
    assert out["replyText"].startswith("দুঃখিত, Beef Sizzling এখন পাওয়া যাচ্ছে না।"), out["replyText"]
    assert labels(out) == ["Chicken Sizzling", "Prawn Sizzling"], labels(out)


def test_ready_made_things_are_never_praised_or_recommended():
    import recommender
    assert all(recommender.is_packaged(BY[i]) for i in ("mws", "mwl", "coke"))
    assert not any(recommender.is_packaged(x) for x in ({"name": "Mango Lassi"}, {"name": "Fresh Lime Soda"},
                                                         {"name": "Borhani"}, {"name": "Chicken Corn Soup"}))
    # the real turn: "না, ঠিক আছে, আলাদা কিছু." → "ছোট মিনারেল ওয়াটার একটা নিতে পারেন, এটা অনেকেই পছন্দ করেন।"
    model = {"topic": "order_review", "intent": "suggestions",
             "replyText": "আপনার অর্ডার ঠিক আছে। ছোট Mineral Water (small) একটা নিতে পারেন, এটা অনেকেই পছন্দ করেন। আর কিছু লাগবে?",
             "suggestions": [{"item": ref("mws"), "reason": "popular"}, {"item": ref("ccs"), "reason": ""}]}
    out = run("না, ঠিক আছে, আলাদা কিছু.", model, cart=tray(("sfp", 1)))
    assert "পছন্দ করেন" not in out["replyText"] and "packaged_praise_removed" in out["meta"]["guards"], out["replyText"]
    assert "mws" not in [s["itemId"] for s in out["meta"]["suggestions"]], out["meta"]["suggestions"]
    # a recommendation never lists water / Coke …
    out = run("ভালো কী আছে?", {"topic": "recommendation", "intent": "suggestions", "replyText": "…"})
    assert not {"mws", "mwl", "coke"} & {s["itemId"] for s in out["meta"]["suggestions"]}, out["replyText"]
    # … but asked for drinks, they're there
    out = run("ড্রিংকস কী আছে?", {"topic": "recommendation", "intent": "suggestions", "replyText": "…"})
    assert {"coke"} & {s["itemId"] for s in out["meta"]["suggestions"]} or "Coca-Cola" in out["replyText"], out["replyText"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
