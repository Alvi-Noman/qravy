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

# ---------- Config ----------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
DB = MongoClient(MONGO_URI).qravy
COLL = DB.transcripts

# TTL (30 days) so transcripts auto-expire
try:
    COLL.create_index("ts", expireAfterSeconds=30*24*3600, name="ttl_30d")
except Exception as e:
    print("[ai-waiter-service] TTL index create failed:", str(e))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")     # fast default
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")            # "cuda" on GPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")  # "float16" on GPU
WHISPER_LANG = os.environ.get("WHISPER_LANG")               # e.g., "bn" for Bangla (None => auto)

# Groq (final transcription)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3")
GROQ_BASE = os.environ.get("GROQ_BASE", "https://api.groq.com")
GROQ_TIMEOUT_MS = int(os.environ.get("GROQ_TIMEOUT_MS", "3000"))  # 3s budget for fast UX

# Silence → finalize threshold (ms)
IDLE_FINALIZE_MS = int(os.environ.get("IDLE_FINALIZE_MS", "1200"))

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
    buf = []
    while True:
        item = await writer_q.get()
        if item is None:
            if buf:
                try:
                    COLL.insert_many(buf, ordered=False)
                    print(f"[ai-waiter-service] inserted batch={len(buf)} (shutdown)")
                except Exception as e:
                    print("[ai-waiter-service] insert_many error:", str(e))
            break
        buf.append(item)
        if len(buf) >= 10:
            try:
                COLL.insert_many(buf, ordered=False)
                print(f"[ai-waiter-service] inserted batch={len(buf)}")
            except Exception as e:
                print("[ai-waiter-service] insert_many error:", str(e))
            buf.clear()

WRITER_TASK = None

# ---------- Helpers ----------
_LATIN = re.compile(r'[A-Za-z]')
_BENGALI = re.compile(r'[\u0980-\u09FF]')  # Bangla block

def looks_sane(text: str, lang: str | None) -> bool:
    s = (text or "").strip()
    if len(s) < 4:
        return False
    generic = {"thank you", "thanks", "today", "ok", "okay"}
    if s.lower() in generic:
        return False
    if lang == "bn":
        return bool(_BENGALI.search(s))
    if lang == "en":
        return bool(_LATIN.search(s))
    # if lang unknown/auto, at least some recognizable letters
    return bool(_LATIN.search(s) or _BENGALI.search(s))

def rms_i16(b: bytes) -> float:
    if not b:
        return 0.0
    x = np.frombuffer(b, dtype=np.int16)
    if x.size == 0:
        return 0.0
    xf = x.astype(np.float32)
    return float(np.sqrt(np.mean(xf * xf)))

