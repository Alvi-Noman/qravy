"""
Virtual-waiter conversation eval.

Runs every case in cases.py through the real text pipeline (menu snapshot → brain → meta)
against the live tenant menu, replays the UI's cart handling (same rules as
apps/tastebud/src/utils/voice-cart.ts + the order-intent fallback), then scores each
final reply with structural checks + an LLM judge.

Run inside the ai-waiter container (needs Mongo + OPENAI_API_KEY):

  docker cp services/ai-waiter-service/. qravy-ai-waiter-service-1:/tmp/waiter
  docker exec -w /tmp/waiter qravy-ai-waiter-service-1 python evals/run_eval.py --tenant burger-house

Flags: --code DIR (pipeline to test, default: parent dir), --only id1,id2, --label NAME,
       --no-judge, --concurrency N
"""
from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
import re
import sys
import types
import uuid
import contextvars
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cases import CASES, Case  # noqa: E402

CASE_OPENING: contextvars.ContextVar = contextvars.ContextVar("case_opening", default=None)
CASE_SIGNATURE: contextvars.ContextVar = contextvars.ContextVar("case_signature", default=None)

_BN = re.compile(r"[অ-হ়-ৌৎড়-য়]")  # Bangla letters, not ৳ or digits
_LATIN_WORD = re.compile(r"[A-Za-z]{3,}")


# ------------------------------------------------------------------ pipeline loading


def load_server(code_dir: str):
    """Import server.py without loading Whisper (STT isn't part of this eval)."""
    fw = types.ModuleType("faster_whisper")
    fw.WhisperModel = lambda *a, **k: None  # type: ignore[attr-defined]
    sys.modules["faster_whisper"] = fw
    stt = types.ModuleType("stt")
    stt.stt_np_float32 = lambda *a, **k: ("", [], None)  # type: ignore[attr-defined]
    sys.modules["stt"] = stt
    sys.path.insert(0, code_dir)
    return importlib.import_module("server")


async def turn_baseline(srv, *, text: str, tenant: str, session: str, locale: str, cart: Dict[str, int]):
    """The pre-overhaul server flow, reproduced step by step from handle_conn."""
    snapshot = srv.fetch_menu_snapshot(tenant, limit=srv.MENU_SNAPSHOT_MAX, channel="dine-in", lang=locale)
    vocab = srv.build_vocab_from_snapshot(snapshot)
    norm_text, _ = srv.normalize_text(text, vocab=vocab, fuzzy_threshold=srv.FUZZY_THRESHOLD)
    srv.push_user(tenant, session, norm_text)

    matches = srv._match_in_snapshot(norm_text, snapshot)
    if not matches:
        matches = srv._db_fallback_search(tenant, norm_text, limit=10)
    if matches:
        reply_text = srv._compose_availability_reply(matches, locale)
        meta = {
            "model": "deterministic",
            "intent": "order",
            "items": [{"name": m.get("name"), "itemId": m.get("id"), "price": m.get("price")} for m in matches[:5]],
        }
        srv.push_assistant(tenant, session, reply_text)
        srv.update_state(tenant, session, meta=meta, user_text=norm_text)
        return {"replyText": reply_text, "meta": meta}

    history = srv.get_history(tenant, session)
    state = srv.get_state(tenant, session)
    ctx = srv.build_runtime_context(tenant=tenant, branch=None, channel="dine-in", lang_hint=locale, dialog_state=state)
    ctx["cartItems"] = [{"itemId": iid, "quantity": q} for iid, q in cart.items() if q > 0]
    unavailable = [
        {"name": i.get("name"), "reason": i.get("unavailableReason")}
        for i in snapshot.get("items", [])
        if i.get("available") is False and i.get("unavailableReason")
    ]
    if unavailable:
        ctx["unavailableNow"] = unavailable[:40]
    orderable = {**snapshot, "items": [i for i in snapshot.get("items", []) if i.get("available") is not False]}
    reply = await srv.generate_reply(
        transcript=norm_text,
        tenant=tenant,
        channel="dine-in",
        locale=locale,
        menu_snapshot=orderable,
        conversation_id=session,
        user_id="eval",
        history=history,
        dialog_state=state,
        context=ctx,
        suggestion_candidates=srv.build_suggestion_candidates(snapshot, ctx, limit=40),
        upsell_candidates=srv.build_upsell_candidates(snapshot, ctx, state, limit=16),
    )
    srv.push_assistant(tenant, session, reply.get("replyText") or "")
    srv.update_state(tenant, session, meta=reply.get("meta"), user_text=norm_text)
    return reply


