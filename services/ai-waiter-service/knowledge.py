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
from typing import Dict, Iterable, List, Optional, Tuple

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


# sections that are data for the code, in a cuisine pack:
#   ## Schedule
#   - morning 06:00-11:30: lead set menu, fried rice; avoid burger
#   ## Needs a base
#   - masala, chili onion, sweet and sour -> fried rice, chowmein
DATA_SECTIONS = {"schedule", "needs a base"}


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


def _data(cuisines: Iterable[str], title: str) -> List[Tuple[str, str]]:
    """(cuisine, line) for every line of that data section in the menu's cuisine packs (most of the menu first)."""
    out = []
    for c in cuisines:
        p = load("cuisines", c)
        for s in (p.sections if p else []):
            if s.title.strip().lower() == title:
                out += [(c, line.strip()) for line in s.text.splitlines() if line.strip().startswith("-")]
    return out


def schedule_now(cuisines: Iterable[str], minute: Optional[int]) -> Optional[Slot]:
    """What leads at this time of day by the cuisines' default schedules — the menu's main cuisine first, the others'
    "lead" words added (a café that's Chinese AND fast food). None when no pack has a schedule, or no time is known."""
    if minute is None:
        return None
    found: Optional[Slot] = None
    for _c, line in _data(cuisines, "schedule"):
        m = _SLOT.match(line)
        if not m:
            continue
        slot = Slot(m.group(1).strip().lower(), _mins(m.group(2)), _mins(m.group(3)),
                    _words(m.group(4)), _words(m.group(5) or ""))
        if not slot.covers(minute):
            continue
        if found is None:
            found = slot
        else:  # (another cuisine of the menu, the same time of day: its lead words too, never its "avoid" over ours)
            found.lead += [w for w in slot.lead if w not in found.lead]
            found.avoid += [w for w in slot.avoid if w not in found.avoid and w not in found.lead]
    if found:
        found.avoid = [w for w in found.avoid if w not in found.lead]
    return found


def needs_base(cuisines: Iterable[str]) -> List[Tuple[List[str], List[str], bool]]:
    """[(dish words, the bases they go with, must)] — "masala -> fried rice" (never alone: no base on, not suggested),
    "কাবাব ~> নান" (goes well with: the naan named when it's on, the kebab still suggested when it isn't)."""
    out = []
    for _c, line in _data(cuisines, "needs a base"):
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
