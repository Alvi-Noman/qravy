"""The owner's own answer to "what can I eat now?", one for each time of day (Settings → AI Waiter → What to eat now):
sentences of the owner's words and dish pills. A pill is a first choice, up to two backups (when it's sold out or not
served then) and, optionally, how the waiter says it ("ভাত" for সাদা ভাত (মিনিকেট)).

The waiter says it with the first choice of each pill that can be ordered now. A dish with none left is left out, with
the short word that joined it to its neighbour ("আর", ","); a sentence whose dishes are all gone is skipped. Every word
said is the owner's or the menu's — nothing here is in any one language.

Stored on the restaurant (tenant.nowAnswers, set in the admin): {slot: {"lines": [[token, …], …]}}, a token
{"t": "text", "v": "…"} or {"t": "dish", "id": "<item id>", "backups": [ids], "say": "…"}."""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

# (key, from, until) in minutes of the restaurant's day — the night is the owner's rule: rice first again from 9pm
SLOTS: Tuple[Tuple[str, int, int], ...] = (
    ("morning", 4 * 60, 12 * 60),
    ("lunch", 12 * 60, 17 * 60),
    ("evening", 17 * 60, 21 * 60),
    ("night", 21 * 60, 4 * 60),
)
SAMPLE_AT = {"morning": "09:00", "lunch": "13:30", "evening": "19:30", "night": "21:30"}  # (for the suggested ones)
MAX_LINES, MAX_TOKENS, MAX_TEXT, MAX_SAY, MAX_BACKUPS = 8, 40, 300, 40, 2
_ID = re.compile(r"^[0-9a-fA-F]{24}$|^d\d{1,4}$")  # (a menu item's id — d12 in the tests' and replay's menus)


def slot_of(minute: Optional[int]) -> Optional[str]:
    if minute is None:
        return None
    for key, start, end in SLOTS:
        if (start <= minute < end) if start < end else (minute >= start or minute < end):
            return key
    return None


def clean(raw: Any) -> Dict[str, List[List[Dict[str, Any]]]]:
    """The stored answers, checked: {slot: lines} — only known slots, real tokens, within the limits."""
    out: Dict[str, List[List[Dict[str, Any]]]] = {}
    if not isinstance(raw, dict):
        return out
    for key, _s, _e in SLOTS:
        slot = raw.get(key)
        lines = slot.get("lines") if isinstance(slot, dict) else None
        if not isinstance(lines, list):
            continue
        kept: List[List[Dict[str, Any]]] = []
        for line in lines[:MAX_LINES]:
            toks: List[Dict[str, Any]] = []
            for t in line[:MAX_TOKENS] if isinstance(line, list) else []:
                if not isinstance(t, dict):
                    continue
                if t.get("t") == "text" and isinstance(t.get("v"), str) and t["v"]:
                    toks.append({"t": "text", "v": t["v"][:MAX_TEXT]})
                elif t.get("t") == "dish" and _ID.match(str(t.get("id") or "")):
                    backups = [str(b) for b in t.get("backups") or [] if _ID.match(str(b)) and str(b) != str(t["id"])]
                    toks.append({"t": "dish", "id": str(t["id"]), "backups": list(dict.fromkeys(backups))[:MAX_BACKUPS],
                                 "say": str(t.get("say") or "").strip()[:MAX_SAY]})
            if any(tk["t"] == "dish" or tk["v"].strip() for tk in toks):
                kept.append(toks)
        if kept:
            out[key] = kept
    return out


def _joiner(text: str) -> bool:
    """The few characters between two dishes that only join them: ", ", " আর ", " or " — one short word at most."""
    core = re.sub(r"[\s,;:।॥.]+", " ", text).strip()
    return len(core) <= 8 and len(core.split()) <= 1


