import asyncio, json, os, time, re, io, wave
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo  # ✅ stdlib tz support
import numpy as np
import websockets
from websockets.server import WebSocketServerProtocol
from faster_whisper import WhisperModel
from pymongo import MongoClient
from vad import Segmenter
import httpx
from typing import Dict, Any, List, Tuple, Optional, Deque
from bson import Binary, ObjectId  # ✅
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
import checkout
import endpointer
import voiceprint
from bn_translit import to_bangla_script

# nothing clear was heard → ask politely, never guess
SORRY_REPEAT = {
    "bn": "দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন, প্লিজ?",
    "en": "Sorry, I didn't quite catch that — could you say it again, please?",
}

# Bangla replies: dish names in Bangla script (set BN_SCRIPT_NAMES=0 to keep English names)
BN_SCRIPT_NAMES = os.environ.get("BN_SCRIPT_NAMES", "1") == "1"
from waiter_knowledge import meal_kinds, reply_language
from recommender import OrderStats
import wait_time
import wait_talk

# ✅ Normalizer (exact pairs + phonetic + fuzzy)
from normalizer import normalize_text

# ✅ Local speech-to-text (PCM → text)
from stt import stt_np_float32

# ✅ Cart persistence helper
from cart_store import save_cart, load_cart
from availability import (
    DEFAULT_PERIODS,
    DEFAULT_TZ,
    format_windows,
    is_within,
    load_rules,
    local_now,
    resolve_location_id,
    unavailable_reason,
)

# ---------- Config ----------

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")

# transcripts DB (stays in qravy)
TRANS_DB_NAME = os.environ.get("MONGO_DB", "qravy")

# menu DB (can be different, e.g., authDB)
MENU_DB_NAME = os.environ.get("MENU_DB", TRANS_DB_NAME)
MENU_COLL = os.environ.get("MENU_COLLECTION", "menu_items")

# Session context (kept for compatibility; actual logic in session_ctx)
MAX_TURNS = int(os.environ.get("SESSION_CTX_TURNS", "12"))
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

# conversations survive restarts/deploys (history + checkout stage), kept one day
try:
    import session_ctx as _session_ctx

    DB.waiter_sessions.create_index("at", expireAfterSeconds=24 * 3600, name="ttl_1d")
    _session_ctx.attach_store(DB.waiter_sessions)
except Exception as e:
    print("[ai-waiter-service] ⚠️ session store unavailable (memory only):", e)

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

# ---------- Buzzer alert state (per-tenant) ----------
# { tenant_subdomain: {"active": bool, "since": float | None} }
_ALERT_STATE: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"active": False, "since": None})

def _set_alert(tenant: str, active: bool) -> None:
    _ALERT_STATE[tenant]["active"] = active
    _ALERT_STATE[tenant]["since"] = time.time() if active else None

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


# ---------- Buzzer alert HTTP handlers ----------

async def handle_alert_get(request: web.Request) -> web.Response:
    """GET /alert?tenant=<subdomain>  — polled by the ESP32 every 2 s."""
    tenant = request.rel_url.query.get("tenant", "")
    state = _ALERT_STATE[tenant] if tenant else {"active": False, "since": None}
    return web.Response(
        content_type="application/json",
        text=json.dumps({"alert": state["active"], "since": state["since"]}),
        headers={"Access-Control-Allow-Origin": "*"},
    )

async def handle_alert_dismiss(request: web.Request) -> web.Response:
    """POST /alert/dismiss?tenant=<subdomain>  — called by the dashboard when employee acknowledges."""
    tenant = request.rel_url.query.get("tenant", "")
    if not tenant:
        return web.Response(status=400, text=json.dumps({"ok": False, "error": "tenant required"}),
                            content_type="application/json")
    _set_alert(tenant, False)
    print(f"[alert] ✅ buzzer dismissed for {tenant}")
    return web.Response(
        content_type="application/json",
        text=json.dumps({"ok": True}),
        headers={"Access-Control-Allow-Origin": "*"},
    )

async def handle_alert_options(request: web.Request) -> web.Response:
    return web.Response(status=204, headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    })


async def start_http_server():
    app = web.Application()

    # CORS / preflight
    app.router.add_route("OPTIONS", "/cart/load", handle_cart_options)
    app.router.add_route("OPTIONS", "/cart/save", handle_cart_options)
    app.router.add_route("OPTIONS", "/alert", handle_alert_options)
    app.router.add_route("OPTIONS", "/alert/dismiss", handle_alert_options)

    # Actual endpoints
    app.router.add_get("/cart/load", handle_cart_load)
    app.router.add_post("/cart/save", handle_cart_save)
    app.router.add_get("/alert", handle_alert_get)
    app.router.add_post("/alert/dismiss", handle_alert_dismiss)

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


_JUNK = re.compile(
    r"^\W*(thanks? (you )?for watching|please subscribe|subscribe|thank you|thanks|you|bye|see you|"
    r"সাবস্ক্রাইব|ধন্যবাদ দেখার জন্য)\W*$",
    re.I,
)


# Guests speak Bangla or English. Anything in another script ("ਕੀ ਕੀ ਅੱਛਾ ਪਾ" — Punjabi for "কী কী আছে") is the
# speech model guessing the wrong language on a short phrase, not what was said.
# (the Bangla full stop "।" and "॥" are code points in the Devanagari block — they are Bangla punctuation, not Hindi)
_FOREIGN_SCRIPT = re.compile(r"[\u0600-\u06FF\u0900-\u0963\u0966-\u097F\u0A00-\u0D7F\u0E00-\u0FFF\u3040-\u9FFF\uAC00-\uD7AF]")

# Whisper's well-known inventions on silence / background noise (YouTube sign-offs) — never something a guest said
_HALLUCINATION = re.compile(
    r"(see you|meet you) (again )?in (the|our|my) next (video|one)|\bnext video\b|thanks? (you )?(so much )?for watching"
    r"|(like and |please |don'?t forget to )?subscribe\b|\bsubtitles? (by|from)\b|\bamara\.org\b"
    r"|ভিডিওটি দেখার জন্য ধন্যবাদ|ভিডিও(টি)? দেখার জন্য|সাবস্ক্রাইব|পরবর্তী ভিডিও",
    re.I,
)


def is_hallucination(text: Optional[str]) -> bool:
    return bool(text) and bool(_HALLUCINATION.search(text or ""))


def fits_language(text: Optional[str], lang: Optional[str]) -> bool:
    """Backup-model text must be in the script of the language the guest selected (Bangla → some Bangla letters)."""
    if not text or lang not in ("bn", "en"):
        return True
    return bool(_BENGALI.search(text)) if lang == "bn" else bool(_LATIN.search(text))


def wrong_script(text: Optional[str]) -> bool:
    return bool(text) and bool(_FOREIGN_SCRIPT.search(text or ""))


def is_junk_transcript(text: str) -> bool:
    """Classic transcriber filler on near-silence ("Thanks for watching!") — never a real order."""
    s = (text or "").strip()
    return len(s) < 2 or bool(_JUNK.match(s))


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


async def groq_transcribe(pcm_bytes: bytes, lang: Optional[str], rate: int = 16000, prompt: str = "") -> Optional[str]:
    if not GROQ_API_KEY:
        return None
    try:
        wav_bytes = pcm16_mono_to_wav_bytes(pcm_bytes, rate=rate)
        url = GROQ_BASE.rstrip("/") + "/openai/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        data = {"model": GROQ_MODEL, "response_format": "json"}
        if lang and lang not in ("auto", "", None):
            data["language"] = lang
        if prompt:
            # Whisper reads only ~224 prompt tokens (Bangla ≈ 1–2 tokens per letter) — keep it short
            data["prompt"] = prompt[:180]
            data["temperature"] = "0"
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


