"""
Simulated guests: an AI plays a customer (personality + goal) and talks freely with the real waiter
pipeline until it's done; a judge then scores the WHOLE conversation. Catches what scripted cases miss
(pacing, pushiness, forgetting, clumsy follow-ups).

COSTS MONEY (OpenAI): roughly 8 personas × ≤6 turns × ~2.5 calls ≈ 100–120 requests. Ask before running.

  docker exec -w /tmp/waiter qravy-ai-waiter-service-1 python evals/simulate_guests.py --menu burger-house
  docker exec -w /tmp/waiter qravy-ai-waiter-service-1 python evals/simulate_guests.py --menu dhaka_kitchen --only family,allergy
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_eval as E  # noqa: E402

MODEL = os.environ.get("SIM_MODEL", "gpt-4.1-mini")

PERSONAS: List[Dict[str, Any]] = [
    {"id": "undecided", "at": "20:00", "lang": "en",
     "who": "A tired office worker, hungry, has no idea what to eat, gives short answers.",
     "goal": "Get a good recommendation and order one main dish plus maybe a drink, then confirm."},
    {"id": "family", "at": "13:00", "lang": "en",
     "who": "A parent with two kids (6 and 9) and a partner; kids don't eat spicy food; budget about 1500 taka.",
     "goal": "Order a complete lunch for the family of four within budget, then confirm."},
    {"id": "allergy", "at": "20:00", "lang": "en",
     "who": "Severely allergic to nuts and a bit anxious about it; asks careful questions.",
     "goal": "Find a safe dinner, order it, and make sure the kitchen knows about the allergy."},
    {"id": "spice", "at": "20:00", "lang": "en",
     "who": "Loves very spicy food, gets bored by mild suggestions, a little impatient.",
     "goal": "Order the spiciest main dish available and a drink."},
    {"id": "budget-student", "at": "13:00", "lang": "en",
     "who": "A student with only 350 taka, wants to be full.",
     "goal": "Order the most filling thing within 350 taka and not be upsold beyond budget."},
    {"id": "bangla-group", "at": "20:30", "lang": "bn",
     "who": "Speaks only Bangla (Bangla script). Out with 3 friends; one friend is vegetarian.",
     "goal": "Order dinner for 4 including something vegetarian, ask the total, then confirm."},
    {"id": "changes-mind", "at": "20:00", "lang": "en",
     "who": "Indecisive: orders something, then changes the dish and the quantity once.",
     "goal": "End up with exactly what they finally want in the cart, then confirm."},
    {"id": "just-browsing", "at": "16:00", "lang": "en",
     "who": "Only wants information (prices, what's popular, VAT), says no to suggestions politely.",
     "goal": "Get answers without ordering; leave when satisfied. The waiter should not be pushy."},
]

GUEST_SYSTEM = (
    "You are role-playing a restaurant GUEST talking to the restaurant's voice waiter on your phone. Stay in character. "
    "Speak naturally and briefly like a real person (1 short sentence, sometimes 2). Pursue your goal; react to what the "
    "waiter actually says. When your goal is done (order confirmed, or you're leaving), set done=true. "
    'Reply as JSON: {"say": string, "done": boolean}.'
)

JUDGE_SYSTEM = (
    "You evaluate a restaurant's AI voice waiter from a full conversation with a guest. Score 1-5 each:\n"
    "understanding (grasped needs, remembered what the guest said), recommendations (relevant, well-timed, not pushy, "
    "respected constraints like allergy/budget/spice/kids), honesty (no invented facts, safe allergy handling), "
    "ordering (cart ended exactly as the guest wanted; no unwanted items; confirmed only when asked), "
    "conversation (natural, concise for voice, right language). Also list concrete problems.\n"
    'Return JSON: {"understanding":int,"recommendations":int,"honesty":int,"ordering":int,"conversation":int,'
    '"overall":int,"problems":[string]}'
)


async def chat(messages: List[Dict[str, str]]) -> Dict[str, Any]:
    key = os.environ.get("OPENAI_API_KEY", "")
    base = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
    async with httpx.AsyncClient(timeout=60) as c:
        for attempt in range(6):
            r = await c.post(f"{base}/v1/chat/completions", headers={"Authorization": f"Bearer {key}"}, json={
                "model": MODEL, "temperature": 0.7, "response_format": {"type": "json_object"}, "messages": messages})
            if r.status_code == 429 and attempt < 5:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            r.raise_for_status()
            return json.loads(r.json()["choices"][0]["message"]["content"])
    raise RuntimeError("simulator unreachable")


async def run_persona(srv, p: Dict[str, Any], tenant: str, menu_text: str, by_id, by_name, max_turns: int) -> Dict[str, Any]:
    tz = srv.fetch_restaurant_profile(tenant).get("tz") or "Asia/Dhaka"
    h, m = map(int, p["at"].split(":"))
    now = datetime(2026, 9, 28, h, m, tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)
    session = f"sim-{p['id']}-{uuid.uuid4().hex[:6]}"
    cart: Dict[str, int] = {}
    convo: List[Dict[str, str]] = []
    confirmed = False
    guest_msgs = [{"role": "system", "content": GUEST_SYSTEM + f"\nYou: {p['who']}\nYour goal: {p['goal']}\n"
                   + ("Speak Bangla (Bangla script)." if p["lang"] == "bn" else "Speak English.")}]
    for _ in range(max_turns):
        g = await chat(guest_msgs + [{"role": "user", "content": json.dumps({"conversationSoFar": convo}, ensure_ascii=False)}])
        say = str(g.get("say") or "").strip()
        if not say:
            break
        convo.append({"role": "guest", "text": say})
        reply = await srv.run_text_turn(text=say, tenant=tenant, branch=None, channel="dine-in", session_id=session,
                                        user_id="sim", locale=p["lang"],
                                        cart_items=[{"itemId": i, "quantity": q} for i, q in cart.items()], now=now)
        convo.append({"role": "waiter", "text": reply["replyText"]})
        if E.apply_ui(reply.get("meta") or {}, cart, by_id, by_name):
            confirmed = True
            break
        if g.get("done"):
            break
    final_cart = E.cart_str(cart, by_id)
    verdict = await chat([
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": json.dumps({"menu": menu_text, "guest": p["who"], "guestGoal": p["goal"],
                                                "time": p["at"], "conversation": convo, "finalCart": final_cart,
                                                "orderConfirmed": confirmed}, ensure_ascii=False)},
    ])
    return {"persona": p["id"], "conversation": convo, "cart": final_cart, "confirmed": confirmed, "verdict": verdict}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--menu", default="burger-house")
    ap.add_argument("--only", default="")
    ap.add_argument("--max-turns", type=int, default=6)
    args = ap.parse_args()

    srv = E.load_server(os.path.dirname(HERE))
    tenant = "burger-house"
    if args.menu != "burger-house":
        E.install_fixture(srv, os.path.join(HERE, "fixtures", f"{args.menu}.json"))
        tenant = f"fixture:{args.menu}"
    snap = srv.fetch_menu_snapshot(tenant, limit=srv.MENU_SNAPSHOT_MAX, channel="dine-in")
    items = snap["items"]
    by_id = {str(i["id"]): i for i in items}
    by_name = {str(i["name"]).strip().lower(): str(i["id"]) for i in items}
    menu_text = "\n".join(
        f"{i.get('category')} | {i['name']} | ৳{i.get('price')} | {i.get('description') or ''}"
        + (" | sizes: " + ", ".join(f"{v['name']} ৳{v.get('price')}" for v in i.get("variations") or []) if i.get("variations") else "")
        + (" | choices: " + "; ".join(", ".join(o["name"] for o in g.get("options") or []) for g in i.get("modifierGroups") or [])
           if i.get("modifierGroups") else "")
        for i in items
    )

    only = {x.strip() for x in args.only.split(",") if x.strip()}
    results = []
    for p in [p for p in PERSONAS if not only or p["id"] in only]:  # sequential: gentle on rate limits
        results.append(await run_persona(srv, p, tenant, menu_text, by_id, by_name, args.max_turns))

    for r in results:
        v = r["verdict"]
        print(f"\n=== {r['persona']}  overall {v.get('overall')}/5  (understanding {v.get('understanding')}, "
              f"recommendations {v.get('recommendations')}, honesty {v.get('honesty')}, ordering {v.get('ordering')}, "
              f"conversation {v.get('conversation')})  cart: {r['cart']}  confirmed: {r['confirmed']}")
        for m in r["conversation"]:
            print(f"   {m['role']:>6}: {m['text']}")
        for prob in v.get("problems") or []:
            print(f"   ✗ {prob}")
    scores = [r["verdict"].get("overall") for r in results if isinstance(r["verdict"].get("overall"), int)]
    print(f"\nSIMULATED GUESTS: {len(results)}  average overall: {sum(scores) / max(1, len(scores)):.2f}/5")
    with open(os.path.join(HERE, f"sim-{args.menu}.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    asyncio.run(main())
