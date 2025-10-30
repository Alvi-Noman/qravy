import json, re, unicodedata
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from rapidfuzz import process, fuzz

# ---------- load exact pairs (once) ----------
PAIRS_PATH = Path(__file__).parent.parent.parent / "fine_tuning" / "asr_pairs.jsonl"
EXACT_MAP: Dict[str, str] = {}

def _load_pairs():
    if PAIRS_PATH.exists():
        with open(PAIRS_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line: 
                    continue
                obj = json.loads(line)
                EXACT_MAP[obj["noisy"]] = obj["clean"]

_load_pairs()

# ---------- basic cleanup ----------
BN_DIGITS = "০১২৩৪৫৬৭৮৯"
def _basic_clean(s: str) -> str:
    # strip ZWJ/ZWNJ, normalize unicode, collapse spaces, normalize digits
    s = s.replace("\u200c","").replace("\u200d","")
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Bengali → ASCII digits
    s = "".join(str(BN_DIGITS.index(ch)) if ch in BN_DIGITS else ch for ch in s)
    # unify punctuation variants
    s = s.replace("–","-").replace("—","-").replace("–","-")
    return s

# ---------- simple Bangla phonetic key ----------
# Goal: map visually different spellings to same sound “bucket”.
# This is intentionally simple; refine later as needed.
PHONETIC_MAP = {
    # vowels (collapse long/short; strip diacritics handled by NFC above)
    "আ":"a","অ":"a","া":"a","a":"a","A":"a",
    "इ":"i","ি":"i","ই":"i","ী":"i","ী":"i","ি":"i","i":"i",
    "উ":"u","ু":"u","ঊ":"u","ূ":"u","u":"u",
    "এ":"e","ে":"e","e":"e",
    "ও":"o","ো":"o","o":"o",
    "ঐ":"oi","ৈ":"oi","ঔ":"ou","ৌ":"ou",

    # consonants (coarse buckets)
    "ব":"b","ভ":"b","v":"b",
    "প":"p","ফ":"ph","f":"ph",
    "ম":"m",
    "ভ":"bh",
    "ত":"t","থ":"th","ট":"t","ঠ":"th","দ":"d","ধ":"dh","ড":"d","ঢ":"dh",
    "ন":"n","ঙ্খ":"n","ং":"n","ণ":"n",
    "স":"s","শ":"s","ষ":"s","z":"j","জ":"j","ঝ":"jh",
    "চ":"ch","ছ":"chh",
    "ক":"k","খ":"kh","গ":"g","ঘ":"gh","ঙ":"ng",
    "র":"r","ল":"l","য":"y","য়":"y","হ":"h",
    # common latin fallbacks
    "q":"k","x":"ks","c":"k","y":"y","j":"j"
}

def phonetic_key(token: str) -> str:
    out = []
    for ch in token:
        out.append(PHONETIC_MAP.get(ch, ch.lower()))
    key = "".join(out)
    # collapse repeats (e.g., 'kk' -> 'k')
    key = re.sub(r"(.)\1+", r"\1", key)
    # strip non-letters/digits
    key = re.sub(r"[^a-z0-9]", "", key)
    return key

# ---------- main normalize ----------
def normalize_text(
    text: str,
    vocab: Optional[List[str]] = None,
    fuzzy_threshold: float = 0.87
) -> Tuple[str, List[Tuple[str, str, float]]]:
    """
    Returns (normalized_text, matches_info)
    - normalized_text: after exact, phonetic, and fuzzy corrections (token-wise)
    - matches_info: list of (original, normalized, score) for tokens changed via fuzzy
    vocab: list of allowed words/phrases (names/aliases) to match against.
           If None, fuzzy & phonetic layers are skipped (only exact and cleanup).
    """
    text0 = text
    s = _basic_clean(text0)

    # phrase-level exact replacements first (longest first to catch multi-words)
    if EXACT_MAP:
        for noisy, clean in sorted(EXACT_MAP.items(), key=lambda kv: -len(kv[0])):
            s = s.replace(noisy, clean)

    tokens = s.split(" ")
    changed: List[Tuple[str, str, float]] = []

    if not vocab:
        return " ".join(tokens), changed

    # Prepare lookup sets
    vocab_set = set(vocab)
    # Precompute phonetic buckets
    bucket = {}
    for v in vocab_set:
        bucket.setdefault(phonetic_key(v), []).append(v)

    out_tokens = []
    for tok in tokens:
        if tok in vocab_set:
            out_tokens.append(tok)
            continue

        # phonetic: same-sound candidates
        pk = phonetic_key(tok)
        cand = bucket.get(pk, [])

        best = None
        best_score = -1.0

        # Try phonetic candidates first with partial_ratio to be robust
        for c in cand:
            sc = fuzz.token_sort_ratio(tok, c) / 100.0
            if sc > best_score:
                best, best_score = c, sc

        # If none or weak, run fuzzy over full vocab (bounded by top_n)
        if not best or best_score < fuzzy_threshold:
            m = process.extractOne(
                tok, vocab_set, scorer=fuzz.token_sort_ratio, score_cutoff=int(fuzzy_threshold*100)
            )
            if m:
                cand_word, sc, _ = m
                best, best_score = cand_word, sc/100.0

        if best and best_score >= fuzzy_threshold:
            out_tokens.append(best)
            changed.append((tok, best, best_score))
        else:
            out_tokens.append(tok)

    return " ".join(out_tokens), changed
