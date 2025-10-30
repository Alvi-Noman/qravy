# services/ai-waiter-service/robust_search.py
"""
Robust, multilingual (bn/en) menu-item matcher for fallback UX ("Did you mean…?").

Inputs:
- query: raw user text
- menu_snapshot: {
    "items": [
      {"id": "...", "name": "...", "aliases": [...], "category": "Burger", "category_id": "...",
       "price": 250, "available": true}
    ],
    "categories": [{"id": "...", "name": "Burger"}, ...],
    "tenant_id": "...",
    "branch": "...",
    "updated_at": "..."
  }

Outputs:
- dict:
  {
    "strategy": "robust-fallback" | "category-expand" | "guess",
    "lang": "bn"|"en",
    "query_norm": "...",
    "matches": [
       {"id":"...", "name":"...", "category":"...", "available":true, "price":250,
        "score":0.87, "why":["alias~substring","phonetic~match","ngram~0.71"]},
       ...
    ],
    "category_hit": {"id":"...","name":"..."} | None
  }

Notes:
- No external deps. Balanced for correctness and speed on ~1k-5k items.
- Uses a blended score: w_exact > w_alias > w_substring > w_token > w_ngram > w_edit > w_phonetic.
- Bangla support through simple transliteration to Latin for phonetic comparison;
  works well enough for noisy ASR variants (e.g., "সুপ্রীম" ~ "supreme").

Typical usage from server.py on LLM fallback:
    from robust_search import robust_find
    result = robust_find(user_text, snapshot, lang_hint=session_lang)
    if result["matches"]:
        # open DidYouMeanModal with result["matches"]

"""

from __future__ import annotations
import math
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------- Utilities ----------------------------

_LATIN = re.compile(r"[A-Za-z]")
_BENGALI = re.compile(r"[\u0980-\u09FF]")
_PUNCT = re.compile(r"[\s\-\_\.\,\|\(\)\[\]\{\}/\\!?:;\"'`~]+")
_MULTI_SPACE = re.compile(r"\s+")

def detect_lang(s: str) -> str:
    if _BENGALI.search(s or ""):
        return "bn"
    if _LATIN.search(s or ""):
        return "en"
    return "en"

