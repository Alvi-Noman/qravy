"""Shared waiter knowledge, per cuisine and per language — plain-text packs in knowledge/, not code.

A pack is a Markdown file:

    # Bangla cuisine
    ## Breakfast                      ← a section
    when: সকাল, নাস্তা, breakfast     ← optional: words that bring it in (any language); no `when:` → always on
    Lines the waiter should know…

knowledge/cuisines/<key>.md is used when the menu is that cuisine (menu_profile's detection: "bangla", "chinese",
"fast food" → fast-food.md …); knowledge/languages/<code>.md when the guest speaks that language; general.md always.
Files are read once (and again only when one changes), sections are picked by plain word matching — no model call,
microseconds per turn. Adding a cuisine or a language is adding a file.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge")
# what one turn may add — the waiter's instructions stay short (the always-on parts are cached with the menu)
TURN_BUDGET = 2200


@dataclass
class Section:
    title: str
    text: str
    when: Optional[re.Pattern] = None

    @property
    def data(self) -> bool:
        """A section the CODE reads (the day's schedule, what needs a base) — never pasted into the AI's instructions."""
        return self.title.strip().lower() in DATA_SECTIONS


# sections that are data for the code, in a restaurant-type pack (knowledge/types/<type>.md):
#   ## Detect
#   - all: chinese, fast food            (every one at least MIN_SHARE of the menu; "any:" one of them; "needs: rice house")
#   ## Schedule
#   - morning 06:00-11:30: lead set menu, fried rice; avoid burger
#   ## Needs a base
#   - masala, chili onion, sweet and sour -> fried rice, chowmein
DATA_SECTIONS = {"detect", "schedule", "needs a base"}
MIN_SHARE = 0.08  # (a real section of the menu: 9 Chinese dishes in a 76-dish café)


@dataclass
class Pack:
    key: str
    title: str
    sections: List[Section] = field(default_factory=list)


_CACHE: Dict[str, Tuple[float, Pack]] = {}


def _slug(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (key or "").lower()).strip("-")


def _parse(key: str, raw: str) -> Pack:
    pack = Pack(key=key, title=key)
    cur: Optional[Section] = None
    for line in raw.splitlines():
        if line.startswith("# ") and not pack.sections and cur is None:
            pack.title = line[2:].strip()
            continue
        if line.startswith("## "):
            cur = Section(title=line[3:].strip(), text="")
            pack.sections.append(cur)
            continue
        if cur is None:
            continue  # (the pack's own intro — for the people who write it)
        m = re.match(r"^\s*when:\s*(.+)$", line, re.I)
        if m and not cur.data:
            words = [w.strip() for w in m.group(1).split(",") if w.strip()]
            if words:
                # a word inside Bangla words too ("সকালে", "নাস্তায়"); Latin words whole ("tea", not "steak")
                cur.when = re.compile("|".join(
                    re.escape(w) if re.search(r"[^\x00-\x7f]", w) else rf"\b{re.escape(w)}" for w in words), re.I)
            continue
        cur.text += line + "\n"
    for s in pack.sections:
        s.text = s.text.strip()
    pack.sections = [s for s in pack.sections if s.text]
    return pack


def load(kind: str, key: str) -> Optional[Pack]:
    """knowledge/<kind>/<key>.md, read again only when the file changes."""
    path = os.path.join(ROOT, kind, f"{_slug(key)}.md") if kind else os.path.join(ROOT, f"{_slug(key)}.md")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    hit = _CACHE.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    with open(path, encoding="utf-8") as f:
        pack = _parse(key, f.read())
    _CACHE[path] = (mtime, pack)
    return pack


def packs(cuisines: Iterable[str], lang: str) -> List[Pack]:
    """general → the menu's cuisines (most of it first) → the guest's language."""
    out: List[Pack] = []
    for kind, key in [("", "general"), *[("cuisines", c) for c in cuisines], ("languages", lang or "en")]:
        p = load(kind, key)
        if p and p not in out:
            out.append(p)
    return out


def _render(pack: Pack, sections: List[Section]) -> str:
    return f"## {pack.title}\n" + "\n".join(f"- {s.title}: {s.text}" if "\n" not in s.text else f"- {s.title}:\n{s.text}"
                                            for s in sections)


def standing(cuisines: Iterable[str], lang: str) -> str:
    """The always-on sections — the same every turn for this restaurant (so it is cached with the menu)."""
    parts = [_render(p, ss) for p in packs(cuisines, lang)
             if (ss := [s for s in p.sections if s.when is None and not s.data])]
    return "\n\n".join(parts)


def for_turn(cuisines: Iterable[str], lang: str, text: str, budget: int = TURN_BUDGET) -> str:
    """The sections this turn's words call for (the guest's words and the waiter's last words), within a budget."""
    if not (text or "").strip():
        return ""
    parts: List[str] = []
    used = 0
    for p in packs(cuisines, lang):
        hits = [s for s in p.sections if s.when is not None and not s.data and s.when.search(text)]
        if not hits:
            continue
        block = _render(p, hits)
        if used + len(block) > budget:
            # keep whole sections only — the first that fit
            kept = []
            for s in hits:
                piece = _render(p, kept + [s])
                if used + len(piece) > budget:
                    break
                kept.append(s)
            if kept:
                parts.append(_render(p, kept))
            break
        parts.append(block)
        used += len(block)
    return "\n\n".join(parts)


def _words(raw: str) -> List[str]:
    return [w.strip().lower() for w in (raw or "").split(",") if w.strip()]


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


@dataclass
class Slot:
    name: str
    start: int
    end: int
    lead: List[str]
    avoid: List[str]

    def covers(self, minute: int) -> bool:
        return self.start <= minute < self.end if self.start < self.end else (minute >= self.start or minute < self.end)


_SLOT = re.compile(r"^-\s*([\w ]+?)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*:\s*lead\s+([^;]+?)\s*(?:;\s*avoid\s+(.+?))?\s*$", re.I)
_PAIR = re.compile(r"^-\s*(.+?)\s*(->|→|~>)\s*(.+?)\s*$")


def _data(type_key: Optional[str], title: str) -> List[str]:
    """Every line of that data section in the restaurant type's pack (knowledge/types/<type>.md)."""
    p = load("types", type_key) if type_key else None
    return [line.strip() for s in (p.sections if p else []) if s.title.strip().lower() == title
            for line in s.text.splitlines() if line.strip().startswith("-")]


def type_keys() -> List[str]:
    """Every restaurant type there is a pack for (knowledge/types/*.md)."""
    d = os.path.join(ROOT, "types")
    return sorted(f[:-3] for f in os.listdir(d) if f.endswith(".md")) if os.path.isdir(d) else []


def restaurant_type(shares: Dict[str, Any]) -> str:
    """The restaurant's general TYPE, read from its menu (menu_profile.cuisine_shares) — never from what the owner
    picked in onboarding: every type's "Detect" rule is checked, the best match wins, "general" when none fits. So a
    Chinese + fast-food café is that type whichever of the two it has more of, and behaves like every other one."""
    best, best_score = "general", 0.0
    for key in type_keys():
        rules = _data(key, "detect")
        if not rules:
            continue
        for rule in rules:
            parts = dict((k.strip().lower(), _words(v)) for k, _s, v in
                         (p.partition(":") for p in rule.lstrip("- ").split(";")) if v.strip())
            share = lambda c: float(shares.get(c) or 0)  # noqa: E731
            if any(share(c) < MIN_SHARE for c in parts.get("all", [])):
                continue
            if parts.get("any") and not any(share(c) >= MIN_SHARE for c in parts["any"]):
                continue
            if "rice house" in parts.get("needs", []) and not shares.get("rice house"):
                continue
            score = sum(share(c) for c in parts.get("all", []) + parts.get("any", []))
            score += 1.0 if parts.get("needs") else 0.0  # (a rice house is a strong, structural sign)
            if score > best_score:
                best, best_score = key, score
    return best


def type_title(type_key: str) -> str:
    p = load("types", type_key)
    return p.title if p else type_key


def schedule_now(type_key: Optional[str], minute: Optional[int]) -> Optional[Slot]:
    """What leads at this time of day by the restaurant type's default day. None with no time, or no schedule."""
    if minute is None:
        return None
    for line in _data(type_key, "schedule"):
        m = _SLOT.match(line)
        if m:
            slot = Slot(m.group(1).strip().lower(), _mins(m.group(2)), _mins(m.group(3)),
                        _words(m.group(4)), _words(m.group(5) or ""))
            if slot.covers(minute):
                return slot
    return None


def needs_base(type_key: Optional[str]) -> List[Tuple[List[str], List[str], bool]]:
    """[(dish words, the bases they go with, must)] — "masala -> fried rice" (never alone: no base on, not suggested),
    "কাবাব ~> নান" (goes well with: the naan named when it's on, the kebab still suggested when it isn't)."""
    out = []
    for line in _data(type_key, "needs a base"):
        m = _PAIR.match(line)
        if m:
            out.append((_words(m.group(1)), _words(m.group(3)), m.group(2) != "~>"))
    return out


def word_in(word: str, text: str) -> bool:
    """A schedule / pairing word in a dish's text: Bangla anywhere inside, Latin as whole words ("rice", not "price")."""
    if re.search(r"[^\x00-\x7f]", word):
        return word in text
    return bool(re.search(rf"\b{re.escape(word)}s?\b", text))


def cuisine_keys(glance: Optional[dict]) -> List[str]:
    """menu_profile.menu_glance(...)["cuisine"] → ["bangla", "kabab", …] (most of the menu first)."""
    out = []
    for c in (glance or {}).get("cuisine") or []:
        key = c[0] if isinstance(c, (list, tuple)) else c
        if key and key not in out:
            out.append(str(key))
    return out
