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
      av>=12.0.0 \
      httpx==0.27.2 && \
    pip install --no-cache-dir --no-deps faster-whisper==1.0.1

COPY . .

CMD ["python", "server.py"]
