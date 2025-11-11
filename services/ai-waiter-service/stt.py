from __future__ import annotations

import os
from typing import List, Tuple, Optional

import numpy as np
from faster_whisper import WhisperModel

# Config (same env knobs you already use)
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

print(
    f"[stt] Loading Faster-Whisper model={WHISPER_MODEL} "
    f"device={WHISPER_DEVICE} compute={WHISPER_COMPUTE_TYPE}"
)

_model = WhisperModel(
    WHISPER_MODEL,
    device=WHISPER_DEVICE,
    compute_type=WHISPER_COMPUTE_TYPE,
)


def stt_np_float32(
    pcm_bytes: bytes,
    lang_hint: Optional[str] = None,
    rate: int = 16000,
) -> Tuple[str, List[Tuple[float, float]], Optional[str]]:
    """
    Decode 16-bit mono PCM -> text using Faster-Whisper.

    Returns:
      text: full transcript
      segments: list of (start, end) seconds
      detected_lang: ISO code if available
    """
    if not pcm_bytes:
        return "", [], None

    # 16-bit PCM -> float32 [-1, 1]
    audio = np.frombuffer(pcm_bytes, dtype=np.int16)
    if audio.size == 0:
        return "", [], None

    audio = audio.astype("float32") / 32768.0

    language = None
    if isinstance(lang_hint, str):
        v = lang_hint.strip().lower()
        if v and v not in ("auto", "auto_detect"):
            language = v

    segments_out: List[Tuple[float, float]] = []
    text_parts: List[str] = []

    # Lightweight settings; adjust if needed
    segments, info = _model.transcribe(
        audio,
        language=language,
        beam_size=1,
        vad_filter=True,
        word_timestamps=False,
    )

    for seg in segments:
        segments_out.append((float(seg.start), float(seg.end)))
        if seg.text:
            text_parts.append(seg.text.strip())

    full_text = " ".join(text_parts).strip()

    detected_lang: Optional[str] = None
    try:
        if getattr(info, "language", None):
            detected_lang = info.language
    except Exception:
        pass

    # Prefer explicit hint if we got nothing
    if not detected_lang and language:
        detected_lang = language

    return full_text, segments_out, detected_lang
