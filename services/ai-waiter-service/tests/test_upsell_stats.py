"""H: offers, their outcomes and the conversations' order value → the restaurant's upsell numbers, per A/B arm."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import upsell_stats  # noqa: E402


class Coll:
    """Just enough of a Mongo collection for upsell_stats."""

    def __init__(self):
        self.docs = {}

    def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)

    def update_one(self, flt, upd, upsert=False):
        doc = self.docs.get(flt["_id"])
        if doc is None:
            if not upsert:
                return
            doc = self.docs[flt["_id"]] = {"_id": flt["_id"], **upd.get("$setOnInsert", {})}
        if any(doc.get(k) != v for k, v in flt.items() if k != "_id"):
            return
        doc.update(upd.get("$set", {}))
        for k, v in upd.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v

    def find(self, flt):
        def ok(d):
            for k, v in flt.items():
                if isinstance(v, dict) and "$gte" in v:
                    if float(d.get(k) or 0) < v["$gte"]:
                        return False
                elif d.get(k) != v:
                    return False
            return True
        return [d for d in self.docs.values() if ok(d)]


class DB:
    def __init__(self):
        self.upsell_offers, self.upsell_sessions = Coll(), Coll()


A = {"wording": "reason", "timing": "early"}
B = {"wording": "short", "timing": "late"}


def offer(oid, arm, typ="drink", value=160):
    return {"id": oid, "type": typ, "moment": "first_add", "arm": arm, "item_ids": ["mint"], "value": value}


def test_take_rate_revenue_order_value_and_arms():
    db, t0 = DB(), 1_000_000.0
    rec = lambda s, meta, at: upsell_stats.record(db, tenant="bh", branch=None, session=s, meta=meta, now=at)  # noqa: E731
    # s1 (arm A): offered a drink, said yes → ৳160, ordered ৳1200
    rec("s1", {"upsellArm": A, "upsellOffer": offer("o1", A), "traySubtotal": 1040}, t0)
    rec("s1", {"upsellArm": A, "upsellOutcome": {"offerId": "o1", "outcome": "accepted", "value": 160}, "traySubtotal": 1200}, t0 + 30)
    # s2 (arm A): offered a dessert at the end, said no, ordered ৳700
    rec("s2", {"upsellArm": A, "upsellOffer": offer("o2", A, "dessert", 220), "traySubtotal": 700}, t0)
    rec("s2", {"upsellArm": A, "upsellOutcome": {"offerId": "o2", "outcome": "declined", "value": 0}, "traySubtotal": 700}, t0 + 20)
    # s3 (arm B): offered, then nothing more — the conversation ended on the offer
    rec("s3", {"upsellArm": B, "upsellOffer": offer("o3", B), "traySubtotal": 500}, t0)
    # s4 (arm B): never offered anything
    rec("s4", {"upsellArm": B, "traySubtotal": 300}, t0)

    s = upsell_stats.stats(db, "bh", days=7, now=t0 + 3600)
    assert (s["offers"], s["accepted"], s["declined"], s["pending"]) == (3, 1, 1, 1), s
    assert s["takeRate"] == 0.5 and s["revenue"] == 160
    assert s["aovWithAccepted"] == 1200 and s["aovWithout"] == round((700 + 500 + 300) / 3, 2) and s["aovLift"] == 700
    assert s["sessionsWithOffer"] == 3 and s["endedAfterOfferRate"] == round(1 / 3, 3)
    assert s["byType"]["drink"]["accepted"] == 1 and s["byType"]["dessert"]["takeRate"] == 0.0
    assert s["byArm"]["reason · early"]["takeRate"] == 0.5 and s["byArm"]["short · late"]["sessions"] == 2
    # another restaurant sees nothing of it; an old offer falls out of the window
    assert upsell_stats.stats(db, "other", now=t0)["offers"] == 0
    assert upsell_stats.stats(db, "bh", days=1, now=t0 + 3 * 86400)["offers"] == 0
