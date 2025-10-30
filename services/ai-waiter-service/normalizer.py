# services/ai-waiter-service/normalizer.py
import json
import re
import unicodedata
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from functools import lru_cache

from rapidfuzz import process, fuzz

# ---------------------------------------------------------------------
# Load exact noisy→clean pairs once (optional file: fine_tuning/asr_pairs.jsonl)
# Each line: {"noisy":"...", "clean":"..."}
# ---------------------------------------------------------------------
PAIRS_PATH = Path(__file__).resolve().parent.parent / "fine_tuning" / "asr_pairs.jsonl"
EXACT_MAP: Dict[str, str] = {}


def _load_pairs() -> None:
    if not PAIRS_PATH.exists():
        return
    try:
        with open(PAIRS_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    noisy = str(obj.get("noisy", "")).strip()
                    clean = str(obj.get("clean", "")).strip()
                    if noisy and clean:
                        EXACT_MAP[noisy] = clean
                except Exception:
                    # Skip malformed lines
                    continue
    except Exception:
        # Non-fatal if pairs file missing/unreadable
        pass


_load_pairs()

# ---------------------------------------------------------------------
# Basic cleanup utilities
# ---------------------------------------------------------------------
BN_DIGITS = "০১২৩৪৫৬৭৮৯"
BN_TO_ASCII = {ch: str(i) for i, ch in enumerate(BN_DIGITS)}

# Zero-width chars to strip
ZW_CHARS = ("\u200c", "\u200d", "\ufeff")


def _basic_clean(s: str) -> str:
    """
    - strip ZWJ/ZWNJ/BOM
    - NFC normalize
    - normalize punctuation variants
    - collapse whitespace
    - convert Bengali digits → ASCII
    """
    for z in ZW_CHARS:
        s = s.replace(z, "")
    s = unicodedata.normalize("NFC", s)

    # unify common punctuation dashes
    s = s.replace("–", "-").replace("—", "-")

    # convert Bengali digits
    s = "".join(BN_TO_ASCII.get(ch, ch) for ch in s)

    # collapse spaces
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------
# Lightweight Bangla/Latin phonetic key
# The goal is bucketization, not perfect transliteration.
# ---------------------------------------------------------------------
PHONETIC_MAP = {
    # vowels (collapse variants)
    "আ": "a", "অ": "a", "া": "a", "a": "a", "A": "a",
    "ই": "i", "ি": "i", "ী": "i", "i": "i", "I": "i",
    "উ": "u", "ু": "u", "ঊ": "u", "ূ": "u", "u": "u", "U": "u",
    "এ": "e", "ে": "e", "e": "e", "E": "e",
    "ও": "o", "ো": "o", "o": "o", "O": "o",
    "ঐ": "oi", "ৈ": "oi",
    "ঔ": "ou", "ৌ": "ou",

    # consonants (coarse buckets)
    "ব": "b", "ভ": "b", "v": "b", "V": "b",
    "প": "p", "ফ": "ph", "f": "ph", "F": "ph",
    "ম": "m", "M": "m",
    "ত": "t", "থ": "th", "ট": "t", "ঠ": "th",
    "দ": "d", "ধ": "dh", "ড": "d", "ঢ": "dh",
    "ন": "n", "ঙ": "ng", "ণ": "n", "ং": "n",
    "স": "s", "শ": "s", "ষ": "s",
    "জ": "j", "ঝ": "jh", "z": "j", "Z": "j", "j": "j", "J": "j",
    "চ": "ch", "ছ": "chh",
    "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh",
    "র": "r", "ল": "l", "য": "y", "য়": "y", "হ": "h",

    # latin fallbacks
    "q": "k", "Q": "k",
    "x": "ks", "X": "ks",
    "c": "k", "C": "k",
    "y": "y", "Y": "y",
}


@lru_cache(maxsize=4096)
def phonetic_key(token: str) -> str:
    out = []
    for ch in token:
        out.append(PHONETIC_MAP.get(ch, ch.lower()))
    key = "".join(out)
    # collapse repeating chars (kk → k)
    key = re.sub(r"(.)\1+", r"\1", key)
    # keep only a-z0-9
    key = re.sub(r"[^a-z0-9]", "", key)
    return key


# ---------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------
def normalize_text(
    text: str,
    *,
    vocab: Optional[List[str]] = None,
    fuzzy_threshold: float = 0.87,
    max_vocab: int = 5000,
) -> Tuple[str, List[Tuple[str, str, float]]]:
    """
    Normalize a noisy utterance into canonical tokens.

    Returns: (normalized_text, changes)
      - normalized_text: string after applying exact pairs, phonetic & fuzzy
      - changes: list of (original_token, normalized_token, score) for fuzzy/phonetic changes

    Args:
      text: raw string from ASR/final transcript
      vocab: allowed words/phrases to snap to (item names, aliases)
      fuzzy_threshold: 0..1 inclusive; higher = stricter correction
      max_vocab: cap to avoid heavy search on huge catalogs
    """
    s = _basic_clean(text or "")

    # Phrase-level exact replacements (apply longest first)
    if EXACT_MAP:
        for noisy, clean in sorted(EXACT_MAP.items(), key=lambda kv: (-len(kv[0]), kv[0])):
            # whole-phrase replace, then we’ll tokenize
            s = s.replace(noisy, clean)

    tokens = s.split(" ")
    if not vocab:
        return " ".join(tokens), []

    # Bound vocab for performance
    vocab = list(vocab[:max(0, max_vocab)])
    vocab_set = set(vocab)

    # Precompute phonetic buckets
    buckets: Dict[str, List[str]] = {}
    for v in vocab_set:
        buckets.setdefault(phonetic_key(v), []).append(v)

    changes: List[Tuple[str, str, float]] = []
    out_tokens: List[str] = []

    for tok in tokens:
        if not tok:
            continue

        # If already a canonical token, keep as-is
        if tok in vocab_set:
            out_tokens.append(tok)
            continue

        # Try phonetic bucket candidates first (fast & often correct)
        best_word: Optional[str] = None
        best_score: float = -1.0

        pk = phonetic_key(tok)
        for cand in buckets.get(pk, []):
            sc = fuzz.token_sort_ratio(tok, cand) / 100.0
            if sc > best_score:
                best_word, best_score = cand, sc

        # If weak or none, run fuzzy over full vocab (RapidFuzz is fast)
        if best_word is None or best_score < fuzzy_threshold:
            hit = process.extractOne(
                tok,
                vocab_set,
                scorer=fuzz.token_sort_ratio,
                score_cutoff=int(fuzzy_threshold * 100),
            )
            if hit:
                cand_word, sc, _ = hit
                best_word, best_score = cand_word, sc / 100.0

        if best_word and best_score >= fuzzy_threshold:
            out_tokens.append(best_word)
            changes.append((tok, best_word, best_score))
        else:
            out_tokens.append(tok)

    return " ".join(out_tokens), changes
