# services/ai-waiter-service/Dockerfile
FROM python:3.10-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ---- system deps ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    libavutil-dev \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# ---- python deps ----
RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir \
      numpy==1.26.4 \
      websockets==12.0 \
      soundfile==0.12.1 \
      pymongo==4.6.3 \
      ctranslate2==4.6.0 \
      huggingface-hub==0.36.0 \
      tokenizers==0.15.2 \
      onnxruntime==1.23.2 \
      "av>=12.0.0" \
      httpx==0.27.2 \
      "rapidfuzz>=3.9.0" \
      aiohttp==3.9.5 && \
    pip install --no-cache-dir --no-deps faster-whisper==1.0.1

# Time zones for opening/serving hours (zoneinfo) — separate layer keeps the cache above
RUN pip install --no-cache-dir tzdata==2025.2

# Hands-free voice matching (voiceprint.py): sherpa-onnx + the 3D-Speaker ERes2Net speaker model (Apache-2.0,
# ~39 MB), fetched at build time. Without it the service still runs — listen windows fall back to loudness checks.
RUN pip install --no-cache-dir --no-deps sherpa-onnx==1.13.8 sherpa-onnx-core==1.13.8 && mkdir -p /app/models && \
    python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx', '/app/models/speaker.onnx')" \
    || echo "speaker model not downloaded — voice matching off"

COPY . .

CMD ["python", "server.py"]
