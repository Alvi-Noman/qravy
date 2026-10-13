# services/ai-waiter-service/cart_store.py
from pymongo import MongoClient
import os, time

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
client = MongoClient(MONGO_URI)
db = client["qravy"]
carts = db["carts"]

# one tray per restaurant, branch and guest — a Gulshan tray never comes back at Banani (no branch → None, which
# also matches trays saved before branches were part of the key)
def save_cart(tenant: str, session_id: str, items: list, branch: str | None = None):
    carts.update_one(
        {"tenant": tenant, "sessionId": session_id, "branch": branch or None},
        {"$set": {"items": items, "updatedAt": time.time()}},
        upsert=True
    )

# same short life as the browser copy (CartContext CART_TTL_MS) — an old tray must not come back
CART_TTL_S = 10 * 60

def load_cart(tenant: str, session_id: str, branch: str | None = None):
    doc = carts.find_one({"tenant": tenant, "sessionId": session_id, "branch": branch or None})
    if not doc:
        return []
    if time.time() - (doc.get("updatedAt") or 0) > CART_TTL_S:
        return []
    return doc.get("items", [])
