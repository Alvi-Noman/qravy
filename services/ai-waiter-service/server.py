# services/ai-waiter-service/server.py
import asyncio
import io
import json
import os
import re
import time
import wave
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Set

import httpx
import numpy as np
import websockets
from bson import ObjectId  # ✅ NEW
from faster_whisper import WhisperModel
from pymongo import MongoClient
from vad import Segmenter
from websockets.server import WebSocketServerProtocol

# ✅ In-process brain (OpenAI gpt-4o-mini) call
from brain import generate_reply

# ✅ Normalizer (exact pairs + phonetic + fuzzy)
from normalizer import normalize_text

# ✅ Robust multilingual/phonetic/category-aware fallback search (wire-up)
from robust_search import robust_find  # <-- ADDED


# ---------- Config ----------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
TRANS_DB_NAME = os.environ.get("MONGO_DB", "qravy")
MENU_DB_NAME = os.environ.get("MENU_DB", TRANS_DB_NAME)
MENU_COLL = os.environ.get("MENU_COLLECTION", "menu_items")

# ⚙️ Tier flags (keep all tiers alive by default)
AI_DET_ENABLE = os.environ.get("AI_DET_ENABLE", "1") == "1"           # deterministic matcher on/off
AI_DYM_ENABLE = os.environ.get("AI_DYM_ENABLE", "1") == "1"           # did-you-mean suggestions
AI_LLM_ENABLE = os.environ.get("AI_LLM_ENABLE", "1") == "1"           # LLM tier
AI_DET_SHORTCIRCUIT = os.environ.get("AI_DET_SHORTCIRCUIT", "0") == "1"  # if 1, skip LLM when det matches

# 🕒 Did-You-Mean cooldown (ms) to avoid spam on repeated non-food utterances
AI_DYM_COOLDOWN_MS = int(os.environ.get("AI_DYM_COOLDOWN_MS", "3000"))

_CLIENT = MongoClient(MONGO_URI)
DB = _CLIENT[TRANS_DB_NAME]
COLL = DB.transcripts
ITEMS = _CLIENT[MENU_DB_NAME][MENU_COLL]


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

try:
    COLL.create_index("ts", expireAfterSeconds=30 * 24 * 3600, name="ttl_30d")
except Exception as e:
    print("[ai-waiter-service] TTL index create failed:", str(e))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANG = os.environ.get("WHISPER_LANG", "bn")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3")
GROQ_BASE = os.environ.get("GROQ_BASE", "https://api.groq.com")
GROQ_TIMEOUT_MS = int(os.environ.get("GROQ_TIMEOUT_MS", "3000"))

IDLE_FINALIZE_MS = int(os.environ.get("IDLE_FINALIZE_MS", "1200"))
FUZZY_THRESHOLD = float(os.environ.get("NORMALIZER_FUZZY_THRESHOLD", "0.83"))
MENU_SNAPSHOT_MAX = int(os.environ.get("MENU_SNAPSHOT_MAX", "120"))
VOCAB_MAX = int(os.environ.get("NORMALIZER_VOCAB_MAX", "200"))
INCLUDE_ALIASES = os.environ.get("NORMALIZER_INCLUDE_ALIASES", "1") == "1"

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

print(
    f"[ai-waiter-service] Loading Faster-Whisper model={WHISPER_MODEL} device={DEVICE} compute={COMPUTE_TYPE}"
)
model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)

writer_q: asyncio.Queue = asyncio.Queue()


async def writer():
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


# ---------- Tenant resolver ----------
def _to_object_id_maybe(x: Optional[str]) -> Optional[ObjectId]:
    if not x or not isinstance(x, str):
        return None
    try:
        return ObjectId(x)
    except Exception:
        return None


def resolve_tenant_id(tenant_hint: Optional[str]) -> Optional[ObjectId]:
    if not tenant_hint:
        return None
    try:
        return ObjectId(tenant_hint)
    except Exception:
        pass
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
def build_menu_query(tenant: Optional[str], branch: Optional[str] = None) -> Dict[str, Any]:
    q: Dict[str, Any] = {}
    if tenant:
        tenant_oid = resolve_tenant_id(tenant)
        if tenant_oid:
            q["tenantId"] = tenant_oid
    if branch:
        q["branch"] = branch
    return q