def normalize_text(s: str) -> str:
    """Casefold, strip punctuation → spaces, collapse whitespace."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.casefold()
    s = _PUNCT.sub(" ", s)
    s = _MULTI_SPACE.sub(" ", s).strip()
    return s

def tokenize(s: str) -> List[str]:
    s = normalize_text(s)
    if not s:
        return []
    return s.split()

def char_ngrams(s: str, n: int = 3) -> List[str]:
    s = normalize_text(s)
    if not s:
        return []
    if len(s) <= n:
        return [s]
    return [s[i:i+n] for i in range(len(s)-n+1)]

# ----------------------- BN → Latin transliteration -----------------------

# A pragmatic transliteration to align noisy BN transcripts with Latin menu spellings.
# (Not linguistically perfect — intentionally permissive for fuzzy/phonetic matching.)
_BN2LAT = {
    "অ":"o","আ":"a","ই":"i","ঈ":"ii","উ":"u","ঊ":"uu","ঋ":"ri","এ":"e","ঐ":"oi","ও":"o","ঔ":"ou",
    "া":"a","ি":"i","ী":"i","ু":"u","ূ":"u","ৃ":"ri","ে":"e","ৈ":"oi","ো":"o","ৌ":"ou",
    "ক":"k","খ":"kh","গ":"g","ঘ":"gh","ঙ":"ng",
    "চ":"ch","ছ":"chh","জ":"j","ঝ":"jh","ঞ":"ny",
    "ট":"t","ঠ":"th","ড":"d","ঢ":"dh","ণ":"n",
    "ত":"t","থ":"th","দ":"d","ধ":"dh","ন":"n",
    "প":"p","ফ":"ph","ব":"b","ভ":"bh","ম":"m",
    "য":"y","র":"r","ল":"l","শ":"sh","ষ":"sh","স":"s","হ":"h","ড়":"r","ঢ়":"rh","য়":"y","ৎ":"t","ং":"ng","ঃ":"h","ঁ":"n",
    "০":"0","১":"1","২":"2","৩":"3","৪":"4","৫":"5","৬":"6","৭":"7","৮":"8","৯":"9",
}

def bn_to_latin(s: str) -> str:
    if not s:
        return ""
    out = []
    for ch in s:
        out.append(_BN2LAT.get(ch, ch))
    res = "".join(out)
    res = normalize_text(res)
    return res

# ----------------------- Edit distance / Jaro-Winkler -----------------------

def levenshtein_norm(a: str, b: str) -> float:
    """Normalized similarity ∈ [0,1] based on Levenshtein distance."""
    a = normalize_text(a); b = normalize_text(b)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    la, lb = len(a), len(b)
    # DP with two rows
    prev = list(range(lb + 1))
    curr = [0] * (lb + 1)
    for i in range(1, la + 1):
        curr[0] = i
        ai = a[i-1]
        for j in range(1, lb + 1):
            cost = 0 if ai == b[j-1] else 1
            curr[j] = min(prev[j] + 1,      # deletion
                          curr[j-1] + 1,    # insertion
                          prev[j-1] + cost) # substitution
        prev, curr = curr, prev
    dist = prev[lb]
    return 1.0 - (dist / max(la, lb))

def jaccard_ngrams(a: str, b: str, n: int = 3) -> float:
    A = set(char_ngrams(a, n))
    B = set(char_ngrams(b, n))
    if not A and not B:
        return 1.0
    if not A or not B:
        return 0.0
    inter = len(A & B)
    uni = len(A | B)
    return inter / max(1, uni)

# ----------------------- Phonetic (Double Metaphone lite) -----------------------

def metaphone_code_simple(s: str) -> str:
    """
    Very light metaphone-like key (subset) for restaurant names.
    Enough to group 'burger'~'burjer'~'borger', 'supreme'~'suprimo', etc.
    """
    s = normalize_text(s)
    if not s:
        return ""
    # remove vowels except leading
    vowels = set("aeiou")
    out = []
    prev = ""
    for i, ch in enumerate(s):
        if ch in vowels:
            if i == 0:
                out.append(ch)
            continue
        # collapse repeats
        if ch == prev:
            continue
        prev = ch
        # coarse mappings
        if ch in "ckq":
            out.append("k")
        elif ch == "x":
            out.append("ks")
        elif ch == "z":
            out.append("s")
        elif ch == "v":
            out.append("f")
        elif ch == "j":
            out.append("j")  # keep
        elif ch == "g":
            out.append("g")
        elif ch == "y":
            out.append("y")
        elif ch == "w":
            out.append("w")
        elif ch == "h":
            # ignore standalone h often
            continue
        else:
            out.append(ch)
    return "".join(out)

def phonetic_similarity(a: str, b: str) -> float:
    ka = metaphone_code_simple(a)
    kb = metaphone_code_simple(b)
    if not ka and not kb:
        return 1.0
    if not ka or not kb:
        return 0.0
    # Jaccard over character bigrams of the metaphone keys
    return jaccard_ngrams(ka, kb, n=2)

# ---------------------------- Candidate Index ----------------------------

class IndexedItem:
    __slots__ = (
        "id","name","aliases","category","category_id","available","price",
        "name_norm","name_tok","name_lat","name_meta",
        "alias_norms","alias_lats","alias_meta"
    )
    def __init__(self, raw: Dict[str, Any]):
        self.id = str(raw.get("id") or raw.get("_id") or "")
        self.name = str(raw.get("name") or "").strip()
        self.aliases = [str(a).strip() for a in (raw.get("aliases") or []) if a]
        self.category = str(raw.get("category") or "").strip()
        self.category_id = str(raw.get("category_id") or raw.get("categoryId") or "").strip() or None
        self.available = bool(raw.get("available", True))
        self.price = raw.get("price")

        self.name_norm = normalize_text(self.name)
        self.name_tok = tokenize(self.name_norm)
        # transliterate BN text to Latin for phonetic
        self.name_lat = bn_to_latin(self.name) if _BENGALI.search(self.name) else self.name_norm
        self.name_meta = metaphone_code_simple(self.name_lat)

        self.alias_norms = [normalize_text(a) for a in self.aliases]
        self.alias_lats  = [bn_to_latin(a) if _BENGALI.search(a) else normalize_text(a) for a in self.aliases]
        self.alias_meta  = [metaphone_code_simple(a) for a in self.alias_lats]

def build_index(snapshot: Dict[str, Any]) -> Tuple[List[IndexedItem], Dict[str, str]]:
    items = [IndexedItem(x) for x in (snapshot.get("items") or [])]
    categories = {}
    for c in (snapshot.get("categories") or []):
        cid = str(c.get("id") or "")
        cname = str(c.get("name") or "").strip()
        if cid and cname:
            categories[cid] = cname
    return items, categories

# ---------------------------- Scoring Model ----------------------------

W = {
    "exact": 1.00,
    "alias_exact": 0.95,
    "startswith": 0.82,
    "substring": 0.78,
    "token_overlap": 0.50,
    "ngram": 0.45,
    "edit": 0.55,
    "phonetic": 0.40,
    "category_name": 0.85,  # if query seems to be a category
}

def token_overlap_score(qtoks: List[str], ntoks: List[str]) -> float:
    if not qtoks or not ntoks:
        return 0.0
    A, B = set(qtoks), set(ntoks)
    inter = len(A & B)
    return inter / max(1, min(len(A), len(B)))

def blend_scores(parts: List[Tuple[str, float]]) -> float:
    """Weighted max-blend: emphasize the strongest aligned evidence."""
    score = 0.0
    for name, val in parts:
        w = W.get(name, 0.0)
        score = max(score, w * val)
    # small bonus if we have multiple independent signals
    nonzero = sum(1 for _, v in parts if v > 0.0)
    if nonzero >= 3:
        score = min(1.0, score + 0.08)
    return score

# ---------------------------- Category Detect ----------------------------

def maybe_match_category(query: str, categories: Dict[str, str]) -> Optional[Tuple[str, str, float, List[str]]]:
    """Return (category_id, name, score, why) if query strongly points to a category."""
    qn = normalize_text(query)
    qlat = bn_to_latin(query) if _BENGALI.search(query) else qn
    best = (None, None, 0.0, [])
    for cid, cname in categories.items():
        cn = normalize_text(cname)
        cl = bn_to_latin(cname) if _BENGALI.search(cname) else cn
        parts: List[Tuple[str, float]] = []
        why: List[str] = []

        if qn == cn or qlat == cl:
            parts.append(("category_name", 1.0)); why.append("category~exact")
        if cn.startswith(qn) or cl.startswith(qlat):
            parts.append(("startswith", 1.0)); why.append("category~startswith")
        if qn and qn in cn or qlat and qlat in cl:
            parts.append(("substring", 1.0)); why.append("category~substring")

        # phonetic + edit for category too
        ph = phonetic_similarity(qlat, cl)
        if ph >= 0.70:
            parts.append(("phonetic", ph)); why.append(f"category~phonetic~{ph:.2f}")
        lv = levenshtein_norm(qlat, cl)
        if lv >= 0.70:
            parts.append(("edit", lv)); why.append(f"category~edit~{lv:.2f}")

        s = blend_scores(parts)
        if s > best[2]:
            best = (cid, cname, s, why)
    if best[0] and best[2] >= 0.70:
        return best
    return None

# ---------------------------- Main Search ----------------------------

def score_item(query: str, qi: Dict[str, Any], item: IndexedItem) -> Tuple[float, List[str]]:
    """Return (score, why[]) for one candidate."""
    qn: str = qi["q_norm"]
    qlat: str = qi["q_lat"]
    qtoks: List[str] = qi["q_toks"]

    parts: List[Tuple[str, float]] = []
    why: List[str] = []

    # Name channel
    if qn == item.name_norm or qlat == item.name_lat:
        parts.append(("exact", 1.0)); why.append("name~exact")
    if item.name_norm.startswith(qn) or item.name_lat.startswith(qlat):
        parts.append(("startswith", 1.0)); why.append("name~startswith")
    if (qn and qn in item.name_norm) or (qlat and qlat in item.name_lat):
        parts.append(("substring", 1.0)); why.append("name~substring")

    # Token overlap
    to = token_overlap_score(qtoks, item.name_tok)
    if to >= 0.5:
        parts.append(("token_overlap", to)); why.append(f"name~token~{to:.2f}")

    # N-gram Jaccard (3-gram)
    ng = jaccard_ngrams(qlat, item.name_lat, n=3)
    if ng >= 0.45:
        parts.append(("ngram", ng)); why.append(f"name~ngram~{ng:.2f}")

    # Edit distance
    lv = levenshtein_norm(qlat, item.name_lat)
    if lv >= 0.55:
        parts.append(("edit", lv)); why.append(f"name~edit~{lv:.2f}")

    # Phonetic
    ph = phonetic_similarity(qlat, item.name_lat)
    if ph >= 0.55:
        parts.append(("phonetic", ph)); why.append(f"name~phonetic~{ph:.2f}")

    # Aliases channel: give high weight if any alias strongly matches
    for a_norm, a_lat, a_meta in zip(item.alias_norms, item.alias_lats, item.alias_meta):
        if not a_norm and not a_lat:
            continue
        if qn == a_norm or qlat == a_lat:
            parts.append(("alias_exact", 1.0)); why.append("alias~exact"); break
        if (a_norm.startswith(qn) or a_lat.startswith(qlat)) and len(qn) >= 3:
            parts.append(("startswith", 0.98)); why.append("alias~startswith"); break
        if (qn and qn in a_norm) or (qlat and qlat in a_lat):
            parts.append(("substring", 0.95)); why.append("alias~substring"); break
        # fuzzy alias
        ng_a = jaccard_ngrams(qlat, a_lat, n=3)
        if ng_a >= 0.48:
            parts.append(("ngram", ng_a)); why.append(f"alias~ngram~{ng_a:.2f}")
        lv_a = levenshtein_norm(qlat, a_lat)
        if lv_a >= 0.58:
            parts.append(("edit", lv_a)); why.append(f"alias~edit~{lv_a:.2f}")
        ph_a = phonetic_similarity(qlat, a_lat)
        if ph_a >= 0.58:
            parts.append(("phonetic", ph_a)); why.append(f"alias~phonetic~{ph_a:.2f}")

    # Slight boost if category token appears in query
    if item.category:
        cn = normalize_text(item.category)
        if cn and (cn in qn or cn in qlat):
            parts.append(("token_overlap", 0.6)); why.append("category~token")

    score = blend_scores(parts)
    return score, why

def _prepare_query(query: str) -> Dict[str, Any]:
    q_norm = normalize_text(query)
    q_lat = bn_to_latin(query) if _BENGALI.search(query) else q_norm
    q_toks = tokenize(q_norm)
    return {"q_norm": q_norm, "q_lat": q_lat, "q_toks": q_toks}

def robust_find(
    query: str,
    menu_snapshot: Dict[str, Any],
    *,
    lang_hint: Optional[str] = None,
    max_results: int = 8,
    prefer_available: bool = True,
    category_expand_limit: int = 12,
) -> Dict[str, Any]:
    """
    Ultimate fallback search for "Did you mean…" flow.
    - Always returns best guesses, even if weak.
    - If a category is detected strongly, returns that category and expands items in it.

    Parameters:
      prefer_available: sort available items ahead of unavailable when scores tie.
    """
    lang = (lang_hint or detect_lang(query))
    items_idx, categories = build_index(menu_snapshot)
    qinfo = _prepare_query(query)

    # 1) Try to detect a category intent
    cat_hit = maybe_match_category(query, categories)
    if cat_hit:
        cid, cname, cscore, cwhy = cat_hit
        # expand: pick items belonging to this category id or name
        expanded: List[Dict[str, Any]] = []
        for it in items_idx:
            if (it.category_id and it.category_id == cid) or (normalize_text(it.category) == normalize_text(cname)):
                s, why = score_item(query, qinfo, it)
                # ensure a minimal baseline so category items appear
                s = max(s, 0.72)
                expanded.append({
                    "id": it.id, "name": it.name, "category": it.category,
                    "available": it.available, "price": it.price,
                    "score": float(f"{s:.4f}"),
                    "why": list(set(why + ["category~expand"]))
                })
        # Rank by score + availability preference
        expanded.sort(key=lambda x: (x["score"], (1 if (prefer_available and x["available"]) else 0)), reverse=True)
        return {
            "strategy": "category-expand",
            "lang": lang,
            "query_norm": qinfo["q_norm"],
            "category_hit": {"id": cid, "name": cname, "score": float(f"{cscore:.4f}")},
            "matches": expanded[:max_results]
        }

    # 2) Score all items with blended metrics
    scored: List[Dict[str, Any]] = []
    for it in items_idx:
        s, why = score_item(query, qinfo, it)
        if s <= 0.0:
            # consider very weak guesses only if absolutely nothing else shows up
            pass
        scored.append({
            "id": it.id, "name": it.name, "category": it.category,
            "available": it.available, "price": it.price,
            "score": float(f"{s:.4f}"),
            "why": list(sorted(set(why)))
        })

    # 3) Filter to decent quality; if empty, keep best guesses anyway
    strong = [x for x in scored if x["score"] >= 0.65]
    pool = strong if strong else scored

    # 4) Sort: primary score, then availability, then shorter edit distance as tiebreaker
    def tiebreaker(x: Dict[str, Any]) -> float:
        # compute a tiny bonus for closer edit distance name-wise
        lv = levenshtein_norm(qinfo["q_lat"], bn_to_latin(x["name"]) if _BENGALI.search(x["name"]) else normalize_text(x["name"]))
        bonus = 0.01 * lv
        avail = 0.005 if (prefer_available and x["available"]) else 0.0
        return x["score"] + bonus + avail

    pool.sort(key=tiebreaker, reverse=True)

    # Trim and ensure we *always* return at least 1-3 guesses even if weak
    top = pool[:max_results]
    strategy = "robust-fallback" if strong else "guess"

    return {
        "strategy": strategy,
        "lang": lang,
        "query_norm": qinfo["q_norm"],
        "category_hit": None,
        "matches": top
    }

# ---------------------------- Quick Self-test ----------------------------
if __name__ == "__main__":
    snapshot = {
        "categories": [{"id":"c1","name":"Burger"},{"id":"c2","name":"Pasta"}],
        "items": [
            {"id":"i1","name":"Supreme Burger","aliases":["সুপ্রিম বার্গার","supreem burger"],"category":"Burger","category_id":"c1","price":299,"available":True},
            {"id":"i2","name":"Cheesy Pasta","aliases":["চিজি পাস্তা"],"category":"Pasta","category_id":"c2","price":249,"available":True},
            {"id":"i3","name":"Crispy Pasta","aliases":["ক্রিসপি পাস্তা"],"category":"Pasta","category_id":"c2","price":259,"available":False},
        ]
    }
    for q in ["সুপ্রীম বার্গার দিন", "suprim brgr", "পাস্তা চাই", "burger", "borger", "বার্গার", "chizi pasta"]:
        res = robust_find(q, snapshot, lang_hint=None, max_results=5)
        print(q, "=>", res["strategy"], "top:", [(m["name"], m["score"]) for m in res["matches"]])