PLACED: List[Dict[str, Any]] = []  # orders the waiter would have placed (never sent anywhere)


async def fake_place_order(*, tenant, branch, session_id, draft):
    PLACED.append({"session": session_id, **draft})
    total = draft.get("expectedTotal") or 0
    return {"ok": True, "order": {"token": "eval" * 6, "orderNumber": len(PLACED), "status": "placed",
                                  "total": total, "table": draft.get("table")}}


async def turn_current(srv, *, text: str, tenant: str, session: str, locale: str, cart: Dict[str, int], now=None):
    if not hasattr(srv, "run_text_turn"):
        return await turn_baseline(srv, text=text, tenant=tenant, session=session, locale=locale, cart=cart)
    import inspect

    extra = {}
    if "place_order" in inspect.signature(srv.run_text_turn).parameters:
        # guests scan the table QR (?table=E1); orders go to a fake placer, never to auth-service
        extra = {"table": "E1", "place_order": fake_place_order}
    return await srv.run_text_turn(
        text=text,
        tenant=tenant,
        branch=None,
        channel="dine-in",
        session_id=session,
        user_id="eval",
        locale=locale,
        cart_items=[{"itemId": iid, "quantity": q} for iid, q in cart.items() if q > 0],
        now=now,
        **extra,
    )


def install_fixture(srv, path: str) -> Dict[str, Any]:
    """Serve a JSON restaurant (menu, hours, house facts, past orders) instead of the database, through the
    same availability rules the live service uses — so a second, very different menu can be tested."""
    from availability import DEFAULT_PERIODS, unavailable_reason

    with open(path, encoding="utf-8") as f:
        fx = json.load(f)
    r = fx["restaurant"]

    def snapshot(tenant=None, limit=None, branch=None, channel=None, lang=None, now=None):
        rules = {
            "tz": r.get("tz") or "Asia/Dhaka",
            "opening": r.get("opening") or [],
            "categories": {},
            "sold_out": {i["id"] for i in fx["items"] if i.get("soldOut")},
            "periods": DEFAULT_PERIODS,
        }
        items = []
        for raw in fx["items"]:
            it = {
                "status": "active", "hidden": False, "visibility": {"dineIn": True, "online": True}, "available": True,
                "aliases": [], "tags": [], "variations": [], "modifierGroups": [], "availability": [],
                "categoryId": raw.get("category"), **raw,
            }
            op = CASE_OPENING.get()
            case_rules = {**rules, "opening": op} if op is not None else rules
            reason = unavailable_reason(it, case_rules, now=now, lang=lang or "en")
            if reason:
                it["available"], it["unavailableReason"] = False, reason
            items.append(it)
        return {"tenant_id": tenant, "categories": [], "items": items}

    def profile(tenant=None, branch=None):
        opening = r.get("opening") or []
        return {
            "name": r.get("name"), "type": r.get("type"), "address": r.get("address"), "phone": r.get("phone"),
            "dineIn": r.get("dineIn", True), "online": r.get("online", False),
            "menuNotes": r.get("menuNotes") or [], "knowledge": r.get("knowledge") or [],
            "tz": r.get("tz") or "Asia/Dhaka", "opening": opening, "hours": srv.format_windows(opening),
            "periods": DEFAULT_PERIODS, "staffAlerts": False,
        }

    stats = srv.OrderStats.from_orders(fx.get("orders") or [])
    srv.fetch_menu_snapshot = snapshot
    srv.fetch_restaurant_profile = profile
    srv.order_stats = lambda tenant=None: {"popularity": stats.popularity, "pairs": stats.pairs}
    srv.load_cart = lambda *a, **k: []
    return fx