def fetch_menu_snapshot(tenant: Optional[str], branch: Optional[str] = None, limit: int = MENU_SNAPSHOT_MAX) -> Dict[str, Any]:
    try:
        q = build_menu_query(tenant, branch)
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
            },
        ).limit(limit)

        items = []
        for d in cur:
            vis = d.get("visibility") or {}
            dine_in_ok = vis.get("dineIn", vis.get("dinein", True)) is not False
            available = (not bool(d.get("hidden"))) and (d.get("status") == "active") and dine_in_ok
            items.append(
                {
                    "id": str(d.get("_id")),
                    "name": d.get("name"),
                    "category_id": str(d.get("categoryId")) if d.get("categoryId") else None,
                    "category": d.get("category"),
                    "price": d.get("price"),
                    "available": available,
                    "aliases": d.get("aliases") or [],
                }
            )

        cats = {}
        for it in items:
            if it.get("category_id") or it.get("category"):
                k = it.get("category_id") or it.get("category")
                cats[k] = {"id": it.get("category_id"), "name": it.get("category")}

        snapshot = {
            "tenant_id": tenant,
            "branch": branch,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "categories": [c for c in cats.values() if c.get("name")],
            "items": items,
        }
        return snapshot
    except Exception as e:
        print("[ai-waiter-service] ⚠️ fetch_menu_snapshot failed:", e)
        return {
            "tenant_id": tenant,
            "branch": branch,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "categories": [],
            "items": [],
        }


# ---------- NEW: vocab + deterministic helpers ----------
def _clean_term(s: Any) -> str:
    """Lightweight cleanup; tries normalize_text but never fails."""
    if not isinstance(s, str):
        return ""
    s2 = s.strip().lower()
    try:
        norm = normalize_text(s2)
        # normalize_text may return str OR (str, changes); handle both
        if isinstance(norm, tuple):
            s2 = norm[0] or s2
        elif isinstance(norm, str):
            s2 = norm or s2
    except Exception:
        pass
    return s2


def build_vocab_from_snapshot(snapshot: Dict[str, Any]) -> Set[str]:
    """
    Build a bounded vocabulary from the live menu snapshot to help the normalizer.
    Snapshot shape:
      {"items":[{"name": "...", "aliases":[...], "category": str|dict, ...}]}
    """
    vocab: Set[str] = set()
    items = (snapshot or {}).get("items", []) or []
    for it in items:
        name = _clean_term(it.get("name"))
        if name:
            vocab.add(name)

        aliases = it.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [aliases]
        for a in aliases:
            aa = _clean_term(a)
            if aa:
                vocab.add(aa)

        cat = it.get("category")
        if isinstance(cat, dict):
            cat = cat.get("name") or cat.get("slug")
        if isinstance(cat, str):
            cc = _clean_term(cat)
            if cc:
                vocab.add(cc)

    # trim junk + bound size
    vocab = {t for t in vocab if t and any(ch.isalnum() for ch in t) and len(t) >= 2}
    if len(vocab) > VOCAB_MAX:
        vocab = set(list(vocab)[:VOCAB_MAX])
    return vocab


def _availability_gate(doc: Dict[str, Any]) -> bool:
    """Mirror the snapshot 'available' logic for DB fallback."""
    vis = doc.get("visibility") or {}
    dine_in_ok = vis.get("dineIn", vis.get("dinein", True)) is not False
    return (not bool(doc.get("hidden"))) and (doc.get("status") == "active") and dine_in_ok


