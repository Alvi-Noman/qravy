import asyncio, json, os, time, re, io, wave
from datetime import datetime
from zoneinfo import ZoneInfo  # ✅ stdlib tz support
import numpy as np
import websockets
from websockets.server import WebSocketServerProtocol
from faster_whisper import WhisperModel
from pymongo import MongoClient
from vad import Segmenter
import httpx
from typing import Dict, Any, List, Tuple, Optional, Deque
from bson import ObjectId  # ✅
from collections import defaultdict, deque
from aiohttp import web  # ✅ HTTP server for cart API

# ✅ rolling context/state helpers (same folder)
from session_ctx import (
    get_history,
    push_user,
    push_assistant,
    get_state,
    update_state,
)

# ✅ In-process brain (OpenAI) call
from brain import generate_reply

# ✅ Normalizer (exact pairs + phonetic + fuzzy)
from normalizer import normalize_text

# ✅ Local speech-to-text (PCM → text)
from stt import stt_np_float32

# ✅ Cart persistence helper
from cart_store import save_cart, load_cart

# ---------- Config ----------

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")

# transcripts DB (stays in qravy)
TRANS_DB_NAME = os.environ.get("MONGO_DB", "qravy")

# menu DB (can be different, e.g., authDB)
MENU_DB_NAME = os.environ.get("MENU_DB", TRANS_DB_NAME)
MENU_COLL = os.environ.get("MENU_COLLECTION", "menu_items")

# Session context (kept for compatibility; actual logic in session_ctx)
MAX_TURNS = int(os.environ.get("SESSION_CTX_TURNS", "8"))
SESSION_CTX: Dict[Tuple[str, str], Deque[Dict[str, str]]] = defaultdict(
    lambda: deque(maxlen=MAX_TURNS)
)


def session_key(tenant: Optional[str], sid: Optional[str]) -> Tuple[str, str]:
    return ((tenant or "unknown").strip(), (sid or "anon").strip())


_CLIENT = MongoClient(MONGO_URI)

# transcripts DB handle
DB = _CLIENT[TRANS_DB_NAME]
COLL = DB.transcripts

# menu collection handle
ITEMS = _CLIENT[MENU_DB_NAME][MENU_COLL]

# Weather API (tiny helper; safe no-op on failure)
WEATHER_API_BASE = os.environ.get(
    "WEATHER_API_BASE", "https://api.open-meteo.com/v1/forecast"
)

# Early health check with retries
def ping_mongo_with_retries(client, attempts=6, delay_s=5):
    for i in range(1, attempts + 1):
        try:
            client.admin.command("ping")
            print("[ai-waiter-service] ✅ Mongo ping OK")
            return True
        except Exception as e:
            print(f"[ai-waiter-service] ⚠️ Mongo ping attempt {i}/{attempts} failed: {e}")
            if i < attempts:
                time.sleep(delay_s)
    print("[ai-waiter-service] ❌ Mongo ping FAILED after retries")
    return False


ping_mongo_with_retries(DB.client)

# TTL (30 days) so transcripts auto-expire
try:
    COLL.create_index("ts", expireAfterSeconds=30 * 24 * 3600, name="ttl_30d")
except Exception as e:
    print("[ai-waiter-service] TTL index create failed:", str(e))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANG = os.environ.get("WHISPER_LANG", "bn")

# Groq (final transcription)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3")
GROQ_BASE = os.environ.get("GROQ_BASE", "https://api.groq.com")
GROQ_TIMEOUT_MS = int(os.environ.get("GROQ_TIMEOUT_MS", "3000"))  # 3s

# Silence → finalize threshold (ms)
IDLE_FINALIZE_MS = int(os.environ.get("IDLE_FINALIZE_MS", "1200"))

# Normalizer knobs
FUZZY_THRESHOLD = float(os.environ.get("NORMALIZER_FUZZY_THRESHOLD", "0.83"))
MENU_SNAPSHOT_MAX = int(os.environ.get("MENU_SNAPSHOT_MAX", "120"))  # max items sent to brain per turn
VOCAB_MAX = int(os.environ.get("NORMALIZER_VOCAB_MAX", "200"))
INCLUDE_ALIASES = os.environ.get("NORMALIZER_INCLUDE_ALIASES", "1") == "1"

# Reduce thread thrash on CPU
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

# Load model once (warm)
print(f"[ai-waiter-service] Loading Faster-Whisper model={WHISPER_MODEL} device={DEVICE} compute={COMPUTE_TYPE}")
model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)

# Background DB writer (batch)
writer_q: asyncio.Queue = asyncio.Queue()


async def writer():
    """
    Batched writer with size/age-based flush.
    """
    import time as _time

    FLUSH_N = int(os.environ.get("TRANSCRIPT_FLUSH_N", "1"))
    FLUSH_MS = int(os.environ.get("TRANSCRIPT_FLUSH_MS", "1500"))

    buf = []
    last_flush = _time.monotonic()

    async def do_flush():
        nonlocal buf, last_flush
        if not buf:
            return
        try:
            COLL.insert_many(buf, ordered=False)
            print(f"[ai-waiter-service] inserted batch={len(buf)}")
        except Exception as e:
            print("[ai-waiter-service] insert_many error:", str(e))
        buf.clear()
        last_flush = _time.monotonic()

    while True:
        try:
            item = await asyncio.wait_for(writer_q.get(), timeout=FLUSH_MS / 1000)
        except asyncio.TimeoutError:
            if (_time.monotonic() - last_flush) * 1000 >= FLUSH_MS:
                await do_flush()
            continue

        if item is None:
            await do_flush()
            print("[ai-waiter-service] writer shutdown complete")
            break

        buf.append(item)
        if len(buf) >= FLUSH_N or (_time.monotonic() - last_flush) * 1000 >= FLUSH_MS:
            await do_flush()


WRITER_TASK = None

# ---------- NEW: Minimal HTTP API for cart persistence ----------

def _cart_cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