# ------------------------------------------------------------------ UI cart replay


def apply_ui(meta: Dict[str, Any], cart: Dict[str, int], by_id: Dict[str, Dict], by_name: Dict[str, str]) -> bool:
    """Mirror of the storefront: cartOps/clearCart first, else order-intent items fallback.
    Returns True when the UI would open the order confirmation page."""
    decision = meta.get("decision") or {}
    if decision.get("openConfirmationPage"):
        return True

    def resolve(op) -> Optional[str]:
        iid = str(op.get("itemId") or "")
        if iid in by_id:
            return iid
        return by_name.get(str(op.get("name") or op.get("title") or "").strip().lower())

    ops = meta.get("cartOps") or []
    if meta.get("clearCart"):
        cart.clear()
    if ops:
        for op in ops:
            kind = str(op.get("op") or op.get("type") or "").lower()
            iid = resolve(op)
            if not iid:
                continue
            if kind == "add":
                cart[iid] = cart.get(iid, 0) + max(1, int(op.get("quantity") or 1))
            elif kind == "set":
                q = int(op.get("quantity") or 0)
                if q > 0:
                    cart[iid] = q
                else:
                    cart.pop(iid, None)
            elif kind in ("delta", "inc", "dec"):
                q = cart.get(iid, 0) + int(op.get("delta") or 0)
                if q > 0:
                    cart[iid] = q
                else:
                    cart.pop(iid, None)
            elif kind == "remove":
                # a line-targeted remove takes that line's quantity; this replay keeps one count per dish
                cart.pop(iid, None)
            elif kind == "restore":  # undo: the line comes back as it was
                q = int((op.get("line") or {}).get("quantity") or 1)
                cart[iid] = cart.get(iid, 0) + q
            # "edit" changes a line's size / choices / note — not the count
    elif str(meta.get("intent") or "").lower() == "order" and not meta.get("clearCart"):
        for it in meta.get("items") or []:
            iid = resolve(it)
            if iid:
                cart[iid] = cart.get(iid, 0) + max(1, int(it.get("quantity") or 1))
    return False


# ------------------------------------------------------------------ judge

JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4.1-mini")  # cheap by default; set gpt-4.1 for a stricter judge


async def judge(case: Case, transcript: List[Dict[str, str]], cart_before: str, cart_after: str, now_txt: str,
                menu_text: str, restaurant: str, confirmed: bool) -> Dict[str, Any]:
    key = os.environ.get("OPENAI_API_KEY", "")
    base = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
    system = (
        "You grade a restaurant's virtual waiter (voice). Judge ONLY the final waiter reply, in context.\n"
        "Score 1-5:\n"
        "5 = what an excellent, honest, knowledgeable human waiter would say: answers the actual question, "
        "correct facts from the menu, correct cart action, natural and concise for voice, right language.\n"
        "4 = good, minor issues (slightly long, small missed opportunity).\n"
        "3 = partially answers or awkward/robotic, but no harmful error.\n"
        "2 = mostly fails the question, or wrong action on the cart.\n"
        "1 = wrong/invented facts (prices, ingredients, allergens, policies), harmful allergy advice, or nonsense.\n"
        "System capabilities: the waiter CAN add kitchen notes (e.g. 'make it mild') to items in the cart and CAN "
        "record add-on choices; it CANNOT page staff or see kitchen status.\n"
        "General food knowledge framed as typical is fine; presenting guesses as facts about THIS restaurant "
        "(certifications, allergen safety, passwords, policies not listed) is not.\n"
        'Return JSON: {"score": int, "reason": "one sentence"}'
    )
    user = json.dumps(
        {
            "restaurant": restaurant,
            "menu": menu_text,
            "restaurantTimeNow": now_txt,
            "cartBefore": cart_before,
            "conversation": transcript,
            "cartAfterFinalTurn": cart_after,
            "orderConfirmed": confirmed,
            "whatAGreatWaiterDoes": case.judge,
        },
        ensure_ascii=False,
    )
    async with httpx.AsyncClient(timeout=60) as client:
        for attempt in range(10):
            r = await client.post(
                f"{base}/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": JUDGE_MODEL,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                },
            )
            if r.status_code == 429 and attempt < 9:
                await asyncio.sleep(float(r.headers.get("retry-after") or 2 * (attempt + 1)))
                continue
            r.raise_for_status()
            return json.loads(r.json()["choices"][0]["message"]["content"])
    raise RuntimeError("judge unreachable")


