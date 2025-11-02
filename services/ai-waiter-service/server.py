# services/ai-waiter-service/server.py
import asyncio, json, os, time, re, io, wave
from datetime import datetime
import numpy as np
import websockets
from websockets.server import WebSocketServerProtocol
from faster_whisper import WhisperModel
from pymongo import MongoClient
from vad import Segmenter
import httpx
from typing import Dict, Any, List, Tuple, Optional, Deque
from bson import ObjectId  # ✅ NEW
from collections import defaultdict, deque  # (kept; unused now)

# ✅ NEW: rolling context/state helpers (same folder import)
from session_ctx import (
    get_history, push_user, push_assistant, get_state, update_state
)

# ✅ In-process brain (OpenAI gpt-4o-mini) call
from brain import generate_reply

# ✅ Normalizer (exact pairs + phonetic + fuzzy)
#   Make sure services/ai-waiter-service/normalizer.py exists
from normalizer import normalize_text

# ---------- Config ----------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")

# transcripts DB (stays in qravy)
TRANS_DB_NAME = os.environ.get("MONGO_DB", "qravy")

# menu DB (can be different, e.g., authDB)
MENU_DB_NAME = os.environ.get("MENU_DB", TRANS_DB_NAME)
MENU_COLL = os.environ.get("MENU_COLLECTION", "menu_items")

# 🔁 Session context (per tenant+session) ----------
MAX_TURNS = int(os.environ.get("SESSION_CTX_TURNS", "8"))  # still honored in session_ctx
SESSION_CTX: Dict[Tuple[str, str], Deque[Dict[str, str]]] = defaultdict(  # retained (unused here)
    lambda: deque(maxlen=MAX_TURNS)
)
def session_key(tenant: Optional[str], sid: Optional[str]) -> Tuple[str, str]:
    return ((tenant or "unknown").strip(), (sid or "anon").strip())

_CLIENT = MongoClient(MONGO_URI)

# Keep `DB` pointing to transcripts DB so the rest of the file works unchanged
DB = _CLIENT[TRANS_DB_NAME]
COLL = DB.transcripts

# Read menu from MENU_DB + MENU_COLLECTION
ITEMS = _CLIENT[MENU_DB_NAME][MENU_COLL]

# Early health check with retries (handles DNS/TLS warm-up / election)
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
    COLL.create_index("ts", expireAfterSeconds=30*24*3600, name="ttl_30d")
except Exception as e:
    print("[ai-waiter-service] TTL index create failed:", str(e))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")           # fast default
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")                  # "cuda" on GPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")     # "float16" on GPU
WHISPER_LANG = os.environ.get("WHISPER_LANG", "bn")               # default preference

# Groq (final transcription)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3")
GROQ_BASE = os.environ.get("GROQ_BASE", "https://api.groq.com")
GROQ_TIMEOUT_MS = int(os.environ.get("GROQ_TIMEOUT_MS", "3000"))  # 3s budget

# Silence → finalize threshold (ms)
IDLE_FINALIZE_MS = int(os.environ.get("IDLE_FINALIZE_MS", "1200"))