async def handle_cart_load(request: web.Request) -> web.StreamResponse:
    try:
        tenant = request.query.get("tenant") or "unknown"
        sid = (
            request.query.get("sessionId")
            or request.query.get("sid")
            or "anon"
        )
        items = load_cart(tenant, sid)
        return web.json_response(
            {"ok": True, "items": items},
            headers=_cart_cors_headers(),
        )
    except Exception as e:
        print("[ai-waiter-service] ❌ cart_load error:", e)
        return web.json_response(
            {"ok": False, "error": str(e)},
            status=500,
            headers=_cart_cors_headers(),
        )


async def handle_cart_save(request: web.Request) -> web.StreamResponse:
    try:
        data = await request.json()
        tenant = data.get("tenant") or "unknown"
        sid = data.get("sessionId") or "anon"
        items = data.get("items") or []
        save_cart(tenant, sid, items)
        return web.json_response(
            {"ok": True},
            headers=_cart_cors_headers(),
        )
    except Exception as e:
        print("[ai-waiter-service] ❌ cart_save error:", e)
        return web.json_response(
            {"ok": False, "error": str(e)},
            status=500,
            headers=_cart_cors_headers(),
        )


async def handle_cart_options(request: web.Request) -> web.StreamResponse:
    # CORS preflight handler for /cart/load and /cart/save
    return web.Response(
        status=204,
        headers=_cart_cors_headers(),
    )


async def start_http_server():
    app = web.Application()

    # CORS / preflight
    app.router.add_route("OPTIONS", "/cart/load", handle_cart_options)
    app.router.add_route("OPTIONS", "/cart/save", handle_cart_options)

    # Actual endpoints
    app.router.add_get("/cart/load", handle_cart_load)
    app.router.add_post("/cart/save", handle_cart_save)

    runner = web.AppRunner(app)
    await runner.setup()
    port = int(os.environ.get("CART_HTTP_PORT", "7081"))
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    print(f"[ai-waiter-service] 🛒 Cart HTTP API listening on :{port}")

# ---------- Helpers ----------

_LATIN = re.compile(r"[A-Za-z]")
_BENGALI = re.compile(r"[\u0980-\u09FF]")

BANGLA_PROMPT = "আসসালামু আলাইকুম, আমি খাবার অর্ডার করতে চাই।"


def looks_sane(text: str, lang: Optional[str]) -> bool:
    s = (text or "").strip()
    if len(s) < 2:
        return False
    generic = {"thank you", "thanks", "today", "ok", "okay"}
    if s.lower() in generic:
        return False

    has_bn = bool(_BENGALI.search(s))
    has_en = bool(_LATIN.search(s))

    if lang == "bn":
        return has_bn or (not has_en and len(s) > 3)
    if lang == "en":
        return has_en or (not has_bn and len(s) > 3)

    return has_bn or has_en


def rms_i16(b: bytes) -> float:
    if not b:
        return 0.0
    x = np.frombuffer(b, dtype=np.int16)
    if x.size == 0:
        return 0.0
    xf = x.astype(np.float32)
    return float(np.sqrt(np.mean(xf * xf)))


def pcm16_mono_to_wav_bytes(pcm_bytes: bytes, rate: int = 16000) -> bytes:
    bio = io.BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(pcm_bytes)
    return bio.getvalue()


async def groq_transcribe(pcm_bytes: bytes, lang: Optional[str], rate: int = 16000) -> Optional[str]:
    if not GROQ_API_KEY:
        return None
    try:
        wav_bytes = pcm16_mono_to_wav_bytes(pcm_bytes, rate=rate)
        url = GROQ_BASE.rstrip("/") + "/openai/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        data = {"model": GROQ_MODEL, "response_format": "json"}
        if lang and lang not in ("auto", "", None):
            data["language"] = lang
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        async with httpx.AsyncClient(timeout=GROQ_TIMEOUT_MS / 1000) as client:
            resp = await client.post(url, headers=headers, data=data, files=files)
        if resp.status_code >= 400:
            print("[ai-waiter-service] Groq error:", resp.status_code, resp.text[:200])
            return None
        payload = resp.json()
        txt = (payload.get("text") or "").strip()
        if txt:
            return txt
    except Exception as e:
        print("[ai-waiter-service] Groq call failed:", e)
    return None


# ---------- Time-of-day + Climate helpers ----------

def _time_of_day() -> str:
    # Simple bucket; server local time is fallback
    h = datetime.now().hour
    if 5 <= h < 11:
        return "breakfast"
    if 11 <= h < 16:
        return "lunch"
    if 16 <= h < 21:
        return "evening"
    return "late"


def _time_of_day_for_tz(tz: Optional[str], local_hour: Optional[int] = None) -> str:
    # 1) If browser sent a trusted localHour, use that first
    if isinstance(local_hour, int) and 0 <= local_hour < 24:
        h = local_hour
    # 2) Else try tz from client
    elif tz:
        try:
            now = datetime.now(ZoneInfo(tz))
            h = now.hour
        except Exception:
            # Fallback to server clock if tzdata/ZoneInfo fails
            return _time_of_day()
    else:
        # No hint → fallback to server clock
        return _time_of_day()

    if 5 <= h < 11:
        return "breakfast"
    if 11 <= h < 16:
        return "lunch"
    if 16 <= h < 22:
        return "evening"
    return "late"


async def fetch_weather_bucket(lat: float, lon: float) -> Optional[str]:
    """
    Tiny helper: classify current temp into a climate bucket.
    Uses Open-Meteo-style API; safe no-op on failure.
    """
    try:
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m",
        }
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(WEATHER_API_BASE, params=params)
        r.raise_for_status()
        data = r.json()
        cur = data.get("current") or {}
        temp = cur.get("temperature_2m")
        if temp is None:
            return None

        # Buckets tuned roughly for BD-style weather; per-tenant tuning later.
        if temp >= 35:
            return "very-hot"
        if temp >= 30:
            return "hot"
        if temp >= 24:
            return "warm"
        if temp >= 18:
            return "mild"
        return "cool"
    except Exception as e:
        print("[ai-waiter-service] weather fetch failed:", e)
        return None


# ---------- Tenant resolver ----------

def _to_object_id_maybe(x: Optional[str]) -> Optional[ObjectId]:
    if not x or not isinstance(x, str):
        return None
    try:
        return ObjectId(x)
    except Exception:
        return None