# ---------- Final transcription: OpenAI (menu-aware) first, Groq Whisper as backup ----------

OPENAI_STT_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_STT_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
# the full model: clearly better at Bangla than gpt-4o-mini-transcribe, ~$0.006 vs ~$0.003 per minute of speech
OPENAI_STT_MODEL = os.environ.get("OPENAI_STT_MODEL", "gpt-4o-transcribe").strip()
# STT_ENGINE=openai (default when an OpenAI key is set) | groq
STT_ENGINE = os.environ.get("STT_ENGINE", "openai" if OPENAI_STT_KEY else "groq").strip().lower()
OPENAI_STT_ON = STT_ENGINE == "openai" and bool(OPENAI_STT_KEY)
OPENAI_STT_TIMEOUT_S = float(os.environ.get("OPENAI_STT_TIMEOUT_MS", "8000")) / 1000

_STT_PROMPTS: Dict[Tuple[str, str], Tuple[float, str]] = {}
_STT_PROMPT_TTL_S = 600
_STT_NAMES: Dict[Tuple[str, str], List[Tuple[str, str]]] = {}
_VOICE_LEVEL: Dict[str, float] = {}  # session → the guest's speaking level (dBFS), for hands-free listen windows


def stt_turn_hint(tenant: Optional[str], session: Optional[str], lang: Optional[str], max_chars: int = 160) -> str:
    """The dishes the waiter just named — what the guest will most likely say next. "থাই থিক স্যুপ" right after the
    waiter suggested it is then heard as that, not "ভাইস ঠিক স্যুপ". Dish names only (see stt_prompt), from the
    waiter's last reply; empty when it named none."""
    l = "en" if lang == "en" else "bn"
    pairs = _STT_NAMES.get((tenant or "", l)) or []
    if not pairs or not session:
        return ""
    try:
        last = next((m.get("content") or "" for m in reversed(get_history(tenant, session) or [])
                     if m.get("role") == "assistant"), "")
    except Exception:
        return ""
    low = last.lower()
    said = [spoken for _, spoken in sorted((low.find(n.lower()), s) for n, s in pairs if n.lower() in low)]  # as said
    said = list(dict.fromkeys(re.sub(r"\s*\(.*?\)", "", s).strip() for s in said))
    out = ""
    for s in said:
        if len(out) + len(s) + 2 > max_chars:
            break
        out += s + ", "
    return out.rstrip(", ")

def stt_prompt(tenant: Optional[str], lang: Optional[str], max_chars: int = 420) -> str:
    """This restaurant's dish names (Bangla script for Bangla speech), so the transcriber expects
    "স্পেশাল ফ্রাইড প্রন" instead of inventing "স্পেশল ফ্রাইট প্রাউন". Cached per tenant for 10 minutes.

    Menu vocabulary ONLY — never action phrases ("place my order", "yes"): on silence, transcribers can echo
    their hint, and an echoed "yes, place it" must never be possible."""
    l = "en" if lang == "en" else "bn"
    key = (tenant or "", l)
    hit = _STT_PROMPTS.get(key)
    if hit and time.time() - hit[0] < _STT_PROMPT_TTL_S:
        return hit[1]
    names: List[str] = []
    try:
        snap = fetch_menu_snapshot(tenant, limit=MENU_SNAPSHOT_MAX, lang=l)
        pairs: List[Tuple[str, str]] = []
        for it in snap.get("items", []):
            n = str(it.get("name") or "").strip()
            if n:
                names.append(to_bangla_script(n) if l == "bn" else n)
                pairs.append((n, names[-1]))
        _STT_NAMES[key] = pairs  # (menu name, as it's said) — for the per-turn hint (stt_turn_hint)
    except Exception as e:
        print("[ai-waiter-service] ⚠️ stt prompt menu fetch failed:", e)
    bn = l == "bn"
    end = "।" if bn else "."
    head = "রেস্টুরেন্টে খাবারের অর্ডার নিয়ে কথা। " if bn else "A guest ordering food at a restaurant. "
    tail = ""
    # short on purpose: a 1,400-character wall of dish names pulled ordinary speech towards menu-ish words
    # ("আপনাদের" → "আত্মাদের"). One natural sentence + the menu's words, most frequent first (চিকেন, বিফ, প্রন,
    # রাইস, স্যুপ…) — they carry almost every dish name — until the budget is used.
    clean = [re.sub(r"\s+", " ", re.sub(r"\s*\(.*?\)\s*", " ", n).replace("&", " ")).strip() for n in names]
    counts: Dict[str, int] = {}
    for n in clean:
        for w in re.findall(r"[^\s,/\-\d]+", n):
            if len(w) > 1:
                counts[w] = counts.get(w, 0) + 1
    words = sorted(counts, key=lambda w: (-counts[w], w))
    # how guests name kinds of things ("ঠান্ডা" = a cold drink) — nouns only, safe to hint
    kinds = ["ঠান্ডা", "কোল্ড ড্রিংকস", "ডেজার্ট", "হাফ", "ফুল"] if bn else ["cold drinks", "dessert", "half", "full"]
    body = "মেনুর কিছু শব্দ: " if bn else "Words on the menu: "
    for w in dict.fromkeys(words + kinds):
        if len(head) + len(body) + len(w) + len(tail) + 2 > max_chars:
            break
        body += w + ", "
    prompt = (head + body.rstrip(", ") + end + " " + tail).strip()
    _STT_PROMPTS[key] = (time.time(), prompt)
    return prompt


def has_speech(pcm_bytes: bytes, rate: int = 16000) -> bool:
    """Enough voiced audio to be worth transcribing? (Silence/noise → transcribers invent text.)"""
    try:
        a = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
        frame = max(1, rate // 50)  # 20 ms
        n = len(a) // frame
        if n == 0:
            return False
        rms = np.sqrt(np.mean(a[: n * frame].reshape(n, frame) ** 2, axis=1))
        floor = float(np.percentile(rms, 20))
        voiced = int(np.sum(rms > max(300.0, floor * 3.0)))
        return voiced >= 10  # ≥ 200 ms of clearly-above-background sound
    except Exception:
        return True


def is_prompt_echo(text: Optional[str], prompt: str) -> bool:
    """The transcript is mostly a copy of the hint list (happens on silence/noise) → not what the guest said."""
    if not text or not prompt:
        return False
    hint = {x.strip() for x in re.split(r"[,،।:]", prompt) if x.strip()}
    parts = [x.strip() for x in re.split(r"[,،।]", text) if x.strip()]
    if not parts:
        return False
    hits = sum(1 for x in parts if x in hint)
    return (len(parts) >= 2 and hits >= 2 and hits / len(parts) >= 0.6) or (len(text) > 25 and text.strip(" ।.,") in prompt)


async def openai_transcribe(
    pcm_bytes: bytes, lang: Optional[str], rate: int = 16000, prompt: str = "", model: Optional[str] = None
) -> Optional[str]:
    if not OPENAI_STT_KEY:
        return None
    try:
        wav_bytes = pcm16_mono_to_wav_bytes(pcm_bytes, rate=rate)
        data = {"model": model or OPENAI_STT_MODEL, "response_format": "json", "temperature": "0"}
        if lang and lang not in ("auto", "", None):
            data["language"] = lang
        if prompt:
            data["prompt"] = prompt
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        async with httpx.AsyncClient(timeout=OPENAI_STT_TIMEOUT_S) as client:
            resp = await client.post(
                f"{OPENAI_STT_BASE}/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {OPENAI_STT_KEY}"},
                data=data,
                files=files,
            )
        if resp.status_code >= 400:
            print("[ai-waiter-service] OpenAI STT error:", resp.status_code, resp.text[:300])
            return None
        return (resp.json().get("text") or "").strip() or None
    except Exception as e:
        print("[ai-waiter-service] OpenAI STT failed:", repr(e))
    return None