# Normalizer knobs
FUZZY_THRESHOLD = float(os.environ.get("NORMALIZER_FUZZY_THRESHOLD", "0.83"))
MENU_SNAPSHOT_MAX = int(os.environ.get("MENU_SNAPSHOT_MAX", "120"))  # max items sent to brain per turn
VOCAB_MAX = int(os.environ.get("NORMALIZER_VOCAB_MAX", "200"))       # cap vocab for fuzzy speed
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
    Configure via:
      TRANSCRIPT_FLUSH_N   (default: 1 in dev, 10 in prod)
      TRANSCRIPT_FLUSH_MS  (default: 1500)
    """
    import time as _time

    FLUSH_N = int(os.environ.get("TRANSCRIPT_FLUSH_N", "1"))      # dev-friendly default: 1
    FLUSH_MS = int(os.environ.get("TRANSCRIPT_FLUSH_MS", "1500")) # dev-friendly default: 1.5s

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
            # time-based flush
            if (_time.monotonic() - last_flush) * 1000 >= FLUSH_MS:
                await do_flush()
            continue

        if item is None:
            # shutdown: final flush
            await do_flush()
            print("[ai-waiter-service] writer shutdown complete")
            break

        buf.append(item)
        now = _time.monotonic()
        if len(buf) >= FLUSH_N or (_time.monotonic() - last_flush) * 1000 >= FLUSH_MS:
            await do_flush()

WRITER_TASK = None

# ---------- Helpers ----------
_LATIN = re.compile(r'[A-Za-z]')
_BENGALI = re.compile(r'[\u0980-\u09FF]')  # Bangla block

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
    with wave.open(bio, 'wb') as wf:
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
        url = GROQ_BASE.rstrip('/') + "/openai/v1/audio/transcriptions"
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

# ---------- Core STT ----------
def stt_np_float32(pcm_bytes: bytes, lang: Optional[str]):
    i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    if i16.size == 0:
        return "", [], None
    f32 = (i16.astype(np.float32) / 32768.0)

    segments, info = model.transcribe(
        f32,
        language=lang,                   # None -> auto; else "en"/"bn"
        task="transcribe",
        vad_filter=False,
        beam_size=1,
        best_of=1,
        without_timestamps=False,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
        log_prob_threshold=-1.0,
        compression_ratio_threshold=2.4,
        temperature=0.0,
        initial_prompt=(BANGLA_PROMPT if lang == "bn" else ""),
        suppress_blank=True,
    )

    text = []
    segs = []
    for seg in segments:
        txt = (seg.text or "").strip()
        if txt:
            text.append(txt)
            segs.append((seg.start, seg.end))

    result_text = " ".join(text)
    detected_lang = getattr(info, "language", None)

    hallucinations = {
        "thank you", "thanks for watching", "bye", "goodbye",
        "subscribe", "like and subscribe", "see you next time",
        "thanks", "thank you for watching"
    }
    norm = result_text.lower().strip()
    if norm in hallucinations and len(norm.split()) <= 4:
        print(f"[ai-waiter-service] ⚠️ detected generic filler: '{result_text}', ignoring")
        return "", [], detected_lang

    return result_text, segs, detected_lang

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
    into the actual ObjectId from tenants collections (qravy or MENU_DB).
    """
    if not tenant_hint:
        return None

    # 1) direct ObjectId-like
    try:
        return ObjectId(tenant_hint)
    except Exception:
        pass

    # 2) look in transcripts DB (qravy) tenants
    try:
        t = DB.tenants.find_one(
            {"$or": [
                {"slug": tenant_hint},
                {"subdomain": tenant_hint},
                {"code": tenant_hint},
                {"name": tenant_hint},
            ]},
            {"_id": 1}
        )
        if t and t.get("_id"):
            return t["_id"]
    except Exception as e:
        print("[ai-waiter-service] ⚠️ tenant lookup (qravy) failed:", e)

    # 3) look in MENU_DB.tenants (where your tenants actually live)
    try:
        menu_tenants = _CLIENT[MENU_DB_NAME]["tenants"]
        t2 = menu_tenants.find_one(
            {"$or": [
                {"slug": tenant_hint},
                {"subdomain": tenant_hint},
                {"code": tenant_hint},
                {"name": tenant_hint},
            ]},
            {"_id": 1}
        )
        if t2 and t2.get("_id"):
            return t2["_id"]
    except Exception as e:
        print("[ai-waiter-service] ⚠️ tenant lookup (MENU_DB) failed:", e)

    return None

