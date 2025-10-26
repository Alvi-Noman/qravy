import asyncio, json, os, time
from datetime import datetime
import numpy as np
import websockets
from websockets.server import WebSocketServerProtocol
from faster_whisper import WhisperModel
from pymongo import MongoClient
from vad import Segmenter

# ---------- Config ----------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
DB = MongoClient(MONGO_URI).qravy
COLL = DB.transcripts

# Ensure TTL (30 days) so old transcripts auto-expire
try:
    COLL.create_index("ts", expireAfterSeconds=30*24*3600, name="ttl_30d")
except Exception as e:
    print("[ai-waiter-service] TTL index create failed:", str(e))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")                 # "cuda" on GPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")    # "float16" on GPU

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
                    print(f"[ai-waiter-service] inserted batch={len(buf)}")
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

# ---------- Core STT ----------
def stt_np_float32(pcm_bytes: bytes):
    """Int16 mono @16k -> float32 [-1,1] and transcribe."""
    i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    if i16.size == 0:
        return "", []
    f32 = (i16.astype(np.float32) / 32768.0)  # 16kHz mono float32
    segments, _ = model.transcribe(
        f32,
        language=None,                 # auto
        vad_filter=True,
        beam_size=1,
        best_of=1,
        without_timestamps=False,
        no_speech_threshold=0.45,
        log_prob_threshold=-1.2,
        compression_ratio_threshold=2.4,
    )
    text = []
    segs = []
    for seg in segments:
        txt = (seg.text or "").strip()
        if txt:
            text.append(txt)
            segs.append((seg.start, seg.end))
    return " ".join(text), segs

async def handle_conn(ws: WebSocketServerProtocol):
    session_id = None
    user_id = "guest"
    rate = 16000
    ch = 1

    seg = Segmenter(bytes_per_sec=rate*2, min_ms=200, max_ms=600)
    work_q: asyncio.Queue = asyncio.Queue(maxsize=8)
    closed = asyncio.Event()

    # NEW: accumulate all raw PCM so we can transcribe on finalize even if VAD yielded nothing
    all_pcm = bytearray()

    async def worker():
        while not closed.is_set():
            chunk = await work_q.get()
            if chunk is None:
                break
            text, _ = await asyncio.get_event_loop().run_in_executor(None, stt_np_float32, chunk)
            if text:
                try:
                    await ws.send(json.dumps({
                        "t": "stt_partial",
                        "text": text,
                        "ts": time.time()
                    }))
                    print("[ai-waiter-service] stt_partial:", text[:80])
                except Exception:
                    break

    wtask = asyncio.create_task(worker())

    try:
        print("[ai-waiter-service] client connected")
        await ws.send(json.dumps({ "t": "ack" }))

        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                # Accumulate all incoming PCM (for final fallback)
                all_pcm += msg

                # VAD segmentation for partials
                out = seg.push(msg)
                if out and not work_q.full():
                    work_q.put_nowait(out)
                continue

            # JSON control messages
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
                print(f"[ai-waiter-service] hello session={session_id} user={user_id} rate={rate} ch={ch}")
                continue

            if t == "end":
                print("[ai-waiter-service] received end → finalizing")
                break

        # Finalize: prefer the last VAD remainder; if empty, fall back to ALL PCM
        last = seg.flush()
        final_bytes = last if last else (bytes(all_pcm) if all_pcm else b"")

        if final_bytes:
            final_text, segs = await asyncio.get_event_loop().run_in_executor(None, stt_np_float32, final_bytes)
            if final_text:
                try:
                    await ws.send(json.dumps({
                        "t": "stt_final",
                        "text": final_text,
                        "ts": time.time(),
                        "segmentStart": segs[0][0] if segs else None,
                        "segmentEnd": segs[-1][1] if segs else None
                    }))
                    print("[ai-waiter-service] stt_final:", final_text)
                except Exception:
                    pass
                await writer_q.put({
                    "user": user_id,
                    "session": session_id,
                    "text": final_text,
                    "segments": segs,
                    "ts": datetime.utcnow(),
                    "status": "new"
                })
            else:
                print("[ai-waiter-service] final_text empty after fallback (possible silence)")
        else:
            print("[ai-waiter-service] nothing to transcribe (no VAD remainder and no accumulated PCM)")

    finally:
        closed.set()
        try:
            await work_q.put(None)
        except Exception:
            pass
        await asyncio.gather(wtask, return_exceptions=True)

async def main():
    global WRITER_TASK
    WRITER_TASK = asyncio.create_task(writer())

    port = int(os.environ.get("PORT", "7071"))
    async with websockets.serve(
        handle_conn, "0.0.0.0", port, max_size=None, ping_timeout=30, ping_interval=20
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
