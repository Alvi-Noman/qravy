# services/ai-waiter-service/server.py
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

# TTL (30 days) so transcripts auto-expire
try:
    COLL.create_index("ts", expireAfterSeconds=30*24*3600, name="ttl_30d")
except Exception as e:
    print("[ai-waiter-service] TTL index create failed:", str(e))

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")  # Changed from "small" to "tiny"
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")               # "cuda" on GPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")  # "float16" on GPU
WHISPER_LANG = os.environ.get("WHISPER_LANG")                  # e.g., "bn" for Bangla

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
  f32 = (i16.astype(np.float32) / 32768.0)

  segments, info = model.transcribe(
    f32,
    language=WHISPER_LANG,          # None -> auto
    task="transcribe",
    vad_filter=False,               # external segmentation
    beam_size=1,
    best_of=1,
    without_timestamps=False,
    condition_on_previous_text=False,
    no_speech_threshold=0.6,        # Increased from 0.3 - more aggressive silence detection
    log_prob_threshold=-1.0,        # Increased from -1.5 - require higher confidence
    compression_ratio_threshold=2.4,# Decreased from 2.6 - reject repetitive output
    temperature=0.0,
    initial_prompt="",              # Don't bias towards common phrases
  )
  
  text = []
  segs = []
  for seg in segments:
    txt = (seg.text or "").strip()
    if txt:
      text.append(txt)
      segs.append((seg.start, seg.end))
  
  result_text = " ".join(text)
  
  # Filter out common hallucinations
  hallucinations = [
    "thank you", "thanks for watching", "bye", "goodbye", 
    "subscribe", "like and subscribe", "see you next time",
    "thanks", "thank you for watching"
  ]
  
  if result_text.lower().strip() in hallucinations:
    print(f"[ai-waiter-service] ⚠️ detected hallucination: '{result_text}', ignoring")
    return "", []
  
  return result_text, segs

async def handle_conn(ws: WebSocketServerProtocol):
  session_id = None
  user_id = "guest"
  rate = 16000
  ch = 1

  seg = Segmenter(bytes_per_sec=rate*2, min_ms=500, max_ms=2000)  # Bigger chunks: 0.5-2s
  work_q: asyncio.Queue = asyncio.Queue(maxsize=8)
  closed = asyncio.Event()

  all_pcm = bytearray()
  last_partial_text = None

  closing = False       # after we decide to finalize
  final_sent = False    # after stt_final is sent

  async def worker():
    nonlocal last_partial_text, final_sent
    MIN_CHUNK_BYTES = 8000  # Lowered from 16000 to 0.25s for faster partials
    
    while not closed.is_set():
      chunk = await work_q.get()
      if chunk is None:
        break
      if final_sent:
        continue
      
      # Skip transcribing chunks that are too short
      if len(chunk) < MIN_CHUNK_BYTES:
        print(f"[ai-waiter-service] skipping chunk too short: {len(chunk)} bytes")
        continue
        
      print(f"[ai-waiter-service] transcribing chunk bytes={len(chunk)}")
      text, _ = await asyncio.get_event_loop().run_in_executor(None, stt_np_float32, chunk)
      if text and not final_sent:
        last_partial_text = text
        try:
          await ws.send(json.dumps({
            "t": "stt_partial",
            "text": text,
            "ts": time.time()
          }))
          print("[ai-waiter-service] stt_partial:", text[:120])
        except Exception:
          break

  wtask = asyncio.create_task(worker())

  try:
    print("[ai-waiter-service] client connected")
    try:
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
        print(f"[ai-waiter-service] recv bytes={len(msg)}")
        all_pcm += msg
        out = seg.push(msg)
        if out and not work_q.full():
          work_q.put_nowait(out)
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
        print(f"[ai-waiter-service] hello session={session_id} user={user_id} rate={rate} ch={ch}")
        continue

      if t == "end":
        closing = True
        print("[ai-waiter-service] received end → finalizing")
        break

    # Finalize - PRIORITIZE SPEED: use last partial if available
    if not final_sent:
      # Flush any remaining VAD buffer
      last = seg.flush()
      if last:
        all_pcm += last  # Add remainder to total
      
      final_bytes = bytes(all_pcm) if all_pcm else b""
      
      print(f"[ai-waiter-service] finalization: total_bytes={len(final_bytes)}, last_partial='{last_partial_text}'")

      # Strategy: ALWAYS prefer last_partial for speed (skip heavy Whisper on full audio)
      if last_partial_text:
        print(f"[ai-waiter-service] using last partial for instant response: {last_partial_text}")
        if ws.open:
          final_sent = True
          try:
            await ws.send(json.dumps({
              "t": "stt_final",
              "text": last_partial_text,
              "ts": time.time(),
              "segmentStart": None,
              "segmentEnd": None
            }))
            print(f"[ai-waiter-service] ✅ stt_final sent (partial): {last_partial_text}")
            
            await writer_q.put({
              "user": user_id,
              "session": session_id,
              "text": last_partial_text,
              "segments": [],
              "ts": datetime.utcnow(),
              "status": "new"
            })
          except Exception as e:
            print(f"[ai-waiter-service] ❌ failed to send stt_final: {e}")
      
      # Only do full transcription if no partial exists AND audio is substantial
      elif len(final_bytes) >= 16000:  # 0.5s minimum
        print(f"[ai-waiter-service] no partial available, transcribing full audio: {len(final_bytes)} bytes")
        try:
          if ws.open:
            final_text, segs = await asyncio.get_event_loop().run_in_executor(
              None, stt_np_float32, final_bytes
            )
            
            if final_text:
              if ws.open:
                final_sent = True
                try:
                  await ws.send(json.dumps({
                    "t": "stt_final",
                    "text": final_text,
                    "ts": time.time(),
                    "segmentStart": segs[0][0] if segs else None,
                    "segmentEnd": segs[-1][1] if segs else None
                  }))
                  print(f"[ai-waiter-service] ✅ stt_final sent (whisper): {final_text}")
                except Exception as e:
                  print(f"[ai-waiter-service] ❌ failed to send stt_final: {e}")
              
              await writer_q.put({
                "user": user_id,
                "session": session_id,
                "text": final_text,
                "segments": segs,
                "ts": datetime.utcnow(),
                "status": "new"
              })
            else:
              print("[ai-waiter-service] Whisper returned empty")
          else:
            print(f"[ai-waiter-service] ⚠️ connection closed before transcription")
        except Exception as e:
          print(f"[ai-waiter-service] ❌ error during final transcription: {e}")
      
      else:
        print(f"[ai-waiter-service] ⚠️ no partial and audio too short ({len(final_bytes)} bytes), skipping")

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