def pcm16_mono_to_wav_bytes(pcm_bytes: bytes, rate: int = 16000) -> bytes:
    """Wrap raw PCM16 mono @ rate into a WAV container for Groq upload."""
    bio = io.BytesIO()
    with wave.open(bio, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(rate)
        wf.writeframes(pcm_bytes)
    return bio.getvalue()

async def groq_transcribe(pcm_bytes: bytes, lang: str | None, rate: int = 16000) -> str | None:
    """Send audio to Groq Whisper v3 and return text (or None)."""
    if not GROQ_API_KEY:
        return None
    try:
        wav_bytes = pcm16_mono_to_wav_bytes(pcm_bytes, rate=rate)
        url = GROQ_BASE.rstrip('/') + "/openai/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        data = {"model": GROQ_MODEL, "response_format": "json"}
        # Auto-detect language unless explicitly forced (e.g., "en"/"bn")
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
def stt_np_float32(pcm_bytes: bytes, lang: str | None):
    """Int16 mono @16k -> float32 [-1,1] and transcribe."""
    i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    if i16.size == 0:
        return "", []
    f32 = (i16.astype(np.float32) / 32768.0)

    segments, info = model.transcribe(
        f32,
        language=lang,                   # None -> auto; else "en"/"bn" etc.
        task="transcribe",
        vad_filter=False,                # external segmentation
        beam_size=1,
        best_of=1,
        without_timestamps=False,
        condition_on_previous_text=False,
        no_speech_threshold=0.7,         # stricter to avoid silence junk
        log_prob_threshold=-0.5,         # reject low-confidence text
        compression_ratio_threshold=2.3, # reject repetitive output
        temperature=0.0,
        initial_prompt="",
        suppress_blank=True,             # reduce stray tokens ("Thank you")
    )

    text = []
    segs = []
    for seg in segments:
        txt = (seg.text or "").strip()
        if txt:
            text.append(txt)
            segs.append((seg.start, seg.end))

    result_text = " ".join(text)

    # Lightweight hallucination guard (keeps short, generic endings out)
    hallucinations = {
        "thank you", "thanks for watching", "bye", "goodbye",
        "subscribe", "like and subscribe", "see you next time",
        "thanks", "thank you for watching"
    }
    norm = result_text.lower().strip()
    if norm in hallucinations and len(norm.split()) <= 4:
        print(f"[ai-waiter-service] ⚠️ detected generic filler: '{result_text}', ignoring")
        return "", []

    return result_text, segs

async def handle_conn(ws: WebSocketServerProtocol):
    session_id = None
    user_id = "guest"
    rate = 16000
    ch = 1
    session_lang = WHISPER_LANG  # default from env (e.g., "bn") or None (auto)

    # Normalize "auto" to None internally
    if isinstance(session_lang, str) and session_lang.strip().lower() == "auto":
        session_lang = None

    # Bigger VAD windows: 0.5–2.0s → smoother partials
    seg = Segmenter(bytes_per_sec=rate*2, min_ms=500, max_ms=2000)

    # Last-wins work queue (maxsize=1). We always want the newest segment.
    work_q: asyncio.Queue = asyncio.Queue(maxsize=1)
    closed = asyncio.Event()

    all_pcm = bytearray()
    last_partial_text = None

    closing = False        # after we decide to finalize
    final_sent = False     # after stt_final is sent

    # Defensive cap for super long sessions (keep last ~60s)
    def cap_buffer():
        MAX_ACCUM_BYTES = 60 * rate * 2  # ~1.92MB at 16k mono int16
        nonlocal all_pcm
        if len(all_pcm) > MAX_ACCUM_BYTES:
            all_pcm = all_pcm[-MAX_ACCUM_BYTES:]

    async def worker():
        nonlocal last_partial_text, final_sent
        MIN_CHUNK_BYTES = 8000  # 0.25s guard; VAD emits 0.5–2.0s anyway

        while not closed.is_set():
            if final_sent:
                break  # stop work once we have a final
            chunk = await work_q.get()
            if chunk is None:
                break
            if final_sent:
                break

            # Skip tiny dribbles or near-silence (hallucination hotbed)
            if len(chunk) < MIN_CHUNK_BYTES:
                print(f"[ai-waiter-service] skipping short chunk: {len(chunk)} bytes")
                continue
            if rms_i16(chunk) < 350.0:   # tune 300–500 depending on mic
                print("[ai-waiter-service] skip low-energy chunk (silence/noise)")
                continue

            print(f"[ai-waiter-service] transcribing chunk bytes={len(chunk)} lang={session_lang or 'auto'}")
            text, _ = await asyncio.get_event_loop().run_in_executor(None, stt_np_float32, chunk, session_lang)
            if text and not final_sent and not ws.closed:
                last_partial_text = text
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
                await ws.send(json.dumps({ "t": "ack" }))
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

            # Binary = PCM frames
            if isinstance(msg, (bytes, bytearray)):
                if closing or final_sent:
                    continue
                # accumulate (capped) for potential full transcription fallback
                all_pcm += msg
                cap_buffer()

                out = seg.push(msg)
                if out:
                    # last-wins: drop any queued work, enqueue newest
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

            # Text = JSON control
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
                # Accept language hint from client (e.g., "bn" | "en" | "auto")
                lang_hint = data.get("lang")
                if isinstance(lang_hint, str) and lang_hint:
                    v = lang_hint.strip().lower()
                    session_lang = None if v == "auto" else v
                print(f"[ai-waiter-service] hello session={session_id} user={user_id} rate={rate} ch={ch} lang={session_lang or 'auto'}")
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
            # Flush any remaining VAD buffer into total (so fallback is complete)
            last = seg.flush()
            if last:
                all_pcm += last
                cap_buffer()

            final_bytes = bytes(all_pcm) if all_pcm else b""
            print(f"[ai-waiter-service] finalization: total_bytes={len(final_bytes)}, last_partial='{last_partial_text}' lang={session_lang or 'auto'}")

            selected_text = None
            selected_segs = []

            # Fast path: try Groq but with a tight timeout; otherwise fall back to partial/local
            groq_used = False
            if GROQ_API_KEY and len(final_bytes) >= 16000 and not ws.closed:
                try:
                    print("[ai-waiter-service] calling Groq for final (auto-detect unless forced)...")
                    groq_text = await groq_transcribe(final_bytes, session_lang, rate=rate)

                    # Bangla-first, English-if-clearly-English fallback:
                    if session_lang == "bn" and groq_text:
                        # If the text has Latin letters and NO Bangla letters, try EN once
                        if _LATIN.search(groq_text) and not _BENGALI.search(groq_text):
                            print("[ai-waiter-service] Groq returned Latin-only while lang=bn → retrying with lang=en")
                            en_text = await groq_transcribe(final_bytes, "en", rate=rate)
                            if en_text:
                                groq_text = en_text

                    if groq_text and looks_sane(groq_text, session_lang):
                        selected_text = groq_text
                        groq_used = True
                        print("[ai-waiter-service] ✅ using Groq final")
                except Exception as e:
                    print("[ai-waiter-service] Groq finalize failed:", e)

            if not selected_text:
                # Prefer last sane partial for instant final
                if last_partial_text and looks_sane(last_partial_text, session_lang):
                    selected_text = last_partial_text
                    selected_segs = []
                    print("[ai-waiter-service] ✅ using last sane partial as final")
                # Else do a local full pass as fallback (only if audio is substantial)
                elif len(final_bytes) >= 16000:
                    print(f"[ai-waiter-service] fallback to local full transcription: {len(final_bytes)} bytes")
                    try:
                        local_text, segs = await asyncio.get_event_loop().run_in_executor(
                            None, stt_np_float32, final_bytes, session_lang
                        )
                        if local_text:
                            selected_text = local_text
                            selected_segs = segs
                    except Exception as e:
                        print("[ai-waiter-service] local fallback failed:", e)

            if selected_text and not ws.closed:
                final_sent = True
                try:
                    await ws.send(json.dumps({
                        "t": "stt_final",
                        "text": selected_text,
                        "ts": time.time(),
                        "segmentStart": selected_segs[0][0] if selected_segs else None,
                        "segmentEnd": selected_segs[-1][1] if selected_segs else None
                    }))
                    print(f"[ai-waiter-service] ✅ stt_final sent: {selected_text}")
                except Exception as e:
                    print(f"[ai-waiter-service] ❌ failed to send stt_final: {e}")

                # enqueue DB write (best-effort)
                try:
                    await writer_q.put({
                        "user": user_id,
                        "session": session_id,
                        "text": selected_text,
                        "segments": selected_segs,
                        "ts": datetime.utcnow(),
                        "status": "new",
                        "engine": "groq" if groq_used else ("local-partial" if selected_segs == [] else "local-full")
                    })
                except Exception as e:
                    print("[ai-waiter-service] writer queue error:", e)
            else:
                print("[ai-waiter-service] ⚠️ no usable final produced")

    except Exception as e:
        print(f"[ai-waiter-service] error in handle_conn: {e}")
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

    port = int(os.environ.get("PORT", "7071"))
    async with websockets.serve(
        handle_conn, "0.0.0.0", port,
        max_size=None,
        ping_timeout=30,
        ping_interval=20,
        close_timeout=10  # Give 10s to send final message before force-closing
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