def resolve_tenant_id(tenant_hint: Optional[str]) -> Optional[ObjectId]:
    """
    Resolve a UI-provided tenant hint (slug/subdomain/code/name or _id string)
    into the actual ObjectId from tenants collections.
    """
    if not tenant_hint:
        return None

    # 1) direct ObjectId-like
    try:
        return ObjectId(tenant_hint)
    except Exception:
        pass

    # 2) look in transcripts DB tenants
    try:
        t = DB.tenants.find_one(
            {
                "$or": [
                    {"slug": tenant_hint},
                    {"subdomain": tenant_hint},
                    {"code": tenant_hint},
                    {"name": tenant_hint},
                ]
            },
            {"_id": 1},
        )
        if t and t.get("_id"):
            return t["_id"]
    except Exception as e:
        print("[ai-waiter-service] ⚠️ tenant lookup (qravy) failed:", e)

    # 3) look in MENU_DB.tenants
    try:
        menu_tenants = _CLIENT[MENU_DB_NAME]["tenants"]
        t2 = menu_tenants.find_one(
            {
                "$or": [
                    {"slug": tenant_hint},
                    {"subdomain": tenant_hint},
                    {"code": tenant_hint},
                    {"name": tenant_hint},
                ]
            },
            {"_id": 1},
        )
        if t2 and t2.get("_id"):
            return t2["_id"]
    except Exception as e:
        print("[ai-waiter-service] ⚠️ tenant lookup (MENU_DB) failed:", e)

    return None


# ---------- Menu snapshot & vocab ----------

def build_menu_query(tenant: Optional[str]) -> Dict[str, Any]:
    # strict visibility: use only equality-safe filters
    q: Dict[str, Any] = {
        "status": "active",
        "hidden": False,
    }
    if tenant:
        tenant_oid = resolve_tenant_id(tenant)
        if tenant_oid:
            q["tenantId"] = tenant_oid
    return q


def fetch_menu_snapshot(tenant: Optional[str], limit: int = MENU_SNAPSHOT_MAX) -> Dict[str, Any]:
    """
    Build a compact, real-time slice of the menu (source of truth for the brain).
    Uses MenuItemDoc-like fields.
    """
    try:
        q = build_menu_query(tenant)
        print("[debug] menu query:", q)

        cur = ITEMS.find(
            q,
            {
                "_id": 1,
                "name": 1,
                "price": 1,
                "categoryId": 1,
                "category": 1,
                "visibility": 1,
                "status": 1,
                "hidden": 1,
                "aliases": 1,
                "tags": 1,
            },
        ).limit(limit)

        items: List[Dict[str, Any]] = []
        for d in cur:
            vis = d.get("visibility") or {}
            dine_in_ok = vis.get("dineIn", vis.get("dinein", True)) is not False
            online_ok = vis.get("online", True) is not False

            tags = d.get("tags") or []

            base_available = (not bool(d.get("hidden"))) and (d.get("status") == "active")

            items.append(
                {
                    "id": str(d.get("_id")),
                    "name": d.get("name"),
                    "categoryId": str(d.get("categoryId")) if d.get("categoryId") else None,
                    "category": d.get("category"),
                    "price": d.get("price"),
                    "status": d.get("status"),
                    "hidden": bool(d.get("hidden")),
                    "visibility": {
                        "dineIn": bool(dine_in_ok),
                        "online": bool(online_ok),
                    },
                    # channel-agnostic available; final decision is channel-aware
                    "available": bool(base_available and (dine_in_ok or online_ok)),
                    "aliases": d.get("aliases") or [],
                    "tags": tags,
                }
            )

        print("[debug] snapshot items count =", len(items))

        cats: Dict[str, Dict[str, Any]] = {}
        for it in items:
            cid = it.get("categoryId")
            cname = it.get("category")
            if cid or cname:
                key = cid or cname
                if key not in cats:
                    cats[key] = {
                        "id": cid,
                        "name": cname,
                    }

        snapshot = {
            "tenant_id": tenant,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "categories": [c for c in cats.values() if c.get("name")],
            "items": items,
        }
        return snapshot
    except Exception as e:
        print("[ai-waiter-service] ⚠️ fetch_menu_snapshot failed:", e)
        return {
            "tenant_id": tenant,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "categories": [],
            "items": [],
        }


def build_vocab_from_snapshot(snapshot: Dict[str, Any]) -> List[str]:
    vocab: List[str] = []
    for it in snapshot.get("items", []):
        n = it.get("name")
        if n:
            vocab.append(n)
        if INCLUDE_ALIASES:
            for a in (it.get("aliases") or []):
                if a:
                    vocab.append(a)

    seen = set()
    out = []
    for w in vocab:
        if w not in seen:
            seen.add(w)
            out.append(w)
        if len(out) >= VOCAB_MAX:
            break
    return out


# ---------- Shortlist helpers (context + candidates) ----------