_AB_FLAG: Dict[str, Any] = {"at": 0.0, "on": False}


def stt_ab_on() -> bool:
    """A/B test mode — toggled at runtime (no restart): qravy.settings {_id: "stt_ab", on: true}."""
    if time.time() - _AB_FLAG["at"] > 10:
        try:
            doc = DB.settings.find_one({"_id": "stt_ab"}) or {}
            _AB_FLAG["on"] = bool(doc.get("on"))
        except Exception:
            _AB_FLAG["on"] = False
        _AB_FLAG["at"] = time.time()
    return _AB_FLAG["on"]


async def _timed(coro) -> Tuple[Optional[str], int]:
    t0 = time.monotonic()
    try:
        out = await coro
    except Exception:
        out = None
    return out, int((time.monotonic() - t0) * 1000)


async def cloud_transcribe(
    pcm_bytes: bytes, lang: Optional[str], rate: int = 16000, tenant: Optional[str] = None,
    session: Optional[str] = None,
) -> Tuple[Optional[str], str]:
    """(text, engine) — OpenAI (OPENAI_STT_MODEL, gpt-4o-transcribe) with the menu as a hint; Groq Whisper if that fails.
    In A/B mode both run on the same audio and both results (+ the clip) are saved to qravy.stt_ab."""
    if not has_speech(pcm_bytes, rate):
        print("[ai-waiter-service] 🔇 no speech in the clip — not transcribing (avoids invented text)")
        return None, "no-speech"
    if OPENAI_STT_ON and GROQ_API_KEY and stt_ab_on():
        prompt = stt_prompt(tenant, lang)
        (oa, oa_ms), (gq, gq_ms) = await asyncio.gather(
            _timed(openai_transcribe(pcm_bytes, lang, rate=rate, prompt=prompt)),
            _timed(groq_transcribe(pcm_bytes, lang, rate=rate)),
        )
        echoed = is_prompt_echo(oa, prompt)
        if echoed:
            print(f"[ai-waiter-service] ⚠️ OpenAI echoed the menu hint → ignored: {oa!r}")
            oa = None
        print(f"[ai-waiter-service] 🅰🅱 openai {oa_ms}ms → {oa!r} | groq {gq_ms}ms → {gq!r}")
        try:
            DB.stt_ab.insert_one({
                "ts": datetime.utcnow(), "tenant": tenant, "session": session, "lang": lang,
                "wav": Binary(pcm16_mono_to_wav_bytes(pcm_bytes, rate=rate)),
                "results": {
                    "openai_mini+menu": {"text": oa, "ms": oa_ms},
                    "groq": {"text": gq, "ms": gq_ms},
                },
            })
        except Exception as e:
            print("[ai-waiter-service] ⚠️ stt_ab save failed:", e)
        if oa:
            return oa, "openai"
        if echoed:
            return None, "unclear"
        return gq, "groq"
    if OPENAI_STT_ON:
        t0 = time.monotonic()
        prompt = stt_prompt(tenant, lang)
        just = stt_turn_hint(tenant, session, lang)
        if just:  # the dishes just named lead the hint (they're the likeliest words this turn)
            prompt = f"{just}। {prompt}" if lang != "en" else f"{just}. {prompt}"
        text = await openai_transcribe(pcm_bytes, lang, rate=rate, prompt=prompt)
        print(f"[ai-waiter-service] OpenAI STT ({OPENAI_STT_MODEL}) {time.monotonic() - t0:.2f}s → {text!r}")
        if is_prompt_echo(text, prompt):
            # it heard nothing clear and repeated its hint — Groq would only invent words for the same audio
            print("[ai-waiter-service] ⚠️ OpenAI echoed the menu hint → nothing clear was said")
            return None, "unclear"
        if text:
            return text, "openai"
    text = await groq_transcribe(pcm_bytes, lang, rate=rate)
    return text, "groq"


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


_WEATHER_CACHE: Dict[Tuple[float, float], Tuple[float, str]] = {}
WEATHER_TTL_S = 15 * 60


async def fetch_weather_bucket(lat: float, lon: float) -> Optional[str]:
    """
    Tiny helper: classify current temp into a climate bucket.
    Uses Open-Meteo-style API; safe no-op on failure.
    Cached per ~1 km cell — weather barely moves in minutes, so a turn shouldn't wait on the API.
    """
    key = (round(lat, 2), round(lon, 2))
    hit = _WEATHER_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < WEATHER_TTL_S:
        return hit[1]
    bucket = await _fetch_weather_bucket(lat, lon)
    if bucket is not None:
        _WEATHER_CACHE[key] = (time.monotonic(), bucket)
    return bucket


async def _fetch_weather_bucket(lat: float, lon: float) -> Optional[str]:
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


_TENANT_ID_CACHE: Dict[str, Tuple[float, ObjectId]] = {}
TENANT_ID_TTL_S = 10 * 60


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

    # slug → _id doesn't change, and one turn resolves it several times (menu, kitchen, stats…)
    hit = _TENANT_ID_CACHE.get(tenant_hint)
    if hit and time.monotonic() - hit[0] < TENANT_ID_TTL_S:
        return hit[1]
    oid = _lookup_tenant_id(tenant_hint)
    if oid is not None:
        _TENANT_ID_CACHE[tenant_hint] = (time.monotonic(), oid)
    return oid


def _lookup_tenant_id(tenant_hint: str) -> Optional[ObjectId]:
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


def fetch_menu_snapshot(
    tenant: Optional[str],
    limit: int = MENU_SNAPSHOT_MAX,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    lang: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
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
                "compareAtPrice": 1,
                "description": 1,
                "variations": 1,
                "options": 1,
                "modifierGroups": 1,
                "sortOrder": 1,
                "signature": 1,
                "prepMinutes": 1,
                "categoryId": 1,
                "category": 1,
                "visibility": 1,
                "status": 1,
                "hidden": 1,
                "aliases": 1,
                "tags": 1,
                "availability": 1,
                "offline": 1,
                "servicePeriodIds": 1,
                "availableFrom": 1,
                "availableUntil": 1,
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
                    "compareAtPrice": d.get("compareAtPrice"),
                    "description": d.get("description") or "",
                    "variations": d.get("variations") or [],
                    "options": d.get("options") or [],
                    "modifierGroups": d.get("modifierGroups") or [],
                    "sortOrder": d.get("sortOrder"),
                    "signature": bool(d.get("signature")),
                    "prepMinutes": d.get("prepMinutes"),
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
                    "availability": d.get("availability") or [],
                    "offline": bool(d.get("offline")),
                    "servicePeriodIds": d.get("servicePeriodIds") or [],
                    "availableFrom": d.get("availableFrom"),
                    "availableUntil": d.get("availableUntil"),
                }
            )

        # Time-based availability: opening hours, category/item hours, sold out
        tenant_oid = q.get("tenantId")
        if tenant_oid is not None and items:
            menu_db = _CLIENT[MENU_DB_NAME]
            loc_id = resolve_location_id(menu_db, tenant_oid, branch)
            rules = load_rules(menu_db, tenant_oid, loc_id, channel)
            now = now or datetime.utcnow()
            for it in items:
                reason = unavailable_reason(it, rules, now=now, lang=(lang or "en"))
                if reason:
                    it["available"] = False
                    it["unavailableReason"] = reason

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