def _shape_menu_item(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return the same item shape used in your snapshot list."""
    return {
        "id": str(doc.get("_id")),
        "name": doc.get("name"),
        "category_id": str(doc.get("categoryId")) if doc.get("categoryId") else None,
        "category": doc.get("category"),
        "price": doc.get("price"),
        "available": _availability_gate(doc),
        "aliases": doc.get("aliases") or [],
    }


def _match_in_snapshot(norm_text: str, snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Deterministic, cheap pass:
    - exact/contains check against name and aliases
    - returns up to a few best candidates with 'available' ones first
    """
    q = (norm_text or "").strip().lower()
    if not q:
        return []
    items = (snapshot or {}).get("items", []) or []
    hits: List[Tuple[int, Dict[str, Any]]] = []

    for it in items:
        name = (it.get("name") or "").strip().lower()
        alias_list = it.get("aliases") or []
        if isinstance(alias_list, str):
            alias_list = [alias_list]
        alias_list = [str(a).strip().lower() for a in alias_list if isinstance(a, str)]

        score = 0
        if q == name:
            score = 100
        elif name and (q in name or name in q):
            score = 80
        else:
            for a in alias_list:
                if q == a:
                    score = max(score, 90)
                elif a and (q in a or a in q):
                    score = max(score, 70)
        if score > 0:
            if it.get("available"):
                score += 5
            hits.append((score, it))

    hits.sort(key=lambda x: x[0], reverse=True)
    return [h[1] for h in hits[:5]]


def _db_fallback_search(tenant_hint: Optional[str], norm_text: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    If snapshot didn’t produce a match, try a lightweight Mongo regex search
    on name and aliases, scoped by tenantId (if resolvable).
    """
    q: Dict[str, Any] = {}
    tenant_oid = resolve_tenant_id(tenant_hint) if tenant_hint else None
    if tenant_oid:
        q["tenantId"] = tenant_oid

    rx = {"$regex": re.escape(norm_text), "$options": "i"} if norm_text else {"$exists": True}
    q["$or"] = [{"name": rx}, {"aliases": rx}]

    try:
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
            },
        ).limit(limit)

        docs = list(cur)
        # light re-rank: available first, then containment
        scored: List[Tuple[int, Dict[str, Any]]] = []
        ql = (norm_text or "").lower()
        for d in docs:
            it = _shape_menu_item(d)
            s = 10
            nm = (it.get("name") or "").lower()
            if ql == nm:
                s += 50
            elif ql and (ql in nm or nm in ql):
                s += 30
            if it.get("available"):
                s += 5
            scored.append((s, it))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [x[1] for x in scored]
    except Exception as e:
        print("[ai-waiter-service] ⚠️ _db_fallback_search failed:", e)
        return []


def _compose_availability_reply(items: List[Dict[str, Any]], lang_hint: Optional[str]) -> str:
    lang = (lang_hint or "").lower()
    if not items:
        return "Not found."

    top = items[0]
    name = top.get("name") or "that item"
    price = top.get("price")
    price_str = f" (৳{price})" if isinstance(price, (int, float)) else ""

    if not top.get("available"):
        return "দুঃখিত, এই আইটেমটি এখন উপলব্ধ নয়।" if lang == "bn" else f"Sorry, **{name}** is currently unavailable."

    alts = [it.get("name") for it in items[1:3] if it.get("name") and it.get("available")]

    if lang == "bn":
        base = f"জি, **{name}** রয়েছে{price_str}। নেবেন কি?"
        if alts:
            base += f" কাছাকাছি আরও আছে: {', '.join(alts)}।"
        return base
    else:
        base = f"Yes — **{name}** is available{price_str}. Would you like to add one?"
        if alts:
            base += f" Similar options: {', '.join(alts)}."
        return base


# ---------- Product-ish heuristic (cheap, before robust_find) ----------
_EN_FOOD_RE = re.compile(
    r"\b(menu|burger|pizza|pasta|bir(y)?ani|shawarma|coffee|drink|combo|meal|fries|rice|wrap|sandwich|snack|dessert|shake|ice ?cream)\b",
    re.I,
)
_BN_FOOD_RE = re.compile(
    r"(মেনু|বার্গার|পিজা|পাস্তা|বিরিয়ানি|বিরিয়ানি|শাওয়ারমা|কফি|ড্রিঙ্ক|কম্বো|মিল|ফ্রাই|ভাত|র‍্যাপ|স্যান্ডউইচ|স্ন্যাকস|ডেজার্ট|শেক|আইসক্রীম)"
)

def _make_token_set(vocab: Set[str]) -> Set[str]:
    toks: Set[str] = set()
    for term in vocab:
        for t in re.split(r"\s+", term):
            t = t.strip()
            if len(t) >= 3:
                toks.add(t)
    # bound size a bit
    if len(toks) > 800:
        toks = set(list(toks)[:800])
    return toks

def _looks_producty(query_norm: str, vocab_tokens: Set[str]) -> bool:
    q = (query_norm or "").strip().lower()
    if not q or len(q) < 2:
        return False
    # keyword cues
    if _EN_FOOD_RE.search(q) or _BN_FOOD_RE.search(q):
        return True
    # overlap with menu/category tokens
    q_toks = [t for t in re.split(r"\s+", q) if len(t) >= 3]
    for t in q_toks:
        # substring either way (no expensive loops; bounded sets)
        for vt in vocab_tokens:
            if t in vt or vt in t:
                return True
    return False


# ✅ Call brain and push a WS message, and return reply object for DB
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
    menu_snapshot: Dict[str, Any]
):
    print(f"[ai-waiter-service] 🧠 calling brain for transcript_norm: '{transcript_norm[:80]}...'")
    reply_obj = {"replyText": "", "meta": {}}
    try:
        reply = await generate_reply(
            transcript_norm,
            tenant=tenant,
            branch=branch,
            channel=channel,
            locale=None,
            menu_snapshot=menu_snapshot,  # ✅ live, compact, real-time
            conversation_id=session_id,
            user_id=user_id,
        )
        reply_obj = {
            "replyText": reply.get("replyText") or "",
            "meta": reply.get("meta") or {},
        }
        print(f"[ai-waiter-service] 🧠 brain replyText: '{reply_obj['replyText'][:80]}...'")

        # 🔎 Log which model produced this reply
        mo = reply_obj.get("meta", {})
        print(
            "[ai-waiter-service] model=",
            mo.get("model"),
            "lang=",
            mo.get("language"),
            "intent=",
            mo.get("intent"),
            "fallback=",
            mo.get("fallback"),
        )

        if not ws.closed:
            await ws.send(
                json.dumps(
                    {
                        "t": "ai_reply",
                        "replyText": reply_obj["replyText"],
                        "meta": {
                            **reply_obj["meta"],
                            "normalizer": {
                                "changed": [{"from": a, "to": b, "score": s} for (a, b, s) in norm_changes]
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
                await ws.send(json.dumps({"t": "ai_reply_error", "message": "AI unavailable"}))
            except Exception as send_err:
                print(f"[ai-waiter-service] ❌ failed to send ai_reply_error: {send_err}")
    return reply_obj


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

    # 🔕 DYM spam control per-connection
    last_dym_ms: float = 0.0
    last_dym_norm: Optional[str] = None

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
                print(f"[ai-waiter-service] skipping short chunk: {len(chunk)} bytes")
                continue
            if rms_i16(chunk) < 350.0:
                print("[ai-waiter-service] skip low-energy chunk (silence/noise)")
                continue

            print(f"[ai-waiter-service] transcribing chunk bytes={len(chunk)} lang={session_lang or 'auto'}")

            # stt_np_float32 is expected to exist in your codebase
            text, _, det = await asyncio.get_event_loop().run_in_executor(None, stt_np_float32, chunk, session_lang)
            if det:
                last_detected_lang = det

            if text and not final_sent and not ws.closed:
                last_partial_text = text
                has_bn = bool(_BENGALI.search(text))
                has_en = bool(_LATIN.search(text))
                print(
                    f"[ai-waiter-service] 🔍 partial='{text[:50]}' | has_bn={has_bn} has_en={has_en} | hint={session_lang} det={last_detected_lang}"
                )
                try:
                    await ws.send(json.dumps({"t": "stt_partial", "text": text, "ts": time.time()}))
                    print("[ai-waiter-service] stt_partial:", text[:120])
                except Exception as e:
                    print("[ai-waiter-service] stt_partial send failed:", e)
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
                    print(f"[ai-waiter-service] idle {IDLE_FINALIZE_MS}ms → finalizing")
                    closing = True
                break
            except websockets.ConnectionClosed:
                print("[ai-waiter-service] connection closed by client")
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
                            work_q.get_nowait()  # fallthrough
                        # noqa
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

                # ✅ Respect client language hint: 'bn' | 'en' | 'auto'
                lang_hint = data.get("lang")
                if isinstance(lang_hint, str) and lang_hint:
                    v = lang_hint.strip().lower()
                    session_lang = None if v == "auto" else v  # None => auto

                tenant_hint = data.get("tenant") or tenant_hint
                branch_hint = data.get("branch") or branch_hint
                channel_hint = data.get("channel") or channel_hint

                print(
                    f"[ai-waiter-service] hello session={session_id} user={user_id} rate={rate} ch={ch} lang={session_lang or 'auto'}"
                )
                print(f"[ai-waiter-service] context: tenant={tenant_hint} branch={branch_hint} channel={channel_hint}")
                continue

            if t == "end":
                closing = True
                print("[ai-waiter-service] received end → finalizing")
                break

        # Small drain: let worker finish in-flight chunk (up to ~300ms)
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
                f"[ai-waiter-service] finalization: total_bytes={len(final_bytes)}, last_partial='{last_partial_text}' lang={session_lang or 'auto'}"
            )

            selected_text: Optional[str] = None
            selected_segs: List[Tuple[float, float]] = []

            # Preference: explicit (bn/en/auto) → detected → script of last_partial
            lang_pref = session_lang or last_detected_lang
            if not lang_pref and last_partial_text:
                if _BENGALI.search(last_partial_text):
                    lang_pref = "bn"
                elif _LATIN.search(last_partial_text):
                    lang_pref = "en"

            groq_used = False
            if GROQ_API_KEY and len(final_bytes) >= 16000 and not ws.closed:
                try:
                    print(f"[ai-waiter-service] lang preference for final: {lang_pref or 'auto'}")
                    print("[ai-waiter-service] calling Groq for final…")
                    groq_text = await groq_transcribe(final_bytes, lang_pref, rate=rate)

                    # Mismatch single-retry to the other side if user forced one
                    if groq_text and lang_pref == "bn" and _LATIN.search(groq_text) and not _BENGALI.search(groq_text):
                        print("[ai-waiter-service] BN expected but got EN → single retry en")
                        en_text = await groq_transcribe(final_bytes, "en", rate=rate)
                        if en_text:
                            groq_text = en_text
                    elif groq_text and lang_pref == "en" and _BENGALI.search(groq_text) and not _LATIN.search(groq_text):
                        print("[ai-waiter-service] EN expected but got BN → single retry bn")
                        bn_text = await groq_transcribe(final_bytes, "bn", rate=rate)
                        if bn_text:
                            groq_text = bn_text

                    if groq_text and looks_sane(groq_text, lang_pref):
                        selected_text = groq_text
                        groq_used = True
                        print("[ai-waiter-service] ✅ using Groq final")
                except Exception as e:
                    print("[ai-waiter-service] Groq finalize failed:", e)

            if not selected_text:
                if last_partial_text and looks_sane(last_partial_text, lang_pref):
                    selected_text = last_partial_text
                    selected_segs = []
                    print("[ai-waiter-service] ✅ using last sane partial as final")
                elif len(final_bytes) >= 16000:
                    print(f"[ai-waiter-service] fallback to local full transcription: {len(final_bytes)} bytes")
                    try:
                        local_text, segs, det = await asyncio.get_event_loop().run_in_executor(
                            None, stt_np_float32, final_bytes, session_lang
                        )
                        if det:
                            last_detected_lang = det
                        print(f"[ai-waiter-service] detected_lang(full)={last_detected_lang}")
                        if local_text:
                            selected_text = local_text
                            selected_segs = segs
                    except Exception as e:
                        print("[ai-waiter-service] local fallback failed:", e)

            if selected_text and not ws.closed:
                # 🔤 LIVE MENU SNAPSHOT (tenant-scoped, compact)
                snapshot = fetch_menu_snapshot(tenant_hint, limit=MENU_SNAPSHOT_MAX)
                print(f"[ai-waiter-service] snapshot items={len(snapshot.get('items', []))}")
                try:
                    vocab = list(build_vocab_from_snapshot(snapshot))
                except Exception as e:
                    print("[ai-waiter-service] ⚠️ build_vocab_from_snapshot failed:", e)
                    vocab = set()

                # Build token set for cheap product intent
                vocab_tokens = _make_token_set(set(vocab))

                # 🔧 NORMALIZE: exact → phonetic → fuzzy (with live vocab)
                norm_text, changes = normalize_text(
                    selected_text, vocab=vocab, fuzzy_threshold=FUZZY_THRESHOLD
                )

                # --------- Deterministic pre-match path (guarded) ---------
                matches: List[Dict[str, Any]] = []
                if AI_DET_ENABLE:
                    matches = _match_in_snapshot(norm_text, snapshot)
                    if not matches:
                        matches = _db_fallback_search(tenant_hint, norm_text, limit=10)

                if AI_DET_ENABLE and matches:
                    # Compose deterministic reply
                    reply_text = _compose_availability_reply(
                        matches, (session_lang or last_detected_lang or "en")
                    )
                    meta = {
                        "model": "deterministic",
                        "language": (session_lang or last_detected_lang or "en"),
                        "intent": "availability_check",
                        "items": [
                            {"name": m.get("name"), "itemId": m.get("id"), "price": m.get("price")}
                            for m in matches[:5]
                        ],
                        "tenant": tenant_hint,
                        "branch": branch_hint,
                        "channel": channel_hint,
                        "fallback": False,
                        "source": "snapshot",
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
                                                {"from": a, "to": b, "score": s} for (a, b, s) in changes
                                            ]
                                        },
                                    },
                                }
                            )
                        )
                        print("[ai-waiter-service] ✅ deterministic ai_reply sent")
                    except Exception as e:
                        print("[ai-waiter-service] ❌ failed to send deterministic ai_reply:", e)

                    # Persist transcript + deterministic answer
                    try:
                        await writer_q.put(
                            {
                                "user": user_id,
                                "session": session_id,
                                "text": selected_text,
                                "text_norm": norm_text,
                                "norm_changes": changes,
                                "segments": [],  # not tracking per-word here
                                "ts": datetime.utcnow(),
                                "status": "new",
                                "engine": "deterministic",
                                "ai": {"replyText": reply_text, "meta": meta},
                                "tenant": tenant_hint,
                                "menu_snapshot_size": len(snapshot.get("items", [])),
                            }
                        )
                    except Exception as e:
                        print("[ai-waiter-service] writer queue error:", e)

                    # 🔧 CONTROL: only stop here if you *want* to
                    if AI_DET_SHORTCIRCUIT:
                        final_sent = True
                        return

                # --------- Robust "Did you mean" (prepare only; decide after LLM) ---------
                robust_pending = None
                if AI_DYM_ENABLE:
                    try:
                        robust_pending = robust_find(
                            norm_text,
                            snapshot,
                            lang_hint=(session_lang or last_detected_lang),
                            max_results=8,
                        )
                    except Exception as e:
                        print("[ai-waiter-service] ⚠️ robust_find failed (prepare):", e)

                # ---------------- LLM path (guarded) ----------------
                if AI_LLM_ENABLE:
                    # Tell client we're about to think (so UI can show "thinking")
                    try:
                        if not ws.closed:
                            await ws.send(json.dumps({"t": "ai_reply_pending"}))
                    except Exception:
                        pass

                    print("[ai-waiter-service] 🧠 starting brain task…")
                    last_ai = {"replyText": "", "meta": {}}
                    try:
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
                        )
                        print("[ai-waiter-service] 🧠 brain task completed")
                    except Exception as e:
                        print(f"[ai-waiter-service] ❌ brain task failed: {e}")
                        import traceback

                        traceback.print_exc()

                    # ---------------- Decide if we should show Did-You-Mean (after LLM) ---------------
                    try:
                        if AI_DYM_ENABLE and robust_pending and robust_pending.get("matches"):
                            meta = (last_ai or {}).get("meta") or {}
                            intent = (meta.get("intent") or "").lower()
                            items = meta.get("items") or []
                            items_len = len(items)
                            fallback_flag = bool(meta.get("fallback"))

                            reply_text = (last_ai or {}).get("replyText", "") or ""
                            reply_lower = reply_text.strip().lower()

                            # BN/EN negative vs positive cues
                            implies_not_found = any(k in reply_lower for k in [
                                " নেই", "নেই", "পাওয়া যায় না",
                                "not found", "don’t have", "don't have", "do not have", "unavailable",
                            ])
                            implies_order_success = any(k in reply_lower for k in [
                                "অর্ডার করা হলো", "অর্ডার নিশ্চিত", "কার্টে যোগ", "ট্রেতে যোগ",
                                "order placed", "added to cart", "added to tray", "added to your order",
                            ])
                            implies_available_affirm = any(k in reply_lower for k in [
                                "পাওয়া যায়", "আছে", "রয়েছে", "উপলব্ধ",
                                "available", "we have", "in stock",
                            ])

                            # treat these as product intents too
                            PRODUCT_INTENTS = {"order", "order_inquiry", "menu", "menu_inquiry", "availability_check"}

                            # name overlap between LLM items and robust options (extra confidence)
                            llm_names = [(it.get("name") or "").strip().lower() for it in items]
                            robust_names = [(m.get("name") or "").strip().lower() for m in robust_pending.get("matches", [])]
                            overlap_with_robust = any(
                                rn and any((rn in ln) or (ln in rn) for ln in llm_names) for rn in robust_names
                            )

                            single_item_confident = (
                                (intent in PRODUCT_INTENTS) and
                                (items_len >= 1 or overlap_with_robust or implies_available_affirm) and
                                not fallback_flag
                            )
                            multi_item_confident  = (intent in PRODUCT_INTENTS and items_len >= 2 and not fallback_flag)

                            # uncertain only when no items, irrelevant intent, or explicit negatives
                            llm_uncertain = (items_len == 0) or (intent not in PRODUCT_INTENTS) or implies_not_found

                            now_ms = time.monotonic() * 1000.0
                            cooldown_ok = (now_ms - last_dym_ms) >= AI_DYM_COOLDOWN_MS or (last_dym_norm != norm_text)

                            if cooldown_ok and (not single_item_confident) and (not multi_item_confident) and (not implies_order_success) and llm_uncertain:
                                await ws.send(json.dumps({
                                    "t": "did_you_mean",
                                    "strategy": robust_pending.get("strategy"),
                                    "category": robust_pending.get("category_hit"),
                                    "options": robust_pending["matches"],
                                }))
                                last_dym_ms = now_ms
                                last_dym_norm = norm_text
                                print(f"[ai-waiter-service] ✅ did_you_mean sent after LLM ({len(robust_pending['matches'])} options)")
                            else:
                                print("[ai-waiter-service] ℹ️ did_you_mean suppressed "
                                      f"(intent={intent} items_len={items_len} fallback={fallback_flag} "
                                      f"avail_affirm={implies_available_affirm} overlap={overlap_with_robust})")
                    except Exception as e:
                        print("[ai-waiter-service] ⚠️ did_you_mean post-LLM decision failed:", e)

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
                                "engine": "groq" if groq_used else ("local-partial" if selected_segs == [] else "local-full"),
                                "ai": last_ai,  # ← store AI reply+meta for export/finetune
                                "tenant": tenant_hint,
                                "menu_snapshot_size": len(snapshot.get("items", [])),
                            }
                        )
                    except Exception as e:
                        print("[ai-waiter-service] writer queue error:", e)

                    final_sent = True
                else:
                    print("[ai-waiter-service] ⚠️ AI_LLM_ENABLE=0 → skipping LLM tier")
            else:
                print("[ai-waiter-service] ⚠️ no usable final produced")
    except Exception as e:
        print(f"[ai-waiter-service] error in handle_conn: {e}")
        import traceback

        traceback.print_exc()
    finally:
        closed.set()
        try:
            await work_q.put(None)
        except Exception:
            pass
        await asyncio.gather(wtask, return_exceptions=True)
        print("[ai-waiter-service] connection handler finished")


async def main():
    global WRITER_TASK
    WRITER_TASK = asyncio.create_task(writer())

    # Graceful shutdown on SIGTERM/SIGINT (Docker sends SIGTERM)
    import signal

    loop = asyncio.get_running_loop()

    def _schedule_shutdown():
        asyncio.create_task(shutdown())

    try:
        loop.add_signal_handler(signal.SIGTERM, _schedule_shutdown)
        loop.add_signal_handler(signal.SIGINT, _schedule_shutdown)
    except NotImplementedError:
        # Windows without proper signal support: rely on KeyboardInterrupt path below
        pass

    port = int(os.environ.get("PORT", "7071"))
    async with websockets.serve(
        handle_conn, "0.0.0.0", port, max_size=None, ping_timeout=30, ping_interval=20, close_timeout=10
    ):
        print(f"[ai-waiter-service] WS listening on :{port}")
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