# ---------- Menu snapshot & vocab ----------
def build_menu_query(tenant: Optional[str]) -> Dict[str, Any]:
    # 🔒 Visibility: equality-only on 'hidden' (Atlas rejects $ne/$exists/$expr on this field)
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
    Pulls a compact, real-time slice of the menu for grounding and vocab.
    Fields kept intentionally small to reduce tokens.
    """
    try:
        q = build_menu_query(tenant)
        print("[debug] menu query:", q)

        cur = ITEMS.find(
            q,
            {
                "_id": 1, "name": 1, "price": 1,
                "categoryId": 1, "category": 1,
                "visibility": 1, "status": 1, "hidden": 1,
                "aliases": 1
            },
        ).limit(limit)
        items = []
        for d in cur:
            vis = d.get("visibility") or {}
            dine_in_ok = vis.get("dineIn", vis.get("dinein", True)) is not False
            items.append({
                "id": str(d.get("_id")),
                "name": d.get("name"),
                "category_id": str(d.get("categoryId")) if d.get("categoryId") else None,
                "category": d.get("category"),
                "price": d.get("price"),
                "available": (not bool(d.get("hidden"))) and (d.get("status") == "active") and dine_in_ok,
                "aliases": d.get("aliases") or []
            })
        print("[debug] snapshot items count =", len(items))
        cats = {}
        for it in items:
            if it.get("category_id") or it.get("category"):
                k = it.get("category_id") or it.get("category")
                cats[k] = {
                    "id": it.get("category_id"),
                    "name": it.get("category"),
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
        return {"tenant_id": tenant, "updated_at": datetime.utcnow().isoformat() + "Z", "categories": [], "items": []}

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
    # Dedup & cap
    seen = set()
    out = []
    for w in vocab:
        if w not in seen:
            seen.add(w)
            out.append(w)
        if len(out) >= VOCAB_MAX:
            break
    return out

# ---------- Deterministic pre-match (snapshot → DB fallback) ----------
def _tokenize_lower(s: str) -> List[str]:
    s = (s or "").lower()
    # keep simple word tokens
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
    # build lenient OR of key bigrams/unigrams
    tokens = list(set(_tokenize_lower(text)))[:6]
    if not tokens:
        return []
    regexes = [{"name": {"$regex": re.escape(tok), "$options": "i"}} for tok in tokens]
    alias_regexes = [{"aliases": {"$elemMatch": {"$regex": re.escape(tok), "$options": "i"}}} for tok in tokens]
    q = {"$and": [q_base, {"$or": regexes + alias_regexes}]}
    print("[debug] DB fallback query:", q)
    cur = ITEMS.find(
        q,
        {"_id":1,"name":1,"price":1,"category":1,"categoryId":1,"aliases":1,"status":1,"hidden":1,"visibility":1},
    ).limit(limit)
    out = []
    for d in cur:
        vis = d.get("visibility") or {}
        dine_in_ok = vis.get("dineIn", vis.get("dinein", True)) is not False
        out.append({
            "id": str(d.get("_id")),
            "name": d.get("name"),
            "category_id": str(d.get("categoryId")) if d.get("categoryId") else None,
            "category": d.get("category"),
            "price": d.get("price"),
            "available": (not bool(d.get("hidden"))) and (d.get("status") == "active") and dine_in_ok,
            "aliases": d.get("aliases") or []
        })
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

    # If more than one similar item, mention a couple alts
    alts = [it.get("name") for it in items[1:3] if it.get("name")]
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
    menu_snapshot: Dict[str, Any],
    history: Optional[List[Dict[str, str]]] = None,   # ✅ NEW
    dialog_state: Optional[Dict[str, Any]] = None,    # ✅ NEW
    locale: Optional[str] = None,                     # ✅ NEW
):
    print(f"[ai-waiter-service] 🧠 calling brain for transcript_norm: '{transcript_norm[:80]}...'")
    reply_obj = {"replyText": "", "meta": {}}
    try:
        # Be forward/backward compatible with brain.generate_reply signature
        try:
            reply = await generate_reply(
                transcript=transcript_norm,
                tenant=tenant,
                branch=branch,
                channel=channel,
                locale=locale,                      # ✅ pass locale through
                menu_snapshot=menu_snapshot,        # ✅ live, compact, real-time
                conversation_id=session_id,
                user_id=user_id,
                history=history,                    # ✅ include context
                dialog_state=dialog_state,          # ✅ include compact state (if supported)
            )
        except TypeError:
            # Older brain.py without dialog_state
            reply = await generate_reply(
                transcript=transcript_norm,
                tenant=tenant,
                branch=branch,
                channel=channel,
                locale=locale,                      # ✅ pass locale through
                menu_snapshot=menu_snapshot,
                conversation_id=session_id,
                user_id=user_id,
                history=history,
            )

        reply_obj = {
            "replyText": reply.get("replyText") or "",
            "meta": reply.get("meta") or {},
        }
        print(f"[ai-waiter-service] 🧠 brain replyText: '{reply_obj['replyText'][:80]}...'")

        # 🔎 Log which model produced this reply
        mo = reply_obj.get("meta", {})
        print("[ai-waiter-service] model=", mo.get("model"),
              "lang=", mo.get("language"),
              "intent=", mo.get("intent"),
              "fallback=", mo.get("fallback"))

        if not ws.closed:
            await ws.send(json.dumps({
                "t": "ai_reply",
                "replyText": reply_obj["replyText"],
                "meta": {
                    **reply_obj["meta"],
                    "normalizer": {
                        "changed": [{"from": a, "to": b, "score": s} for (a, b, s) in norm_changes]
                    }
                },
            }))
            print("[ai-waiter-service] ✅ ai_reply sent")
        else:
            print("[ai-waiter-service] ⚠️ WS closed, cannot send ai_reply")
    except Exception as e:
        print(f"[ai-waiter-service] ❌ brain call failed: {e}")
        import traceback; traceback.print_exc()
        if not ws.closed:
            try:
                await ws.send(json.dumps({
                    "t": "ai_reply_error",
                    "message": "AI unavailable"
                }))
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

    if isinstance(session_lang, str) and session_lang.strip().lower() == "auto":
        session_lang = None

    seg = Segmenter(bytes_per_sec=rate*2, min_ms=500, max_ms=2000)

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
            text, _, det = await asyncio.get_event_loop().run_in_executor(None, stt_np_float32, chunk, session_lang)
            if det:
                last_detected_lang = det
            if text and not final_sent and not ws.closed:
                last_partial_text = text
                has_bn = bool(_BENGALI.search(text))
                has_en = bool(_LATIN.search(text))
                print(f"[ai-waiter-service] 🔍 partial='{text[:50]}' | has_bn={has_bn} has_en={has_en} | hint={session_lang} det={last_detected_lang}")

                try:
                    await ws.send(json.dumps({
                        "t": "stt_partial",
                        "text": text,
                        "ts": time.time()
                    }))
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
                # ✅ Respect client language hint: 'bn' | 'en' | 'auto'
                lang_hint = data.get("lang")
                if isinstance(lang_hint, str) and lang_hint:
                    v = lang_hint.strip().lower()
                    session_lang = None if v == "auto" else v  # None => auto
                tenant_hint = data.get("tenant") or tenant_hint
                branch_hint = data.get("branch") or branch_hint
                channel_hint = data.get("channel") or channel_hint

                print(f"[ai-waiter-service] hello session={session_id} user={user_id} rate={rate} ch={ch} lang={session_lang or 'auto'}")
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
            print(f"[ai-waiter-service] finalization: total_bytes={len(final_bytes)}, last_partial='{last_partial_text}' lang={session_lang or 'auto'}")

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
                vocab = build_vocab_from_snapshot(snapshot)

                # 🔧 NORMALIZE: exact → phonetic → fuzzy (with live vocab)
                norm_text, changes = normalize_text(selected_text, vocab=vocab, fuzzy_threshold=FUZZY_THRESHOLD)

                # ✅ Record USER turn into context
                push_user(tenant_hint, session_id, norm_text)

                # --------- Deterministic pre-match path ---------
                matches = _match_in_snapshot(norm_text, snapshot)
                if not matches:
                    matches = _db_fallback_search(tenant_hint, norm_text, limit=10)

                if matches:
                    # Compose deterministic reply and send immediately (skip LLM)
                    reply_text = _compose_availability_reply(matches, (session_lang or last_detected_lang or "en"))
                    # ✅ Stronger language tagging on deterministic path
                    final_lang = (session_lang or last_detected_lang)
                    if not final_lang:
                        # infer from the actual normalized text we’re replying to
                        final_lang = "bn" if _BENGALI.search(norm_text) else "en"
                    meta = {
                        "model": "deterministic",
                        "language": final_lang,
                        "intent": "availability_check",
                        "items": [
                            {"name": m.get("name"), "itemId": m.get("id"), "price": m.get("price")}
                            for m in matches[:5]
                        ],
                        "tenant": tenant_hint, "branch": branch_hint, "channel": channel_hint,
                        "fallback": False,
                        "source": "snapshot" if matches and matches[0] in snapshot.get("items", []) else "db"
                    }
                    try:
                        await ws.send(json.dumps({
                            "t": "ai_reply",
                            "replyText": reply_text,
                            "meta": {
                                **meta,
                                "normalizer": {
                                    "changed": [{"from": a, "to": b, "score": s} for (a, b, s) in changes]
                                }
                            },
                        }))
                        print("[ai-waiter-service] ✅ deterministic ai_reply sent")
                    except Exception as e:
                        print("[ai-waiter-service] ❌ failed to send deterministic ai_reply:", e)

                    # ✅ Update context + dialog state
                    push_assistant(tenant_hint, session_id, reply_text)
                    update_state(tenant_hint, session_id, meta=meta, user_text=norm_text)

                    # Persist transcript + deterministic answer
                    try:
                        await writer_q.put({
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
                        })
                    except Exception as e:
                        print("[ai-waiter-service] writer queue error:", e)

                    final_sent = True
                    # Short-circuit: do NOT call LLM
                    return

                # ---------------- LLM path ----------------
                try:
                    if not ws.closed:
                        await ws.send(json.dumps({"t": "ai_reply_pending"}))
                except Exception:
                    pass

                print("[ai-waiter-service] 🧠 starting brain task…")
                last_ai = {"replyText": "", "meta": {}}
                try:
                    # Build history + dialog state for the brain
                    history_list = get_history(tenant_hint, session_id)
                    dialog_state = get_state(tenant_hint, session_id)

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
                        history=history_list,         # ✅ pass rolling context
                        dialog_state=dialog_state,     # ✅ pass compact state
                        locale=(session_lang or last_detected_lang),  # ✅ NEW: honor selected language
                    )
                    print("[ai-waiter-service] 🧠 brain task completed")
                except Exception as e:
                    print(f"[ai-waiter-service] ❌ brain task failed: {e}")
                    import traceback; traceback.print_exc()

                # ✅ Update context + dialog state
                push_assistant(tenant_hint, session_id, last_ai.get("replyText") or "")
                update_state(tenant_hint, session_id, meta=last_ai.get("meta"), user_text=norm_text)

                try:
                    await writer_q.put({
                        "user": user_id,
                        "session": session_id,
                        "text": selected_text,
                        "text_norm": norm_text,
                        "norm_changes": changes,
                        "segments": [],
                        "ts": datetime.utcnow(),
                        "status": "new",
                        "engine": "groq" if groq_used else ("local-partial" if selected_segs == [] else "local-full"),
                        "ai": last_ai,                 # ← store AI reply+meta for export/finetune
                        "tenant": tenant_hint,
                        "menu_snapshot_size": len(snapshot.get("items", [])),
                    })
                except Exception as e:
                    print("[ai-waiter-service] writer queue error:", e)
                final_sent = True
            else:
                print("[ai-waiter-service] ⚠️ no usable final produced")

    except Exception as e:
        print(f"[ai-waiter-service] error in handle_conn: {e}")
        import traceback; traceback.print_exc()
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
        handle_conn, "0.0.0.0", port,
        max_size=None,
        ping_timeout=30,
        ping_interval=20,
        close_timeout=10
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