def bangla_menu_words(snapshot: Dict[str, Any]) -> List[str]:
    """Every word of the menu's dish names as a Bangla speaker says it ("Onion Ring" → অনিয়ন, রিং)."""
    from bn_translit import word_to_bn

    out: List[str] = []
    seen: set = set()
    for it in snapshot.get("items", []):
        for w in re.findall(r"[A-Za-z]{3,}", str(it.get("name") or "")):
            bn = word_to_bn(w)
            if bn and len(bn) >= 3 and bn not in seen:
                seen.add(bn)
                out.append(bn)
    return out


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
        if it.get("available") is False:  # closed / not served now / sold out
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


# ---------- Restaurant profile (facts the waiter may state) ----------

STAFF_ALERTS_ENABLED = os.environ.get("STAFF_ALERTS_ENABLED", "0") == "1"
PROFILE_TTL_S = float(os.environ.get("RESTAURANT_PROFILE_TTL_S", "60"))
_PROFILE_CACHE: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}


def fetch_restaurant_profile(tenant: Optional[str], branch: Optional[str] = None) -> Dict[str, Any]:
    """Name, address, hours, channels, menu notes and house knowledge (cached for a minute)."""
    key = (tenant or "", branch or "")
    hit = _PROFILE_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < PROFILE_TTL_S:
        return hit[1]

    profile: Dict[str, Any] = {"staffAlerts": STAFF_ALERTS_ENABLED}
    try:
        tenant_oid = resolve_tenant_id(tenant)
        if tenant_oid is not None:
            menu_db = _CLIENT[MENU_DB_NAME]
            t = menu_db["tenants"].find_one(
                {"_id": tenant_oid},
                {"name": 1, "restaurantInfo": 1, "menuNotes": 1, "waiterKnowledge": 1, "timezone": 1, "openingHours": 1, "servicePeriods": 1, "kitchen": 1, "waiterLanguage": 1},
            ) or {}
            info = t.get("restaurantInfo") or {}
            opening = t.get("openingHours") or []
            profile.update(
                {
                    "name": t.get("name"),
                    "type": info.get("restaurantType"),
                    "address": info.get("address"),
                    "phone": info.get("phone"),
                    "dineIn": info.get("dineInEnabled", True) is not False,
                    "online": bool(info.get("onlineSalesEnabled")),
                    "menuNotes": [n for n in (t.get("menuNotes") or []) if n],
                    "knowledge": [k for k in (t.get("waiterKnowledge") or []) if k],
                    "tz": t.get("timezone") or DEFAULT_TZ,
                    "periods": t.get("servicePeriods") if isinstance(t.get("servicePeriods"), list) else DEFAULT_PERIODS,
                    "kitchen": wait_time.kitchen_settings(t),
                    "language": t.get("waiterLanguage") if t.get("waiterLanguage") in ("bn", "en") else "bn",
                }
            )
            loc_id = resolve_location_id(menu_db, tenant_oid, branch)
            if loc_id is not None:
                loc = menu_db["locations"].find_one({"_id": loc_id}, {"name": 1, "address": 1, "openingHours": 1}) or {}
                profile["branch"] = loc.get("name")
                if loc.get("address"):
                    profile["address"] = loc["address"]
                if isinstance(loc.get("openingHours"), list) and loc["openingHours"]:
                    opening = loc["openingHours"]
            profile["opening"] = opening
            profile["hours"] = format_windows(opening) if opening else ""
    except Exception as e:
        print("[ai-waiter-service] ⚠️ restaurant profile failed:", e)

    _PROFILE_CACHE[key] = (time.monotonic(), profile)
    return profile


def current_meal_period(periods: List[Dict[str, Any]], tz: Optional[str], now: Optional[datetime] = None) -> Tuple[str, List[str]]:
    """Restaurant's own service periods (Settings → Hours) active right now, e.g. 'Lunch (12pm–3pm)'."""
    active = []
    for p in periods or []:
        try:
            win = [{"days": p.get("days") or [0, 1, 2, 3, 4, 5, 6], "start": p["start"], "end": p["end"]}]
        except (KeyError, TypeError):
            continue
        if is_within(win, tz, now):
            active.append((p.get("name") or "Service", format_windows(win)))
    label = ", ".join(f"{n} ({w})" for n, w in active) or "between service periods"
    return label, [n for n, _ in active]


ORDER_STATS_TTL_S = float(os.environ.get("ORDER_STATS_TTL_S", "600"))
ORDER_STATS_DAYS = int(os.environ.get("ORDER_STATS_DAYS", "90"))
_ORDER_STATS_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def order_stats(tenant: Optional[str]) -> Dict[str, Any]:
    """Popularity + ordered-together counts from this restaurant's real orders (last 90 days).
    Empty until orders exist; the recommender then simply ignores it. Cached for 10 minutes."""
    key = tenant or ""
    hit = _ORDER_STATS_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < ORDER_STATS_TTL_S:
        return hit[1]
    out: Dict[str, Any] = {"popularity": {}, "pairs": {}}
    try:
        tenant_oid = resolve_tenant_id(tenant)
        if tenant_oid is not None:
            since = datetime.utcnow() - timedelta(days=ORDER_STATS_DAYS)
            cur = _CLIENT[MENU_DB_NAME]["orders"].find(
                {"tenantId": tenant_oid, "createdAt": {"$gte": since}, "status": {"$ne": "cancelled"}},
                {"items.itemId": 1},
            ).limit(20000)
            stats = OrderStats.from_orders(cur)
            out = {"popularity": stats.popularity, "pairs": stats.pairs}
    except Exception as e:
        print("[ai-waiter-service] ⚠️ order stats failed:", e)
    _ORDER_STATS_CACHE[key] = (time.monotonic(), out)
    return out


KITCHEN_STALE_S = 3 * 60 * 60  # an order "open" for longer is a forgotten ticket, not kitchen load