def _normalize_channel(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    v = raw.strip().lower()
    if v in ("dine-in", "dinein", "dine_in", "table"):
        return "dine-in"
    if v in ("online", "delivery", "pickup", "takeaway", "take-out", "takeout"):
        return "online"
    return None


def _channel_allows(vis: Dict[str, Any], channel: Optional[str]) -> bool:
    if not vis:
        return True
    if channel == "dine-in":
        return vis.get("dineIn", True) is not False
    if channel == "online":
        return vis.get("online", True) is not False
    # fallback: any channel ok
    return (vis.get("dineIn", True) is not False) or (vis.get("online", True) is not False)


def build_runtime_context(
    tenant: Optional[str],
    branch: Optional[str],
    channel: Optional[str],
    lang_hint: Optional[str],
    dialog_state: Optional[Dict[str, Any]],
    user_tz: Optional[str] = None,
    climate_bucket: Optional[str] = None,
    user_local_hour: Optional[int] = None,
) -> Dict[str, Any]:
    ch = _normalize_channel(channel) or "dine-in"
    lang = (lang_hint or "").lower()
    if lang not in ("bn", "en"):
        lang = "auto"

    ctx: Dict[str, Any] = {
        "timeOfDay": _time_of_day_for_tz(user_tz, user_local_hour),
        "channel": ch,
        "tenant": tenant,
        "branch": branch,
        "languageHint": lang,
    }

    if climate_bucket:
        ctx["climate"] = climate_bucket  # e.g. hot / warm / mild / cool / very-hot

    if dialog_state and isinstance(dialog_state, dict):
        last_intent = dialog_state.get("last_intent") or dialog_state.get("intent")
        if last_intent:
            ctx["lastIntent"] = last_intent

    return {k: v for k, v in ctx.items() if v is not None}


def _extract_cart_item_ids(dialog_state: Optional[Dict[str, Any]]) -> List[str]:
    """
    Best-effort extraction of itemIds already in cart / recently ordered.
    Works with loose shapes; safe if nothing there.
    """
    ids: set[str] = set()
    if not dialog_state or not isinstance(dialog_state, dict):
        return []

    def ingest_list(lst):
        if not isinstance(lst, list):
            return
        for it in lst:
            if not isinstance(it, dict):
                continue
            iid = (
                it.get("itemId")
                or it.get("id")
                or it.get("_id")
            )
            if iid:
                s = str(iid).strip()
                if s:
                    ids.add(s)

    # common patterns
    cart = dialog_state.get("cart")
    if isinstance(cart, dict):
        ingest_list(cart.get("items"))

    meta = dialog_state.get("meta")
    if isinstance(meta, dict):
        ingest_list(meta.get("items"))

    # generic: any top-level list named "items"
    ingest_list(dialog_state.get("items"))

    return list(ids)


def build_suggestion_candidates(
    snapshot: Dict[str, Any],
    context: Dict[str, Any],
    limit: int = 40,
) -> List[Dict[str, Any]]:
    """
    Channel-aware shortlist:
      - status == active
      - hidden != true
      - visibility allows this channel
      - tagged items boosted, but untagged items included.
    """
    channel = context.get("channel")
    tod = context.get("timeOfDay")  # breakfast/lunch/evening/late

    rows = []
    for it in snapshot.get("items", []):
        if it.get("status") != "active":
            continue
        if it.get("hidden"):
            continue
        vis = it.get("visibility") or {}
        if not _channel_allows(vis, channel):
            continue

        base = 1.0
        tags = [str(t).lower() for t in (it.get("tags") or [])]
        name = (it.get("name") or "").lower()
        cat = (it.get("category") or "").lower()

        # Tag-based boosts
        if "recommended" in tags or "bestseller" in tags:
            base += 3.0
        if "popular" in tags:
            base += 2.0
        if "new" in tags:
            base += 1.5
        if "sharing" in tags or "combo" in tags or "platter" in tags:
            base += 0.8

        # Time-of-day heuristics
        if tod == "breakfast":
            if "breakfast" in tags or "breakfast" in cat:
                base += 2.0
            if any(k in name for k in ["egg", "toast", "paratha", "porota", "tea", "coffee"]):
                base += 1.0
        elif tod == "lunch":
            if any(k in cat for k in ["meal", "rice", "bowl", "platter"]):
                base += 1.0
        elif tod == "evening":
            if any(k in cat for k in ["snacks", "fries", "burger", "pizza"]):
                base += 1.0

        rid = str(it.get("id") or it.get("_id") or "")
        if not rid:
            continue

        rows.append(
            {
                "itemId": rid,
                "id": rid,
                "title": it.get("name"),
                "name": it.get("name"),
                "categoryId": it.get("categoryId"),
                "price": it.get("price"),
                "tags": it.get("tags") or [],
                "_score": base,
            }
        )

    rows.sort(key=lambda r: r["_score"], reverse=True)
    out = []
    for r in rows[:limit]:
        r.pop("_score", None)
        out.append(r)
    return out


def build_upsell_candidates(
    snapshot: Dict[str, Any],
    context: Dict[str, Any],
    dialog_state: Optional[Dict[str, Any]],
    limit: int = 16,
) -> List[Dict[str, Any]]:
    """
    Small upsell pool:
      - good add-ons: drinks, sides, desserts, etc.
      - no duplicates of cart items.
    """
    channel = context.get("channel")
    cart_ids = set(_extract_cart_item_ids(dialog_state))

    drink_keys = ["drink", "juice", "soda", "coke", "pepsi", "milkshake", "shake", "lassi", "water"]
    side_keys = ["fries", "side", "wings", "nugget", "garlic bread"]
    dessert_keys = ["dessert", "brownie", "ice cream", "sundae", "pudding", "cake"]

    rows = []
    for it in snapshot.get("items", []):
        if it.get("status") != "active":
            continue
        if it.get("hidden"):
            continue
        vis = it.get("visibility") or {}
        if not _channel_allows(vis, channel):
            continue

        rid = str(it.get("id") or it.get("_id") or "")
        if not rid:
            continue
        if rid in cart_ids:
            continue

        tags = [str(t).lower() for t in (it.get("tags") or [])]
        name = (it.get("name") or "").lower()
        cat = (it.get("category") or "").lower()

        score = 0.0

        if any(t in tags for t in ["upsell", "addon", "add-on", "side", "drink", "dessert"]):
            score += 3.0

        if any(k in cat for k in ["drink", "beverage"]) or any(k in name for k in drink_keys):
            score += 2.5
        if any(k in cat for k in ["side", "snack"]) or any(k in name for k in side_keys):
            score += 2.0
        if any(k in cat for k in ["dessert"]) or any(k in name for k in dessert_keys):
            score += 2.0

        if score <= 0:
            continue

        rows.append(
            {
                "itemId": rid,
                "id": rid,
                "title": it.get("name"),
                "name": it.get("name"),
                "categoryId": it.get("categoryId"),
                "price": it.get("price"),
                "tags": it.get("tags") or [],
                "_score": score,
            }
        )

    rows.sort(key=lambda r: r["_score"], reverse=True)
    out = []
    for r in rows[:limit]:
        r.pop("_score", None)
        out.append(r)
    return out


# ---------- Deterministic pre-match (snapshot → DB fallback) ----------

def _tokenize_lower(s: str) -> List[str]:
    s = (s or "").lower()
    return re.findall(r"[a-z\u0980-\u09FF]+(?:\s+[a-z\u0980-\u09FF]+)?", s)


def _match_in_snapshot(norm_text: str, snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Find items whose name/aliases appear in normalized text."""
    text = (norm_text or "").lower()
    if not text.strip():
        return []
    hits = []
    for it in snapshot.get("items", []):
        name = (it.get("name") or "").strip()
        aliases = [a.strip() for a in (it.get("aliases") or []) if a]
        cand_strings = [name.lower()] + [a.lower() for a in aliases]
        if any(re.search(rf"\b{re.escape(c)}\b", text) for c in cand_strings if c):
            hits.append(it)
    return hits


def _db_fallback_search(tenant_hint: Optional[str], norm_text: str, limit: int = 10) -> List[Dict[str, Any]]:
    """If snapshot missed it (due to cap), query DB with visibility constraints."""
    q_base = build_menu_query(tenant_hint)
    text = (norm_text or "").strip()
    if not text:
        return []
    tokens = list(set(_tokenize_lower(text)))[:6]
    if not tokens:
        return []

    regexes = [{"name": {"$regex": re.escape(tok), "$options": "i"}} for tok in tokens]
    alias_regexes = [
        {"aliases": {"$elemMatch": {"$regex": re.escape(tok), "$options": "i"}}}
        for tok in tokens
    ]
    q = {"$and": [q_base, {"$or": regexes + alias_regexes}]}
    print("[debug] DB fallback query:", q)

    cur = ITEMS.find(
        q,
        {
            "_id": 1,
            "name": 1,
            "price": 1,
            "category": 1,
            "categoryId": 1,
            "aliases": 1,
            "status": 1,
            "hidden": 1,
            "visibility": 1,
        },
    ).limit(limit)
    out = []
    for d in cur:
        vis = d.get("visibility") or {}
        dine_in_ok = vis.get("dineIn", vis.get("dinein", True)) is not False
        out.append(
            {
                "id": str(d.get("_id")),
                "name": d.get("name"),
                "category_id": str(d.get("categoryId")) if d.get("categoryId") else None,
                "category": d.get("category"),
                "price": d.get("price"),
                "available": (not bool(d.get("hidden")))
                and (d.get("status") == "active")
                and dine_in_ok,
                "aliases": d.get("aliases") or [],
            }
        )
    return out


def _compose_availability_reply(items: List[Dict[str, Any]], lang_hint: Optional[str]) -> str:
    """Short, deterministic availability message with prices."""
    lang = (lang_hint or "").lower()
    if not items:
        return "Not found."

    top = items[0]
    name = top.get("name") or "that item"
    price = top.get("price")
    price_str = f" (৳{price})" if isinstance(price, (int, float)) else ""

    alts = [it.get("name") for it in items[1:3] if it.get("name")]
    if lang == "bn":
        base = f"জি, {name} রয়েছে{price_str}। নেবেন কি?"
        if alts:
            base += f" কাছাকাছি আরও আছে: {', '.join(alts)}।"
        return base
    else:
        base = f"Yes, {name} is available{price_str}. Would you like to add one?"
        if alts:
            base += f" Similar options: {', '.join(alts)}."
        return base


# ---------- Brain call wrapper ----------

async def call_brain_and_push(
    ws: WebSocketServerProtocol,
    *,
    transcript: str,
    transcript_norm: str,
    norm_changes: List[Tuple[str, str, float]],
    tenant: Optional[str],
    branch: Optional[str],
    channel: Optional[str],
    session_id: Optional[str],
    user_id: Optional[str],
    menu_snapshot: Dict[str, Any],
    history: Optional[List[Dict[str, str]]] = None,
    dialog_state: Optional[Dict[str, Any]] = None,
    locale: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
    suggestion_candidates: Optional[List[Dict[str, Any]]] = None,
    upsell_candidates: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Single entrypoint to brain.generate_reply.
    Forwards all structured context + candidates; pushes WS ai_reply.
    """
    print(
        f"[ai-waiter-service] 🧠 calling brain for transcript_norm: '{transcript_norm[:80]}...'"
    )
    reply_obj = {"replyText": "", "meta": {}}
    try:
        # Call new brain signature; fallback to legacy if needed
        try:
            reply = await generate_reply(
                transcript=transcript_norm,
                tenant=tenant,
                branch=branch,
                channel=channel,
                locale=locale,
                menu_snapshot=menu_snapshot,
                conversation_id=session_id,
                user_id=user_id,
                history=history,
                dialog_state=dialog_state,
                context=context,
                suggestion_candidates=suggestion_candidates,
                upsell_candidates=upsell_candidates,
            )
        except TypeError:
            # Legacy compatibility (no extra args)
            reply = await generate_reply(
                transcript=transcript_norm,
                tenant=tenant,
                branch=branch,
                channel=channel,
                locale=locale,
                menu_snapshot=menu_snapshot,
                conversation_id=session_id,
                user_id=user_id,
                history=history,
                dialog_state=dialog_state,
            )

        reply_obj = {
            "replyText": reply.get("replyText") or "",
            "meta": reply.get("meta") or {},
        }
        print(
            f"[ai-waiter-service] 🧠 brain replyText: '{reply_obj['replyText'][:80]}...'"
        )

        meta = reply_obj.get("meta", {})
        print(
            "[ai-waiter-service] model=",
            meta.get("model"),
            "lang=",
            meta.get("language"),
            "intent=",
            meta.get("intent"),
            "fallback=",
            meta.get("fallback"),
        )

        if not ws.closed:
            await ws.send(
                json.dumps(
                    {
                        "t": "ai_reply",
                        "replyText": reply_obj["replyText"],
                        "meta": {
                            **meta,
                            "normalizer": {
                                "changed": [
                                    {"from": a, "to": b, "score": s}
                                    for (a, b, s) in norm_changes
                                ]
                            },
                        },
                    }
                )
            )
            print("[ai-waiter-service] ✅ ai_reply sent")
        else:
            print("[ai-waiter-service] ⚠️ WS closed, cannot send ai_reply")
    except Exception as e:
        print(f"[ai-waiter-service] ❌ brain call failed: {e}")
        import traceback

        traceback.print_exc()
        if not ws.closed:
            try:
                await ws.send(
                    json.dumps(
                        {
                            "t": "ai_reply_error",
                            "message": "AI unavailable",
                        }
                    )
                )
            except Exception as send_err:
                print(
                    "[ai-waiter-service] ❌ failed to send ai_reply_error:",
                    send_err,
                )
    return reply_obj


# ---------- WS handler ----------

async def handle_conn(ws: WebSocketServerProtocol):
    session_id = None
    user_id = "guest"
    rate = 16000
    ch = 1

    # Start with env default (bn), but allow client override
    session_lang: Optional[str] = (WHISPER_LANG or "bn")
    tenant_hint: Optional[str] = None
    branch_hint: Optional[str] = None
    channel_hint: Optional[str] = None

    last_detected_lang = None

    # ⭐ NEW: user TZ, GEO, localHour (from frontend "hello")
    user_tz: Optional[str] = None
    user_geo: Optional[Dict[str, float]] = None
    user_local_hour: Optional[int] = None

    if isinstance(session_lang, str) and session_lang.strip().lower() == "auto":
        session_lang = None

    seg = Segmenter(bytes_per_sec=rate * 2, min_ms=500, max_ms=2000)

    work_q: asyncio.Queue = asyncio.Queue(maxsize=1)
    closed = asyncio.Event()

    all_pcm = bytearray()
    last_partial_text = None

    closing = False
    final_sent = False

    def cap_buffer():
        MAX_ACCUM_BYTES = 60 * rate * 2
        nonlocal all_pcm
        if len(all_pcm) > MAX_ACCUM_BYTES:
            all_pcm = all_pcm[-MAX_ACCUM_BYTES:]

    async def worker():
        nonlocal last_partial_text, final_sent, last_detected_lang
        MIN_CHUNK_BYTES = 8000

        while not closed.is_set():
            if final_sent:
                break
            chunk = await work_q.get()
            if chunk is None:
                break
            if final_sent:
                break

            if len(chunk) < MIN_CHUNK_BYTES:
                print(
                    f"[ai-waiter-service] skipping short chunk: {len(chunk)} bytes"
                )
                continue
            if rms_i16(chunk) < 350.0:
                print(
                    "[ai-waiter-service] skip low-energy chunk (silence/noise)"
                )
                continue

            print(
                f"[ai-waiter-service] transcribing chunk bytes={len(chunk)} lang={session_lang or 'auto'}"
            )
            text, _, det = await asyncio.get_event_loop().run_in_executor(
                None, stt_np_float32, chunk, session_lang
            )
            if det:
                last_detected_lang = det
            if text and not final_sent and not ws.closed:
                last_partial_text = text
                has_bn = bool(_BENGALI.search(text))
                has_en = bool(_LATIN.search(text))
                print(
                    f"[ai-waiter-service] 🔍 partial='{text[:50]}' | has_bn={has_bn} has_en={has_en} | "
                    f"hint={session_lang} det={last_detected_lang}"
                )

                try:
                    await ws.send(
                        json.dumps(
                            {
                                "t": "stt_partial",
                                "text": text,
                                "ts": time.time(),
                            }
                        )
                    )
                    print(
                        "[ai-waiter-service] stt_partial:",
                        text[:120],
                    )
                except Exception as e:
                    print(
                        "[ai-waiter-service] stt_partial send failed:",
                        e,
                    )
                    break

    wtask = asyncio.create_task(worker())

    try:
        print("[ai-waiter-service] client connected")
        try:
            if not ws.closed:
                await ws.send(json.dumps({"t": "ack"}))
        except Exception as e:
            print("[ai-waiter-service] failed to send ack:", e)

        # Receive loop with idle-timeout
        while True:
            timeout_s = max(0.1, IDLE_FINALIZE_MS / 1000.0)
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=timeout_s)
            except asyncio.TimeoutError:
                if not closing:
                    print(
                        f"[ai-waiter-service] idle {IDLE_FINALIZE_MS}ms → finalizing"
                    )
                    closing = True
                break
            except websockets.ConnectionClosed:
                print(
                    "[ai-waiter-service] connection closed by client"
                )
                closing = True
                break

            if isinstance(msg, (bytes, bytearray)):
                if closing or final_sent:
                    continue
                all_pcm += msg
                cap_buffer()

                out = seg.push(msg)
                if out:
                    # keep only the freshest chunk
                    try:
                        while True:
                            work_q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        work_q.put_nowait(out)
                    except asyncio.QueueFull:
                        pass
                continue

            # handle JSON control messages
            try:
                data = json.loads(msg)
            except Exception:
                continue
            t = data.get("t")

            if t == "hello":
                session_id = data.get("sessionId") or session_id
                user_id = data.get("userId") or user_id
                rate = int(data.get("rate", 16000))
                ch = int(data.get("ch", 1))

                # language hint: 'bn' | 'en' | 'auto'
                lang_hint = data.get("lang")
                if isinstance(lang_hint, str) and lang_hint:
                    v = lang_hint.strip().lower()
                    session_lang = None if v == "auto" else v

                tenant_hint = data.get("tenant") or tenant_hint
                branch_hint = data.get("branch") or branch_hint
                channel_hint = data.get("channel") or channel_hint

                # ⭐ NEW: user timezone & geo from frontend
                tz = data.get("tz")
                if isinstance(tz, str) and tz:
                    user_tz = tz

                geo = data.get("geo")
                if isinstance(geo, dict):
                    lat = geo.get("lat")
                    lon = geo.get("lon")
                    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                        user_geo = {"lat": float(lat), "lon": float(lon)}

                # ⭐ NEW: localHour snapshot from frontend
                lh = data.get("localHour")
                if isinstance(lh, (int, float)):
                    lh = int(lh)
                    if 0 <= lh < 24:
                        user_local_hour = lh

                print(
                    f"[ai-waiter-service] hello session={session_id} user={user_id} "
                    f"rate={rate} ch={ch} lang={session_lang or 'auto'}"
                )
                print(
                    f"[ai-waiter-service] context: tenant={tenant_hint} "
                    f"branch={branch_hint} channel={channel_hint} tz={user_tz} "
                    f"geo={user_geo} localHour={user_local_hour}"
                )
                continue

            if t == "end":
                closing = True
                print(
                    "[ai-waiter-service] received end → finalizing"
                )
                break

        # Small drain: let worker finish in-flight chunk (~300ms)
        t0 = time.monotonic()
        while not work_q.empty() and (time.monotonic() - t0) < 0.3:
            await asyncio.sleep(0.01)

        # Finalize
        if not final_sent:
            last = seg.flush()
            if last:
                all_pcm += last
                cap_buffer()

            final_bytes = bytes(all_pcm) if all_pcm else b""
            print(
                f"[ai-waiter-service] finalization: total_bytes={len(final_bytes)}, "
                f"last_partial='{last_partial_text}' lang={session_lang or 'auto'}"
            )

            selected_text: Optional[str] = None
            selected_segs: List[Tuple[float, float]] = []

            # Preference: explicit lang → detected → script
            lang_pref = session_lang or last_detected_lang
            if not lang_pref and last_partial_text:
                if _BENGALI.search(last_partial_text):
                    lang_pref = "bn"
                elif _LATIN.search(last_partial_text):
                    lang_pref = "en"

            groq_used = False
            if (
                GROQ_API_KEY
                and len(final_bytes) >= 16000
                and not ws.closed
            ):
                try:
                    print(
                        f"[ai-waiter-service] lang preference for final: {lang_pref or 'auto'}"
                    )
                    print(
                        "[ai-waiter-service] calling Groq for final…"
                    )
                    groq_text = await groq_transcribe(
                        final_bytes, lang_pref, rate=rate
                    )

                    # single-retry on opposite language if obviously wrong
                    if (
                        groq_text
                        and lang_pref == "bn"
                        and _LATIN.search(groq_text)
                        and not _BENGALI.search(groq_text)
                    ):
                        print(
                            "[ai-waiter-service] BN expected but got EN → retry en"
                        )
                        en_text = await groq_transcribe(
                            final_bytes, "en", rate=rate
                        )
                        if en_text:
                            groq_text = en_text
                    elif (
                        groq_text
                        and lang_pref == "en"
                        and _BENGALI.search(groq_text)
                        and not _LATIN.search(groq_text)
                    ):
                        print(
                            "[ai-waiter-service] EN expected but got BN → retry bn"
                        )
                        bn_text = await groq_transcribe(
                            final_bytes, "bn", rate=rate
                        )
                        if bn_text:
                            groq_text = bn_text

                    if groq_text and looks_sane(
                        groq_text, lang_pref
                    ):
                        selected_text = groq_text
                        groq_used = True
                        print(
                            "[ai-waiter-service] ✅ using Groq final"
                        )
                except Exception as e:
                    print(
                        "[ai-waiter-service] Groq finalize failed:",
                        e,
                    )

            if not selected_text:
                if last_partial_text and looks_sane(
                    last_partial_text, lang_pref
                ):
                    selected_text = last_partial_text
                    selected_segs = []
                    print(
                        "[ai-waiter-service] ✅ using last sane partial as final"
                    )
                elif len(final_bytes) >= 16000:
                    print(
                        f"[ai-waiter-service] fallback to local full transcription: {len(final_bytes)} bytes"
                    )
                    try:
                        local_text, segs, det = (
                            await asyncio.get_event_loop().run_in_executor(
                                None,
                                stt_np_float32,
                                final_bytes,
                                session_lang,
                            )
                        )
                        if det:
                            last_detected_lang = det
                            print(
                                f"[ai-waiter-service] detected_lang(full)={last_detected_lang}"
                            )
                        if local_text:
                            selected_text = local_text
                            selected_segs = segs
                    except Exception as e:
                        print(
                            "[ai-waiter-service] local fallback failed:",
                            e,
                        )

            if selected_text and not ws.closed:
                # Live menu snapshot (tenant-scoped)
                snapshot = fetch_menu_snapshot(
                    tenant_hint, limit=MENU_SNAPSHOT_MAX
                )
                vocab = build_vocab_from_snapshot(snapshot)

                # Normalize with live vocab
                norm_text, changes = normalize_text(
                    selected_text,
                    vocab=vocab,
                    fuzzy_threshold=FUZZY_THRESHOLD,
                )

                # Record USER turn
                push_user(tenant_hint, session_id, norm_text)

                # --------- Deterministic availability path ---------
                matches = _match_in_snapshot(norm_text, snapshot)
                if not matches:
                    matches = _db_fallback_search(
                        tenant_hint, norm_text, limit=10
                    )

                if matches:
                    reply_text = _compose_availability_reply(
                        matches,
                        (session_lang or last_detected_lang or "en"),
                    )
                    final_lang = (
                        session_lang or last_detected_lang
                    )
                    if not final_lang:
                        final_lang = (
                            "bn"
                            if _BENGALI.search(norm_text)
                            else "en"
                        )

                    meta = {
                        "model": "deterministic",
                        "language": final_lang,
                        "intent": "order",
                        "items": [
                            {
                                "name": m.get("name"),
                                "itemId": m.get("id"),
                                "price": m.get("price"),
                            }
                            for m in matches[:5]
                        ],
                        "tenant": tenant_hint,
                        "branch": branch_hint,
                        "channel": channel_hint,
                        "fallback": False,
                        "source": "snapshot"
                        if matches
                        and matches[0]
                        in snapshot.get("items", [])
                        else "db",
                    }
                    try:
                        await ws.send(
                            json.dumps(
                                {
                                    "t": "ai_reply",
                                    "replyText": reply_text,
                                    "meta": {
                                        **meta,
                                        "normalizer": {
                                            "changed": [
                                                {
                                                    "from": a,
                                                    "to": b,
                                                    "score": s,
                                                }
                                                for (
                                                    a,
                                                    b,
                                                    s,
                                                ) in changes
                                            ]
                                        },
                                    },
                                }
                            )
                        )
                        print(
                            "[ai-waiter-service] ✅ deterministic ai_reply sent"
                        )
                    except Exception as e:
                        print(
                            "[ai-waiter-service] ❌ failed to send deterministic ai_reply:",
                            e,
                        )

                    # update context/state
                    push_assistant(
                        tenant_hint, session_id, reply_text
                    )
                    update_state(
                        tenant_hint,
                        session_id,
                        meta=meta,
                        user_text=norm_text,
                    )

                    # persist transcript + deterministic answer
                    try:
                        await writer_q.put(
                            {
                                "user": user_id,
                                "session": session_id,
                                "text": selected_text,
                                "text_norm": norm_text,
                                "norm_changes": changes,
                                "segments": [],
                                "ts": datetime.utcnow(),
                                "status": "new",
                                "engine": "deterministic",
                                "ai": {
                                    "replyText": reply_text,
                                    "meta": meta,
                                },
                                "tenant": tenant_hint,
                                "menu_snapshot_size": len(
                                    snapshot.get(
                                        "items", []
                                    )
                                ),
                            }
                        )
                    except Exception as e:
                        print(
                            "[ai-waiter-service] writer queue error:",
                            e,
                        )

                    final_sent = True
                    return  # ⛔ no LLM

                # ---------------- LLM path ----------------

                try:
                    if not ws.closed:
                        await ws.send(
                            json.dumps(
                                {"t": "ai_reply_pending"}
                            )
                        )
                except Exception:
                    pass

                print(
                    "[ai-waiter-service] 🧠 starting brain task…"
                )

                last_ai = {"replyText": "", "meta": {}}
                try:
                    history_list = get_history(
                        tenant_hint, session_id
                    )
                    dialog_state = get_state(
                        tenant_hint, session_id
                    )

                    # ⭐ NEW: climate bucket from geo (if available)
                    climate_bucket = None
                    if user_geo:
                        climate_bucket = await fetch_weather_bucket(
                            user_geo["lat"], user_geo["lon"]
                        )

                    # Build context + shortlists (now tz + localHour + climate aware)
                    ctx = build_runtime_context(
                        tenant=tenant_hint,
                        branch=branch_hint,
                        channel=channel_hint,
                        lang_hint=(session_lang or last_detected_lang),
                        dialog_state=dialog_state,
                        user_tz=user_tz,
                        climate_bucket=climate_bucket,
                        user_local_hour=user_local_hour,
                    )

                    # 🔗 NEW: include persisted cart so brain can merge quantities
                    cart_items = load_cart(tenant_hint or "unknown", session_id or "anon") or []
                    ctx["cartItems"] = [
                        {
                            "itemId": (
                                it.get("itemId")
                                or it.get("id")
                                or it.get("_id")
                            ),
                            "quantity": int(it.get("qty") or it.get("quantity") or 0),
                        }
                        for it in cart_items
                        if int(it.get("qty") or it.get("quantity") or 0) > 0
                    ]

                    suggestion_candidates = build_suggestion_candidates(snapshot, ctx, limit=40)
                    upsell_candidates = build_upsell_candidates(snapshot, ctx, dialog_state, limit=16)

                    last_ai = await call_brain_and_push(
                        ws,
                        transcript=selected_text,
                        transcript_norm=norm_text,
                        norm_changes=changes,
                        tenant=tenant_hint,
                        branch=branch_hint,
                        channel=channel_hint,
                        session_id=session_id,
                        user_id=user_id,
                        menu_snapshot=snapshot,
                        history=history_list,
                        dialog_state=dialog_state,
                        locale=(
                            session_lang
                            or last_detected_lang
                        ),
                        context=ctx,
                        suggestion_candidates=(
                            suggestion_candidates
                        ),
                        upsell_candidates=(
                            upsell_candidates
                        ),
                    )
                    print(
                        "[ai-waiter-service] 🧠 brain task completed"
                    )
                except Exception as e:
                    print(
                        "[ai-waiter-service] ❌ brain task failed:",
                        e,
                    )
                    import traceback

                    traceback.print_exc()

                # update context + dialog state
                push_assistant(
                    tenant_hint,
                    session_id,
                    last_ai.get("replyText") or "",
                )
                update_state(
                    tenant_hint,
                    session_id,
                    meta=last_ai.get("meta"),
                    user_text=norm_text,
                )

                # store for finetune/export
                try:
                    await writer_q.put(
                        {
                            "user": user_id,
                            "session": session_id,
                            "text": selected_text,
                            "text_norm": norm_text,
                            "norm_changes": changes,
                            "segments": [],
                            "ts": datetime.utcnow(),
                            "status": "new",
                            "engine": "groq"
                            if groq_used
                            else (
                                "local-partial"
                                if selected_segs
                                == []
                                else "local-full"
                            ),
                            "ai": last_ai,
                            "tenant": tenant_hint,
                            "menu_snapshot_size": len(
                                snapshot.get(
                                    "items", []
                                )
                            ),
                        }
                    )
                except Exception as e:
                    print(
                        "[ai-waiter-service] writer queue error:",
                        e,
                    )

                final_sent = True
            else:
                print(
                    "[ai-waiter-service] ⚠️ no usable final produced"
                )

    except Exception as e:
        print(
            f"[ai-waiter-service] error in handle_conn: {e}"
        )
        import traceback

        traceback.print_exc()
    finally:
        closed.set()
        try:
            await work_q.put(None)
        except Exception:
            pass
        await asyncio.gather(
            wtask, return_exceptions=True
        )
        print(
            "[ai-waiter-service] connection handler finished"
        )


# ---------- App bootstrap ----------

async def main():
    global WRITER_TASK
    WRITER_TASK = asyncio.create_task(writer())

    # Start Cart HTTP API in background
    asyncio.create_task(start_http_server())

    import signal
    loop = asyncio.get_running_loop()

    def _schedule_shutdown():
        asyncio.create_task(shutdown())

    try:
        loop.add_signal_handler(
            signal.SIGTERM, _schedule_shutdown
        )
        loop.add_signal_handler(
            signal.SIGINT, _schedule_shutdown
        )
    except NotImplementedError:
        pass

    port = int(os.environ.get("PORT", "7071"))
    async with websockets.serve(
        handle_conn,
        "0.0.0.0",
        port,
        max_size=None,
        ping_timeout=30,
        ping_interval=20,
        close_timeout=10,
    ):
        print(
            f"[ai-waiter-service] WS listening on :{port}"
        )
        await asyncio.Future()


async def shutdown():
    await writer_q.put(None)
    if WRITER_TASK:
        await WRITER_TASK


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        try:
            asyncio.run(shutdown())
        except Exception:
            pass