def render(lines: List[List[Dict[str, Any]]], items: Dict[str, Dict[str, Any]], can: Callable[[str], bool],
           said: Callable[[Dict[str, Any]], str]) -> Optional[Tuple[str, List[str]]]:
    """(what the waiter says, the dishes it names) — None when nothing of it can be said now."""
    sentences: List[str] = []
    named: List[str] = []
    for line in lines:
        parts: List[Dict[str, Any]] = []
        for t in line:
            if t["t"] == "text":
                parts.append({"text": t["v"]})
                continue
            pick = next((i for i in [t["id"], *t.get("backups", [])] if i in items and can(i)), None)
            if pick is None:
                parts.append({"gone": True})
            else:
                # (its own words only for the first choice — a backup is said by its own name)
                parts.append({"dish": pick, "say": t.get("say") if pick == t["id"] and t.get("say") else said(items[pick])})
        had_dish = any("dish" in p or "gone" in p for p in parts)
        for i, p in enumerate(parts):
            if not p.get("gone"):
                continue
            prev, nxt = (parts[i - 1] if i > 0 else None), (parts[i + 1] if i + 1 < len(parts) else None)
            # the word that joined it goes with it: before it when a dish comes before, else after it
            if prev and "text" in prev and i >= 2 and ("dish" in parts[i - 2] or "gone" in parts[i - 2]) and _joiner(prev["text"]):
                prev["text"] = " "
            elif nxt and "text" in nxt and i + 2 < len(parts) and ("dish" in parts[i + 2] or "gone" in parts[i + 2]) \
                    and _joiner(nxt["text"]):
                nxt["text"] = " "
        kept = [p for p in parts if not p.get("gone")]
        if had_dish and not any("dish" in p for p in kept):
            continue  # (every dish of it is gone — the sentence isn't said)
        text = "".join(p.get("text") if "text" in p else p["say"] for p in kept)
        text = re.sub(r"\s+([,।?!.])", r"\1", re.sub(r"\s{2,}", " ", text)).strip()
        if text:
            sentences.append(text)
            named += [p["dish"] for p in kept if "dish" in p]
    if not sentences:
        return None
    return " ".join(sentences), list(dict.fromkeys(named))


# ---------------------------------------------------------------- the suggested answer, as pills

def _bn_letter(ch: str) -> bool:
    """A Bangla letter that would carry on the word (a dependent sign or a consonant) — not "ও" after a name."""
    o = ord(ch)
    return 0x0980 <= o <= 0x09FF and not (0x0985 <= o <= 0x0994)


def as_lines(text: str, items: List[Dict[str, Any]], on: Iterable[str], said: Callable[[Dict[str, Any]], str],
             kind: Callable[[Dict[str, Any]], str], item_id: Callable[[Dict[str, Any]], str]) -> List[List[Dict[str, Any]]]:
    """The waiter's own sentence for a time ("এখন ভাত খেতে পারেন — ভাতের সাথে মাছের মধ্যে রুই মাছ আর …") as the owner's
    starting point: one line per sentence, each dish it names a pill with two backups of the same kind served then."""
    on = set(on)
    by_said = sorted(((said(it), it) for it in items if item_id(it) in on and said(it)), key=lambda p: -len(p[0]))
    lines: List[List[Dict[str, Any]]] = []
    for sentence in [s for s in re.split(r"(?<=[।?!])\s+", text or "") if s.strip()]:
        hits: List[Tuple[int, int, Dict[str, Any]]] = []
        for name, it in by_said:
            start = 0
            while True:
                s = sentence.find(name, start)
                if s < 0:
                    break
                e = s + len(name)
                if not (e < len(sentence) and _bn_letter(sentence[e])) and not any(s < he and e > hs for hs, he, _ in hits):
                    hits.append((s, e, it))
                start = e
        hits.sort(key=lambda h: h[0])
        taken = {item_id(h[2]) for h in hits}
        toks: List[Dict[str, Any]] = []
        at = 0
        for s, e, it in hits:
            if s > at:
                toks.append({"t": "text", "v": sentence[at:s]})
            k = kind(it)
            same = [x for x in items if item_id(x) in on and item_id(x) not in taken and item_id(x) != item_id(it)
                    and (kind(x) == k if k else x.get("category") == it.get("category"))]
            same.sort(key=lambda x: x.get("category") != it.get("category"))  # (its own menu section first)
            toks.append({"t": "dish", "id": item_id(it), "backups": [item_id(x) for x in same[:MAX_BACKUPS]], "say": ""})
            at = e
        if at < len(sentence):
            toks.append({"t": "text", "v": sentence[at:]})
        lines.append(toks)
    return lines