# ------------------------------------------------------------------ runner


def cart_str(cart: Dict[str, int], by_id) -> str:
    return ", ".join(f"{q} × {by_id[i]['name']}" for i, q in cart.items()) or "(empty)"


async def run_case(srv, case: Case, tenant: str, by_id, by_name, menu_text, restaurant, use_judge: bool) -> Dict[str, Any]:
    session = f"eval-{case.id}-{uuid.uuid4().hex[:6]}"
    CASE_OPENING.set(case.opening)  # task-local: only this case sees the simulated hours
    CASE_SIGNATURE.set(case.signature)
    profile = srv.fetch_restaurant_profile(tenant)
    tz = profile.get("tz") or "Asia/Dhaka"
    now = None
    if case.at:
        h, m = (int(x) for x in case.at.split(":"))
        now = datetime(2026, 9, 28, h, m, tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)  # a Monday
    label, _ = srv.current_meal_period(profile.get("periods") or [], tz, now)
    now_txt = f"{srv.local_now(tz, now).strftime('%a %H:%M')} — meal period: {label}" + (
        f" — opening hours {srv.format_windows(case.opening)}" if case.opening else ""
    )
    cart: Dict[str, int] = {}
    for name, q in case.cart.items():
        iid = by_name[name.lower()]
        cart[iid] = q
    start = dict(cart)
    cart_before_txt = cart_str(cart, by_id)
    convo: List[Dict[str, str]] = []
    if case.cart:
        # the guest already has items → the waiter's last line was an "anything else?"
        srv.push_assistant(tenant, session, "Anything else I can get for you?")
        convo.append({"role": "waiter", "text": "Anything else I can get for you?"})

    confirmed = False
    reply: Dict[str, Any] = {}
    fails: List[str] = []
    for text in case.turns:
        convo.append({"role": "guest", "text": text})
        try:
            reply = await turn_current(srv, text=text, tenant=tenant, session=session, locale=case.locale, cart=cart, now=now)
        except Exception as e:  # pipeline crash = fail
            fails.append(f"crash: {e!r}")
            break
        convo.append({"role": "waiter", "text": reply.get("replyText") or ""})
        if apply_ui(reply.get("meta") or {}, cart, by_id, by_name):
            confirmed = True

    meta = reply.get("meta") or {}
    text = (reply.get("replyText") or "").strip()
    low = text.lower()

    if not text:
        fails.append("empty reply")
    if case.intent and str(meta.get("intent")) not in case.intent:
        fails.append(f"intent={meta.get('intent')} (want {case.intent})")
    if case.cart_same and cart != start:
        fails.append(f"cart changed → {cart_str(cart, by_id)}")
    if case.cart_after is not None:
        want = {by_name[n.lower()]: q for n, q in case.cart_after.items()}
        if cart != want:
            fails.append(f"cart={cart_str(cart, by_id)} (want {cart_str(want, by_id)})")
    if case.no_cats:
        from waiter_knowledge import MenuIndex, find_mentions

        idx = MenuIndex(list(by_id.values()))
        named = [s.get("itemId") for s in meta.get("suggestions") or []]
        named += [idx.item_id(it) for it in find_mentions(text, idx, limit=8)]
        bad = sorted({by_id[i]["name"] for i in named if i in by_id and by_id[i].get("category") in case.no_cats})
        if bad:
            fails.append(f"recommended unsuitable-now dishes: {bad}")
    if case.cart_cats is not None:
        got: Dict[str, int] = {}
        for iid, q in cart.items():
            cat = str(by_id[iid].get("category"))
            got[cat] = got.get(cat, 0) + q
        if got != case.cart_cats:
            fails.append(f"cart categories={got} (want {case.cart_cats})")
    if case.confirmed is not None and confirmed != case.confirmed:
        fails.append(f"confirmed={confirmed} (want {case.confirmed})")
    if case.say_any and not any(s.lower() in low for s in case.say_any):
        fails.append(f"reply lacks any of {case.say_any}")
    for s in case.say_not:
        if s.lower() in low:
            fails.append(f"reply contains '{s}'")
    if case.lang == "bn" and not _BN.search(text):
        fails.append("reply not in Bangla")
    if case.lang == "en" and _BN.search(text):
        fails.append("reply not in English")

    verdict: Dict[str, Any] = {}
    if use_judge and text:
        try:
            verdict = await judge(case, convo, cart_before_txt, cart_str(cart, by_id), now_txt, menu_text, restaurant, confirmed)
        except Exception as e:
            verdict = {"score": 0, "reason": f"judge error {e!r}"}
        if int(verdict.get("score") or 0) < 4:
            fails.append(f"judge {verdict.get('score')}: {verdict.get('reason')}")

    return {
        "id": case.id,
        "group": case.group,
        "pass": not fails,
        "fails": fails,
        "score": verdict.get("score"),
        "judge": verdict.get("reason"),
        "intent": meta.get("intent"),
        "conversation": convo,
        "cart": cart_str(cart, by_id),
        "confirmed": confirmed,
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="burger-house")
    ap.add_argument("--menu", default="burger-house", help="burger-house (live DB) or a fixture name in evals/fixtures")
    ap.add_argument("--code", default=os.path.dirname(HERE))
    ap.add_argument("--only", default="")
    ap.add_argument("--group", default="")
    ap.add_argument("--label", default="run")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    srv = load_server(os.path.abspath(args.code))
    fixture = None
    if args.menu != "burger-house" or args.tenant != "burger-house":
        path = os.path.join(HERE, "fixtures", f"{args.menu}.json")
        if os.path.exists(path):
            fixture = install_fixture(srv, path)
            args.tenant = f"fixture:{args.menu}"

    # per-case simulated opening hours (e.g. "closed until 11am"), without touching the database
    orig_rules, orig_profile = srv.load_rules, srv.fetch_restaurant_profile

    def rules_for_case(*a, **k):
        r = orig_rules(*a, **k)
        op = CASE_OPENING.get()
        return {**r, "opening": op} if op is not None else r

    def profile_for_case(*a, **k):
        p = orig_profile(*a, **k)
        op = CASE_OPENING.get()
        return {**p, "opening": op, "hours": srv.format_windows(op)} if op is not None else p

    srv.load_rules, srv.fetch_restaurant_profile = rules_for_case, profile_for_case

    # per-case simulated signature stars
    orig_snapshot = srv.fetch_menu_snapshot

    def snapshot_for_case(*a, **k):
        snap = orig_snapshot(*a, **k)
        stars = {s.lower() for s in CASE_SIGNATURE.get() or []}
        if stars:
            snap = {**snap, "items": [{**i, "signature": str(i.get("name")).lower() in stars} for i in snap.get("items", [])]}
        return snap

    srv.fetch_menu_snapshot = snapshot_for_case
    snapshot = srv.fetch_menu_snapshot(args.tenant, limit=srv.MENU_SNAPSHOT_MAX, channel="dine-in")
    items = snapshot.get("items") or []
    if not items:
        sys.exit(f"no menu items for tenant {args.tenant!r}")
    by_id = {str(i["id"]): i for i in items}
    by_name = {str(i["name"]).strip().lower(): str(i["id"]) for i in items}

    menu_text = "\n".join(
        f"{i.get('category')} | {i['name']} | ৳{i.get('price')} | tags={i.get('tags') or []}"
        + (f" | NOT ORDERABLE NOW: {i.get('unavailableReason')}" if i.get("available") is False else "")
        + (f" | {i['description']}" if i.get("description") else "")
        + (" | sizes: " + ", ".join(f"{v['name']} ৳{v.get('price')}" for v in i.get("variations") or []) if i.get("variations") else "")
        + (" | SIGNATURE" if i.get("signature") else "")
        + (
            " | choices: " + "; ".join(
                f"{g.get('name')}: " + ", ".join(o.get("name") for o in g.get("options") or [])
                for g in i.get("modifierGroups") or []
            )
            if i.get("modifierGroups") else ""
        )
        for i in items
    )
    if fixture:
        r = fixture["restaurant"]
        restaurant = json.dumps(
            {"name": r.get("name"), "type": r.get("type"), "address": r.get("address"), "menuNotes": r.get("menuNotes"),
             "houseInfo": r.get("knowledge"), "openingHours": srv.format_windows(r.get("opening") or []),
             "staffAlerts": "not available"},
            ensure_ascii=False,
        )
    else:
        tdoc = srv._CLIENT[srv.MENU_DB_NAME]["tenants"].find_one({"_id": srv.resolve_tenant_id(args.tenant)}) or {}
        restaurant = json.dumps(
            {
                "name": tdoc.get("name"),
                "info": tdoc.get("restaurantInfo"),
                "menuNotes": tdoc.get("menuNotes"),
                "openingHours": tdoc.get("openingHours") or "not set",
                "staffAlerts": "not available (the system cannot page staff unless STAFF_ALERTS_ENABLED=1)",
            },
            ensure_ascii=False,
            default=str,
        )

    only = {x.strip() for x in args.only.split(",") if x.strip()}
    groups_wanted = {g.strip() for g in args.group.split(",") if g.strip()}
    cases = [
        c for c in CASES
        if c.menu == args.menu and (not only or c.id in only) and (not groups_wanted or c.group in groups_wanted)
    ]
    sem = asyncio.Semaphore(max(1, args.concurrency))

    async def guarded(c):
        async with sem:
            return await run_case(srv, c, args.tenant, by_id, by_name, menu_text, restaurant, not args.no_judge)

    results = await asyncio.gather(*(guarded(c) for c in cases))

    groups: Dict[str, List[bool]] = {}
    for r in results:
        groups.setdefault(r["group"], []).append(r["pass"])
        mark = "PASS" if r["pass"] else "FAIL"
        print(f"\n[{mark}] {r['id']}  (judge={r['score']}, intent={r['intent']}, cart={r['cart']}, confirmed={r['confirmed']})")
        for m in r["conversation"]:
            print(f"   {m['role']:>6}: {m['text']}")
        for f in r["fails"]:
            print(f"   ✗ {f}")

    total = sum(r["pass"] for r in results)
    scores = [r["score"] for r in results if isinstance(r["score"], int)]
    print("\n==================== SUMMARY:", args.label)
    for g, v in groups.items():
        print(f"  {g:<10} {sum(v)}/{len(v)}")
    print(f"  TOTAL      {total}/{len(results)}   avg judge score: {sum(scores) / max(1, len(scores)):.2f}")
    out = os.path.join(HERE, f"results-{args.label}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("  saved", out)


if __name__ == "__main__":
    asyncio.run(main())
