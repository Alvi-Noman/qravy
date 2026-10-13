"""The admin's conversations page: stored turns → conversations per guest session, and each turn as heard →
understood → said."""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import conversations  # noqa: E402

NOW = datetime(2026, 10, 14, 12, 0)


class Cursor(list):
    def sort(self, key, direction):
        return Cursor(sorted(self, key=lambda d: d.get(key), reverse=direction < 0))

    def limit(self, n):
        return Cursor(self[:n])


class Coll:
    """Just enough of a Mongo collection for conversations."""

    def __init__(self, docs):
        self.docs = docs

    def find(self, flt, projection=None):
        def ok(d):
            for k, v in flt.items():
                if isinstance(v, dict) and "$gte" in v:
                    if d.get(k) is None or d.get(k) < v["$gte"]:
                        return False
                elif d.get(k) != v:
                    return False
            return True
        return Cursor(d for d in self.docs if ok(d))


class DB:
    def __init__(self, docs):
        self.transcripts = Coll(docs)


def turn(session, minutes_ago, text, reply, tenant="burger-house", **extra):
    meta = extra.pop("meta", {})
    return {"session": session, "ts": NOW - timedelta(minutes=minutes_ago), "text": text,
            "text_norm": extra.pop("text_norm", text), "norm_changes": extra.pop("norm_changes", []),
            "status": extra.pop("status", "new"), "engine": extra.pop("engine", "openai"), "tenant": tenant,
            "ai": {"replyText": reply, "meta": meta}, **extra}


DOCS = [
    turn("a", 30, "হট উইংস দিন", "হট উইংস যোগ করলাম।", table="12", channel="dine-in", branch="gulshan",
         location="loc1", text_norm="হট উইংস দিন",
         meta={"language": "bn", "intent": "order", "cartOps": [{"op": "add", "itemId": "1", "name": "Hot Wings",
                                                                 "quantity": 2, "variant": "Large"}]}),
    turn("a", 29, "", "দুঃখিত, শুনতে পাইনি", status="unheard", engine="unclear", table="12", location="loc1",
         meta={"language": "bn", "guards": ["unclear"]}),
    turn("a", 28, "অর্ডার করে দিন", "অর্ডার হয়ে গেছে!", location="loc1",
         meta={"intent": "confirm", "decision": {"orderPlaced": True}, "order": {"orderNumber": 17}}),
    turn("b", 10, "what's good?", "Try the Triple Cheese Tower.", engine="typed", channel="online", location="loc2",
         meta={"language": "en", "intent": "suggestions", "guards": ["reco_general"],
               "suggestions": [{"title": "Triple Cheese Tower", "itemId": "2"}]}),
    turn("c", 60 * 24 * 9, "old", "old"),  # outside the last 7 days
    turn("d", 5, "other restaurant", "x", tenant="pizza-place"),
]


def test_lists_conversations_newest_first_with_a_summary():
    out = conversations.list_conversations(DB(DOCS), "burger-house", days=7, now=NOW)
    assert [c["session"] for c in out] == ["b", "a"]
    a = out[1]
    assert a["turns"] == 3 and a["unheard"] == 1 and a["flagged"] == 1
    assert a["ordered"] is True
    assert a["preview"] == "হট উইংস দিন"
    assert a["table"] == "12" and a["channel"] == "dine-in" and a["branch"] == "gulshan"
    assert a["startedAt"].endswith("Z") and a["startedAt"] < a["lastAt"]
    assert out[0]["ordered"] is False and out[0]["language"] == "en"


def test_filters_by_branch_location():
    out = conversations.list_conversations(DB(DOCS), "burger-house", days=7, location="loc2", now=NOW)
    assert [c["session"] for c in out] == ["b"]


def test_never_shows_another_restaurants_conversation():
    assert conversations.conversation(DB(DOCS), "burger-house", "d") == []
    assert all(c["session"] != "d" for c in conversations.list_conversations(DB(DOCS), "burger-house", now=NOW))


def test_turns_read_heard_understood_said():
    turns = conversations.conversation(DB(DOCS), "burger-house", "a")
    assert len(turns) == 3
    first, unheard, placed = turns
    assert first["heard"] == "হট উইংস দিন" and first["input"] == "voice"
    assert first["understood"]["intent"] == "order"
    assert first["understood"]["actions"] == [{"op": "add", "name": "Hot Wings", "quantity": 2, "variant": "Large"}]
    assert first["understood"]["text"] is None  # nothing was cleaned up
    assert first["said"] == "হট উইংস যোগ করলাম।"
    assert unheard["unheard"] is True and unheard["flags"] == ["unclear"]
    assert placed["understood"]["orderPlaced"] is True and placed["understood"]["orderNumber"] == 17


def test_shows_the_menu_name_corrections():
    doc = turn("e", 1, "চিকেন বাগার", "Chicken Burger যোগ করলাম", text_norm="চিকেন Chicken Burger",
               norm_changes=[["বাগার", "Chicken Burger", 0.9], ["x", "x", 1.0]], engine="typed",
               meta={"fallback": True, "clearCart": True})
    v = conversations.turn_view(doc)
    assert v["understood"]["text"] == "চিকেন Chicken Burger"
    assert v["understood"]["corrections"] == [{"from": "বাগার", "to": "Chicken Burger"}]
    assert v["understood"]["actions"] == [{"op": "clear"}]
    assert v["input"] == "typed" and v["flags"] == ["model_unavailable"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
