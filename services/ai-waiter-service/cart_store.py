# services/ai-waiter-service/cart_store.py
from pymongo import MongoClient
import os, time

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
client = MongoClient(MONGO_URI)
db = client["qravy"]
carts = db["carts"]

def save_cart(tenant: str, session_id: str, items: list):
    carts.update_one(
        {"tenant": tenant, "sessionId": session_id},
        {"$set": {"items": items, "updatedAt": time.time()}},
        upsert=True
    )

def load_cart(tenant: str, session_id: str):
    doc = carts.find_one({"tenant": tenant, "sessionId": session_id})
    return doc.get("items", []) if doc else []