def kitchen_now(
    tenant: Optional[str], branch: Optional[str], session_id: Optional[str], settings: Dict[str, int],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Live kitchen view for wait-time answers: minutes until a kitchen station is free, and this guest's own
    orders still in the kitchen (status + minutes left, from the ETA auth-service keeps on every order)."""
    now = now or datetime.utcnow()
    out: Dict[str, Any] = {"queueMinutes": 0, "ordersInKitchen": 0, "busy": "quiet", "myOrders": [], "settings": settings}
    try:
        tenant_oid = resolve_tenant_id(tenant)
        if tenant_oid is None:
            return out
        menu_db = _CLIENT[MENU_DB_NAME]
        q: Dict[str, Any] = {
            "tenantId": tenant_oid,
            "status": {"$in": ["placed", "accepted", "preparing", "ready"]},
            "createdAt": {"$gte": now - timedelta(seconds=KITCHEN_STALE_S)},
        }
        loc_id = resolve_location_id(menu_db, tenant_oid, branch)
        if loc_id is not None:
            q["locationId"] = loc_id
        docs = list(
            menu_db["orders"]
            .find(q, {"status": 1, "eta": 1, "items": 1, "sessionId": 1, "orderNumber": 1, "createdAt": 1})
            .sort("createdAt", 1)
            .limit(200)
        )
        ahead = []
        for o in docs:
            if o.get("status") == "ready":
                continue
            eta = o.get("eta") or {}
            prep = eta.get("prepMinutes") or wait_time.order_prep_minutes(
                (l.get("prepMinutes") or settings["defaultPrepMinutes"], int(l.get("qty") or 1)) for l in o.get("items") or []
            )
            ahead.append({"status": o.get("status"), "prepMinutes": prep, "readyAt": eta.get("readyAt"), "createdAt": o.get("createdAt")})
        queue = wait_time.queue_minutes(ahead, settings["parallelOrders"], now)
        active = [o for o in ahead if not wait_time.is_forgotten(o, now)]
        out.update({"queueMinutes": queue, "ordersInKitchen": len(active), "busy": wait_time.busy_level(queue)})
        for o in docs if session_id else []:
            if o.get("sessionId") != session_id:
                continue
            o_eta = o.get("eta") or {}
            ready_at = o_eta.get("readyAt")
            ready = o.get("status") == "ready"
            placed = o.get("status") == "placed"  # not accepted yet: no clock running
            out["myOrders"].append({
                "orderNumber": o.get("orderNumber"),
                "status": o.get("status"),
                "minutesLeft": 0 if ready else wait_time.minutes_left(ready_at, now),
                "late": (not ready) and (not placed) and isinstance(ready_at, datetime) and ready_at < now,
                "estimateMinutes": int((o_eta.get("queueMinutes") or 0) + (o_eta.get("prepMinutes") or 0)
                                       + max(0, o_eta.get("adjustedMinutes") or 0)),
                "hasEta": isinstance(ready_at, datetime),
                "items": [str(l.get("name") or "") for l in o.get("items") or []][:8],
            })
    except Exception as e:
        print("[ai-waiter-service] ⚠️ kitchen status failed:", e)
    return out


_SESSION_TENANT: Dict[str, str] = {}


def session_tenant(session_id: str) -> Optional[str]:
    """The restaurant this conversation belongs to: remembered in memory, else from its saved turns."""
    t = _SESSION_TENANT.get(session_id)
    if t:
        return t
    try:
        doc = COLL.find_one(
            {"session": session_id, "ai.meta.tenant": {"$nin": [None, ""]}},
            {"ai.meta.tenant": 1},
            sort=[("_id", -1)],
        )
        t = ((doc or {}).get("ai") or {}).get("meta", {}).get("tenant")
    except Exception as e:
        print("[ai-waiter-service] ⚠️ session tenant lookup failed:", e)
        t = None
    if t:
        _SESSION_TENANT[session_id] = t
    return t


def record_service_request(
    tenant: Optional[str],
    branch: Optional[str],
    session_id: Optional[str],
    channel: Optional[str],
    request: Dict[str, Any],
    text: str,
) -> None:
    """Persist bill/water/call-staff requests for a staff screen (only when paging is enabled)."""
    if not STAFF_ALERTS_ENABLED or not isinstance(request, dict):
        return
    try:
        DB.serviceRequests.insert_one(
            {
                "tenant": tenant,
                "branch": branch,
                "sessionId": session_id,
                "channel": channel,
                "type": request.get("type"),
                "note": request.get("note") or "",
                "utterance": text,
                "status": "open",
                "createdAt": datetime.utcnow(),
            }
        )
    except Exception as e:
        print("[ai-waiter-service] ⚠️ service request insert failed:", e)


# ---------- Placing orders (auth-service owns orders: pricing, availability, order numbers) ----------

AUTH_INTERNAL_URL = os.environ.get("AUTH_INTERNAL_URL", "http://auth-service:3001").rstrip("/")


def tenant_subdomain(tenant: Optional[str]) -> Optional[str]:
    """The public order endpoint is keyed by subdomain; the socket may know the tenant by id or slug."""
    if not tenant:
        return None
    oid = resolve_tenant_id(tenant)
    if not oid:
        return tenant
    for coll in (_CLIENT[MENU_DB_NAME]["tenants"], DB.tenants):
        try:
            t = coll.find_one({"_id": oid}, {"subdomain": 1})
            if t and t.get("subdomain"):
                return t["subdomain"]
        except Exception as e:
            print("[ai-waiter-service] ⚠️ subdomain lookup failed:", e)
    return tenant


async def place_order_via_api(
    *, tenant: Optional[str], branch: Optional[str], session_id: Optional[str], draft: Dict[str, Any]
) -> Dict[str, Any]:
    """POST /api/v1/public/orders → {"ok": True, "order": {...}} or {"ok": False, "message": str}.
    Idempotent per (session, cart signature): a repeated "yes" never creates a second order."""
    if not tenant_subdomain(tenant):
        # without a restaurant the order can't go anywhere — say so kindly, never "Validation failed"
        return {"ok": False, "message": ""}
    body: Dict[str, Any] = {
        "subdomain": tenant_subdomain(tenant),
        "table": draft.get("table"),
        "items": draft.get("items") or [],
        "sessionId": session_id,
        "source": "ai-waiter",
        "idempotencyKey": f"waiter:{(session_id or 'anon')[:60]}:{draft.get('signature') or ''}"[:100],
    }
    if branch:
        body["branch"] = branch
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(f"{AUTH_INTERNAL_URL}/api/v1/public/orders", json=body)
        data = r.json() if r.content else {}
    except Exception as e:
        print("[ai-waiter-service] ⚠️ place order failed:", repr(e))
        return {"ok": False, "message": "The ordering system didn't respond."}
    payload = data.get("data") if isinstance(data.get("data"), dict) else data
    order = (payload or {}).get("order")
    if r.status_code < 300 and isinstance(order, dict):
        created = bool((payload or {}).get("created", True))
        if created and tenant_subdomain(tenant):
            _set_alert(tenant_subdomain(tenant), True)
            print(f"[alert] 🔔 new order for {tenant_subdomain(tenant)} — buzzer triggered")
        return {"ok": True, "order": order, "created": created}
    msg = data.get("message") or f"HTTP {r.status_code}"
    details = data.get("error") if isinstance(data.get("error"), dict) else {}
    print("[ai-waiter-service] ⚠️ order rejected:", r.status_code, msg, details)
    return {"ok": False, "message": str(msg).rstrip(".") + ".", "needs": details.get("needs")}


# ---------- One guest turn (text → waiter reply) ----------

async def run_text_turn(
    *,
    text: str,
    tenant: Optional[str],
    branch: Optional[str],
    channel: Optional[str],
    session_id: Optional[str],
    user_id: Optional[str],
    locale: Optional[str],
    cart_items: Optional[List[Dict[str, Any]]] = None,
    user_tz: Optional[str] = None,
    user_local_hour: Optional[int] = None,
    climate_bucket: Optional[str] = None,
    now: Optional[datetime] = None,
    table: Optional[str] = None,
    place_order=None,
    shown: Optional[List[str]] = None,
    lock_language: bool = False,
) -> Dict[str, Any]:
    """
    `now` (UTC) overrides the clock — used by the eval to simulate breakfast/dinner/closed hours.
    `table` comes from the storefront (?table=12). `place_order` overrides the order placer (evals never
    create real orders). `lock_language`: always reply in `locale` (the language chosen on the storefront —
    the restaurant's default or the guest's switch) instead of mirroring what the guest spoke.
    Snapshot the live menu, normalise the transcript, build context and ask the brain.
    Used by the voice socket and by evals/run_eval.py. Returns {replyText, meta, textNorm, normChanges, snapshotSize}.
    """
    t_start = time.monotonic()
    lang = locale if lock_language and locale in ("bn", "en") else reply_language(text, locale)
    snapshot = fetch_menu_snapshot(tenant, limit=MENU_SNAPSHOT_MAX, branch=branch, channel=channel, lang=lang, now=now)
    vocab = build_vocab_from_snapshot(snapshot)
    # (Bangla word-snapping is OFF: it cut Bangla vowel signs off as punctuation and garbled correct words —
    # "সিজলিং" → "সিজলিংিং", "চিকেনটা" → "চিকেনা". gpt-4o-transcribe + the menu hint already write dish names right.)
    norm_text, changes = normalize_text(text, vocab=vocab, fuzzy_threshold=FUZZY_THRESHOLD)

    # history before this utterance (the brain gets the utterance itself separately)
    history = get_history(tenant, session_id)
    dialog_state = get_state(tenant, session_id)
    push_user(tenant, session_id, norm_text)

    profile = fetch_restaurant_profile(tenant, branch)
    ctx = build_runtime_context(
        tenant=tenant,
        branch=branch,
        channel=channel,
        lang_hint=lang,
        dialog_state=dialog_state,
        user_tz=user_tz or profile.get("tz"),
        climate_bucket=climate_bucket,
        user_local_hour=user_local_hour,
    )
    if profile.get("tz"):
        # recommendations follow the restaurant's clock, not the guest's phone
        now_local = local_now(profile["tz"], now)
        ctx["localTime"] = now_local.strftime("%a %H:%M")
        ctx["timeOfDay"] = _time_of_day_for_tz(profile["tz"], now_local.hour)
        ctx["mealPeriod"], period_names = current_meal_period(profile.get("periods") or DEFAULT_PERIODS, profile["tz"], now)
        ctx["mealKinds"] = meal_kinds(period_names, now_local.hour)
    if profile.get("opening"):
        ctx["openNow"] = is_within(profile["opening"], profile.get("tz"), now)

    if cart_items is None:
        cart_items = load_cart(tenant or "unknown", session_id or "anon") or []
    ctx["cartItems"] = [
        {
            "itemId": it.get("itemId") or it.get("id") or it.get("_id"),
            "quantity": int(it.get("qty") or it.get("quantity") or 0),
            "price": it.get("price"),
            "notes": it.get("notes") or "",
            "variation": it.get("variation") or "",
            "modifiers": [m for m in it.get("modifiers") or [] if isinstance(m, dict)],
        }
        for it in cart_items
        if int(it.get("qty") or it.get("quantity") or 0) > 0
    ]
    if table:
        ctx["table"] = str(table).strip()[:12]
    if shown:
        ctx["shownItems"] = list(shown)

    unavailable_now = [
        {"name": i.get("name"), "reason": i.get("unavailableReason")}
        for i in snapshot.get("items", [])
        if i.get("available") is False and i.get("unavailableReason")
    ]
    if unavailable_now:
        ctx["unavailableNow"] = unavailable_now

    ctx["orderStats"] = order_stats(tenant)  # popularity + ordered-together (empty until orders exist)
    # wait times: the kitchen queue right now + this guest's orders still in the kitchen
    ctx["kitchen"] = kitchen_now(tenant, branch, session_id, profile.get("kitchen") or wait_time.kitchen_settings(None), now)
    upsell_candidates = build_upsell_candidates(snapshot, ctx, {"items": ctx["cartItems"]}, limit=16)

    t_brain = time.monotonic()
    reply = await generate_reply(
        transcript=norm_text,
        tenant=tenant,
        branch=branch,
        channel=channel,
        locale=locale,
        menu_snapshot=snapshot,
        conversation_id=session_id,
        user_id=user_id,
        history=history,
        dialog_state=dialog_state,
        context=ctx,
        upsell_candidates=upsell_candidates,
        restaurant=profile,
        lock_language=lock_language,
    )
    t_post = time.monotonic()
    reply_text = reply.get("replyText") or ""
    meta = reply.get("meta") or {}
    meta["normalizer"] = {"changed": [{"from": a, "to": b, "score": s} for (a, b, s) in changes]}

    # The guest said yes to the read-back → place it for real, and say what actually happened.
    decision = meta.setdefault("decision", {})
    draft = meta.pop("orderDraft", None)
    if decision.get("placeOrder") and draft:
        placer = place_order or place_order_via_api
        res = await placer(tenant=tenant, branch=branch, session_id=session_id, draft=draft)
        lang_out = meta.get("language") or lang
        if res.get("ok"):
            order = res["order"]
            reply_text = checkout.placed_text(order, lang_out, wait_talk.placed_hint(order, lang_out))
            meta["order"] = {k: order.get(k) for k in ("token", "orderNumber", "status", "total", "table", "currency", "eta")}
            decision["orderPlaced"] = True
            decision["openConfirmationPage"] = True  # older storefronts open the confirmation view on this
        else:
            reply_text = checkout.failed_text(res.get("message") or "", lang_out)
            decision["orderFailed"] = True
            if res.get("needs") == "table":
                reply_text = checkout.ask_table_text(lang_out)
                meta["checkout"] = {"stage": "table", "sig": "", "table": ""}
        decision["placeOrder"] = False
        if lang_out == "bn":
            meta["voiceReplyText"] = reply_text

    # memory keeps exact English MENU names (keeps the model grounded) …
    push_assistant(tenant, session_id, reply_text)
    update_state(tenant, session_id, meta=meta, user_text=norm_text)
    # … while a Bangla guest reads and hears every name in Bangla script ("চিকেন চিলি অনিয়ন", not an English accent)
    if (meta.get("language") or lang) == "bn" and BN_SCRIPT_NAMES:
        # "Set Menu A-01" → "সেট মেনু 1" when every code on this menu uses the same letter (else "এ-1")
        code_letters = {
            m.group(1).upper()
            for it in snapshot.get("items", [])
            for m in re.finditer(r"\b([A-Za-z])\s*-\s*\d", str(it.get("name") or ""))
        }
        drop = len(code_letters) == 1
        # the voice is built from the reply itself — names and numbers converted by fixed rules
        # (the model's own spoken version misspelled numbers: "পঁইশ" for 25)
        voice_src = reply_text
        reply_text = to_bangla_script(reply_text, drop_code_letter=drop)
        meta["voiceReplyText"] = to_bangla_script(voice_src, spoken=True, drop_code_letter=drop)
    # the guest profile (allergies, diet…) stays in server memory — not sent to the browser or logged
    meta.pop("reco", None)
    meta.pop("guestProfile", None)
    meta.pop("tray", None)  # server-side memory (undo / pending questions), not for the browser
    if meta.get("serviceRequest"):
        record_service_request(tenant, branch, session_id, channel, meta["serviceRequest"], norm_text)

    return {
        "replyText": reply_text,
        "meta": meta,
        "textNorm": norm_text,
        "normChanges": changes,
        "snapshotSize": len(snapshot.get("items", [])),
        # where the turn's time went (menu/db prep → model → order placing & post-processing)
        "timingMs": {
            "prep": int((t_brain - t_start) * 1000),
            "brain": int((t_post - t_brain) * 1000),
            "post": int((time.monotonic() - t_post) * 1000),
        },
    }


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
    table_hint: Optional[str] = None
    cart_hint: Optional[List[Dict[str, Any]]] = None  # None → the saved cart (load_cart)
    shown_hint: List[str] = []  # ids of the dishes on the guest's screen ("which of these…")

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
    typed_text: Optional[str] = None  # a tapped answer ({"t": "say"}) instead of speech
    # hands-free: the server hears when the guest finished (or that nobody spoke) — see endpointer.py
    ep: Optional[endpointer.Endpointer] = None
    cancelled = False  # nobody spoke in a listen window / the app cancelled → no turn, no reply
    said_hello = False  # a connection that never introduced itself gets no "please repeat" (nobody is there)

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
                if ep is not None:
                    try:
                        heard = ep.push(bytes(msg))
                    except Exception as e:
                        print("[ai-waiter-service] endpointer failed → tap to send:", e)
                        ep, heard = None, None
                    if heard == "start":
                        try:
                            await ws.send(json.dumps({"t": "speech_start"}))
                        except Exception:
                            pass
                    elif heard == "end" and ep.listen_window and voiceprint.available():
                        # the mic reopened by itself: only THIS guest's answer counts — not the next table's
                        same, score = await asyncio.get_event_loop().run_in_executor(
                            None, voiceprint.same_guest, session_id, ep.speech_audio()
                        )
                        if same is False:
                            print(f"[ai-waiter-service] 🗣️ listen window: a different voice (match {score:.2f}) → ignored")
                            try:
                                await ws.send(json.dumps({"t": "no_speech"}))
                            except Exception:
                                pass
                            cancelled = True
                            break
                        if score is not None:
                            print(f"[ai-waiter-service] 🗣️ listen window: the guest's voice (match {score:.2f})")
                    if heard == "end":
                        # they stopped talking → answer now (the app shows "Thinking…", no tap needed)
                        print("[ai-waiter-service] 🎙️ end of speech (auto)")
                        try:
                            await ws.send(json.dumps({"t": "auto_end"}))
                        except Exception:
                            pass
                        closing = True
                        break
                    elif heard == "silence":
                        # the listen window after a question passed and nobody spoke — close quietly
                        print("[ai-waiter-service] 🤫 nobody spoke in the listen window → closed, no reply")
                        try:
                            await ws.send(json.dumps({"t": "no_speech"}))
                        except Exception:
                            pass
                        cancelled = True
                        break

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

            if t in ("hello", "start"):
                msg_type = t  # for logging
                said_hello = True

                session_id = data.get("sessionId") or session_id
                user_id = data.get("userId") or user_id
                rate = int(data.get("rate", 16000))
                ch = int(data.get("ch", 1))

                # language hint: 'bn' | 'en' | 'auto'
                lang_hint = data.get("lang")
                if isinstance(lang_hint, str) and lang_hint:
                    v = lang_hint.strip().lower()
                    # "auto" → None (means auto-detect), otherwise lock to bn/en
                    session_lang = None if v == "auto" else v

                tenant_hint = data.get("tenant") or tenant_hint
                # a mic that didn't say which restaurant (a pop-up on a path link) → this conversation's restaurant;
                # never run a turn unscoped (it would read every restaurant's menu and place orders with no restaurant)
                sid_now = data.get("sessionId") or session_id
                if tenant_hint:
                    if sid_now:
                        _SESSION_TENANT[sid_now] = tenant_hint
                elif sid_now:
                    tenant_hint = session_tenant(sid_now)
                    if tenant_hint:
                        print(f"[ai-waiter-service] no tenant from the app → this conversation's: {tenant_hint}")
                # no auto-detection: the app's switch, else the restaurant's default language, else Bangla —
                # the speech model is always told which language to expect
                if session_lang not in ("bn", "en"):
                    try:
                        session_lang = fetch_restaurant_profile(tenant_hint).get("language") or "bn"
                    except Exception:
                        session_lang = "bn"
                    print(f"[ai-waiter-service] language (no auto-detect) → {session_lang}")
                branch_hint = data.get("branch") or branch_hint
                channel_hint = data.get("channel") or channel_hint
                # the guest's table (?table=12) and the cart exactly as the guest sees it (sizes, add-ons)
                if isinstance(data.get("table"), (str, int)) and str(data.get("table")).strip():
                    table_hint = str(data.get("table")).strip()[:12]
                if isinstance(data.get("cart"), list):
                    cart_hint = [c for c in data["cart"] if isinstance(c, dict)][:100]
                # the dishes on the guest's screen right now (suggestions pop-up / the tray's picks)
                if isinstance(data.get("shown"), list):
                    shown_hint = [str(x) for x in data["shown"] if isinstance(x, (str, int))][:12]

                # hands-free: end the turn when the guest stops talking; `listenMs` = a listen window after a
                # question (nobody speaks → closed quietly)
                if data.get("autoEnd") and ep is None and endpointer.available():
                    lm = data.get("listenMs")
                    ep = endpointer.Endpointer(
                        rate=rate, listen_ms=int(lm) if isinstance(lm, (int, float)) and lm > 0 else None,
                        # this guest's voice level from their last turn — the next table's talk is far quieter
                        ref_db=_VOICE_LEVEL.get(sid_now or ""),
                    )

                # ⭐ user timezone & geo from frontend
                tz = data.get("tz")
                if isinstance(tz, str) and tz:
                    user_tz = tz

                geo = data.get("geo")
                if isinstance(geo, dict):
                    lat = geo.get("lat")
                    lon = geo.get("lon")
                    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                        user_geo = {"lat": float(lat), "lon": float(lon)}

                # ⭐ localHour snapshot from frontend
                lh = data.get("localHour")
                if isinstance(lh, (int, float)):
                    lh = int(lh)
                    if 0 <= lh < 24:
                        user_local_hour = lh

                print(
                    f"[ai-waiter-service] {msg_type} session={session_id} user={user_id} "
                    f"rate={rate} ch={ch} lang={session_lang or 'auto'}"
                )
                print(
                    f"[ai-waiter-service] context: tenant={tenant_hint} "
                    f"branch={branch_hint} channel={channel_hint} tz={user_tz} "
                    f"geo={user_geo} localHour={user_local_hour}"
                )
                continue

            # the guest flipped the language switch while this socket is open
            if t == "set_lang":
                v = str(data.get("lang") or "").strip().lower()
                if v in ("bn", "en"):
                    session_lang = v
                    print(f"[ai-waiter-service] language switched → {v}")
                continue

            if t == "end":
                closing = True
                print(
                    "[ai-waiter-service] received end → finalizing"
                )
                break

            # the guest TAPPED an answer ("which one?" → "2টা Beef Sizzling দিন"): the same turn as speech,
            # minus the speech recognition — the words are exactly the menu's
            # the app stopped listening without a turn (e.g. the guest tapped away) — nothing to answer
            if t == "cancel":
                cancelled = True
                break

            if t == "say":
                said = re.sub(r"\s+", " ", str(data.get("text") or "")).strip()[:300]
                if said:
                    typed_text = said
                    closing = True
                    print(f"[ai-waiter-service] typed turn: {said}")
                    break
                continue

        # Small drain: let worker finish in-flight chunk (~300ms)
        t0 = time.monotonic()
        t_turn = t0  # guest finished speaking → timing starts here
        while not work_q.empty() and (time.monotonic() - t0) < 0.3:
            await asyncio.sleep(0.01)

        # learn this guest's VOICE from a turn they started themselves (a tap) — never from a listen window, so a
        # stray voice can't teach us the wrong person (voiceprint.py)
        if ep is not None and session_id and ep.started and not ep.listen_window and not cancelled:
            try:
                await asyncio.get_event_loop().run_in_executor(None, voiceprint.learn, session_id, ep.speech_audio())
            except Exception as e:
                print("[ai-waiter-service] voiceprint learn failed:", e)

        # remember how loud this guest speaks (same phone, same distance) — the bar for their next listen window
        if ep is not None and session_id and ep.voice_level() is not None:
            lvl = ep.voice_level()
            old = _VOICE_LEVEL.get(session_id)
            _VOICE_LEVEL[session_id] = lvl if old is None else (old + lvl) / 2
            if len(_VOICE_LEVEL) > 5000:
                _VOICE_LEVEL.pop(next(iter(_VOICE_LEVEL)))

        # Finalize (not when nobody spoke in a listen window / the app cancelled — no turn, no reply)
        if cancelled:
            print("[ai-waiter-service] no turn (cancelled / nobody spoke)")
        if not final_sent and not cancelled:
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
            lang_pref = session_lang or "bn"  # never auto-detected: the selected language (default Bangla)

            groq_used = False
            stt_engine = "groq"
            if typed_text:
                selected_text, groq_used, stt_engine = typed_text, True, "typed"
            elif (
                (GROQ_API_KEY or OPENAI_STT_ON)
                and len(final_bytes) >= 16000
                and not ws.closed
            ):
                try:
                    print(
                        f"[ai-waiter-service] lang preference for final: {lang_pref or 'auto'}"
                    )
                    groq_text, stt_engine = await cloud_transcribe(
                        final_bytes, lang_pref, rate=rate, tenant=tenant_hint, session=session_id
                    )

                    # wrong language entirely (Punjabi / Hindi script for a Bangla phrase) → the same audio again,
                    # this time told the language; still foreign → treated as not understood, never answered
                    if wrong_script(groq_text):
                        retry_lang = "en" if lang_pref == "en" else "bn"
                        print(f"[ai-waiter-service] foreign script ({groq_text[:40]}) → retry {retry_lang}")
                        fixed, stt_engine = await cloud_transcribe(
                            final_bytes, retry_lang, rate=rate, tenant=tenant_hint, session=session_id
                        )
                        groq_text = fixed if fixed and not wrong_script(fixed) else None

                    # single-retry on opposite language if obviously wrong
                    # Groq-only: Whisper sometimes answers in the wrong language → one retry.
                    # OpenAI writes mixed Bangla/English ordering ("choice of two curry … দিবেন") faithfully — keep it.
                    if (
                        stt_engine == "groq"
                        and not session_lang  # a selected language is never switched
                        and groq_text
                        and lang_pref == "bn"
                        and _LATIN.search(groq_text)
                        and not _BENGALI.search(groq_text)
                    ):
                        print(
                            "[ai-waiter-service] BN expected but got EN → retry en"
                        )
                        en_text, stt_engine = await cloud_transcribe(
                            final_bytes, "en", rate=rate, tenant=tenant_hint, session=session_id
                        )
                        if en_text:
                            groq_text = en_text
                    elif (
                        stt_engine == "groq"
                        and not session_lang  # a selected language is never switched
                        and groq_text
                        and lang_pref == "en"
                        and _BENGALI.search(groq_text)
                        and not _LATIN.search(groq_text)
                    ):
                        print(
                            "[ai-waiter-service] EN expected but got BN → retry bn"
                        )
                        bn_text, stt_engine = await cloud_transcribe(
                            final_bytes, "bn", rate=rate, tenant=tenant_hint, session=session_id
                        )
                        if bn_text:
                            groq_text = bn_text

                    if groq_text and (
                        (stt_engine == "openai" and not is_junk_transcript(groq_text))
                        or looks_sane(groq_text, lang_pref)
                    ):
                        selected_text = groq_text
                        groq_used = True
                        print(
                            f"[ai-waiter-service] ✅ using {stt_engine} final: {groq_text[:120]}"
                        )
                except Exception as e:
                    print(
                        "[ai-waiter-service] Groq finalize failed:",
                        e,
                    )

            # nothing was said → don't fall back to the local preview model's guesses ("Thank you.")
            if not selected_text and stt_engine not in ("no-speech", "unclear"):
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

            # never answer a hallucination, or backup-model text in another language than the one selected
            # (the main engine is told the language; the tiny local model invents English on noise)
            if selected_text and (
                is_hallucination(selected_text)
                or (not groq_used and not fits_language(selected_text, session_lang or "bn"))
            ):
                print(f"[ai-waiter-service] 🚫 not using '{selected_text[:60]}' (hallucination / wrong language) → ask again")
                selected_text = None
                stt_engine = "unclear"

            # the guest released the mic but (almost) no audio arrived — a quick tap, or the mic started late.
            # Answer anyway: a silent server left the guest staring at "Thinking…".
            if not selected_text and closing and len(final_bytes) < 16000 and stt_engine not in ("no-speech", "unclear"):
                stt_engine = "no-audio"
                if not said_hello:
                    # it never even said hello (a socket that died opening) — nobody to answer
                    print("[ai-waiter-service] empty connection without a hello → no reply")
                    cancelled = True

            # nothing clear was said → a polite "please say it again" (no guessing, no model call)
            if not selected_text and stt_engine in ("no-speech", "unclear", "no-audio") and not ws.closed and not cancelled:
                sorry_lang = "en" if session_lang == "en" else "bn"
                sorry = SORRY_REPEAT[sorry_lang]
                try:
                    await ws.send(json.dumps({"t": "ai_reply", "replyText": sorry, "meta": {
                        "language": sorry_lang, "intent": "chitchat", "topic": "other", "voiceReplyText": sorry,
                        "decision": {"showSuggestionsModal": False, "showUpsellTray": False},
                        "cartOps": [], "items": [], "suggestions": [], "guards": [stt_engine],
                    }}))
                    print(f"[ai-waiter-service] 🙏 {stt_engine} → asked the guest to repeat")
                except Exception:
                    pass

            if selected_text and not ws.closed:
                t_stt = time.monotonic()
                try:
                    await ws.send(json.dumps({"t": "ai_reply_pending"}))
                except Exception:
                    pass

                climate_bucket = None
                if user_geo:
                    climate_bucket = await fetch_weather_bucket(user_geo["lat"], user_geo["lon"])
                t_weather = time.monotonic()

                turn: Dict[str, Any] = {"replyText": "", "meta": {}, "textNorm": selected_text, "normChanges": []}
                try:
                    turn = await run_text_turn(
                        text=selected_text,
                        tenant=tenant_hint,
                        branch=branch_hint,
                        channel=channel_hint,
                        session_id=session_id,
                        user_id=user_id,
                        locale=(session_lang or "bn"),
                        user_tz=user_tz,
                        user_local_hour=user_local_hour,
                        climate_bucket=climate_bucket,
                        cart_items=cart_hint,
                        table=table_hint,
                        shown=shown_hint,
                        # the storefront's language (restaurant default or the guest's switch) decides the reply
                        lock_language=session_lang in ("bn", "en"),
                    )
                    meta = turn.get("meta") or {}
                    print(
                        f"[ai-waiter-service] 🧠 reply='{turn['replyText'][:80]}' intent={meta.get('intent')} "
                        f"topic={meta.get('topic')} fallback={meta.get('fallback')}"
                    )
                    if not ws.closed:
                        await ws.send(
                            json.dumps({"t": "ai_reply", "replyText": turn["replyText"], "meta": meta}, default=str)
                        )
                        print("[ai-waiter-service] ✅ ai_reply sent")
                    tm = turn.get("timingMs") or {}
                    print(
                        f"[timing] stt={int((t_stt - t_turn) * 1000)}ms ({stt_engine}) "
                        f"weather={int((t_weather - t_stt) * 1000)}ms prep={tm.get('prep')}ms brain={tm.get('brain')}ms "
                        f"post={tm.get('post')}ms total={int((time.monotonic() - t_turn) * 1000)}ms"
                    )
                except Exception as e:
                    print("[ai-waiter-service] ❌ waiter turn failed:", e)
                    import traceback

                    traceback.print_exc()
                    if not ws.closed:
                        try:
                            await ws.send(json.dumps({"t": "ai_reply_error", "message": "AI unavailable"}))
                        except Exception:
                            pass

                # store for finetune/export
                try:
                    await writer_q.put(
                        {
                            "user": user_id,
                            "session": session_id,
                            "text": selected_text,
                            "text_norm": turn.get("textNorm"),
                            "norm_changes": turn.get("normChanges"),
                            "segments": [],
                            "ts": datetime.utcnow(),
                            "status": "new",
                            "engine": stt_engine if groq_used else ("local-partial" if selected_segs == [] else "local-full"),
                            "ai": {"replyText": turn.get("replyText"), "meta": turn.get("meta")},
                            "tenant": tenant_hint,
                            "menu_snapshot_size": turn.get("snapshotSize"),
                        }
                    )
                except Exception as e:
                    print("[ai-waiter-service] writer queue error:", e)

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
