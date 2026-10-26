"""The waiter's architecture rules (CLAUDE.md), enforced. The owner doesn't review code — these checks do.

1. No new Bangla text in the brain's code: Bangla words in code are reply sentences or menu words, and both belong
   elsewhere (the AI writes replies; menu words come from the menu; cuisine/language knowledge goes in knowledge/).
   The counts below may only go DOWN. Raising one needs the owner's approval (say why in the commit).
2. No restaurant's name in code or in the knowledge packs.
3. The knowledge packs load, and stay small enough for a fast turn.
Run: python -m pytest tests/test_architecture_rules.py
"""
import glob
import io
import os
import re
import sys
import tokenize

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import knowledge  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BN = re.compile("[ঀ-৿]")

# Bangla string literals per file, as of the knowledge-pack split (2026-10-26). Lower is better; never higher.
BANGLA_LITERALS_MAX = {
    "availability.py": 22,
    "bangla_meal.py": 14,
    "bhorta_bhaji.py": 128,
    "bn_translit.py": 411,
    "brain.py": 1496,
    "checkout.py": 56,
    "followups.py": 65,
    "menu_answers.py": 54,
    "menu_profile.py": 103,
    "normalizer.py": 96,
    "offers.py": 112,
    "pairing.py": 46,
    "reco_format.py": 45,
    "recommender.py": 83,
    "server.py": 19,
    "tray.py": 16,
    "upsell.py": 21,
    "wait_talk.py": 26,
    "wait_time.py": 7,
    "waiter_knowledge.py": 383,
}

# restaurants that use Qravy — their names must never be in code or knowledge (each restaurant's data is its own)
RESTAURANT_NAMES = [
    "sholoaana", "sholoana", "ষোলআনা", "ষোল আনা বাঙালি", "khanafa", "aylanto", "teaology", "burger house",
    "burger-house", "qravy crust",
]


def _bangla_literals(path: str) -> int:
    n = 0
    with io.open(path, encoding="utf-8") as f:
        for tok in tokenize.generate_tokens(f.readline):
            if tok.type != tokenize.STRING or not _BN.search(tok.string):
                continue
            if tok.string.lstrip("rbuRBUfF").startswith(('"""', "'''")):
                continue  # docstrings / long comments: explanations, not replies
            n += 1
    return n


def test_no_new_bangla_text_in_code():
    grown = []
    for path in sorted(glob.glob(os.path.join(ROOT, "*.py"))):
        name = os.path.basename(path)
        n = _bangla_literals(path)
        cap = BANGLA_LITERALS_MAX.get(name, 0)
        if n > cap:
            grown.append(f"{name}: {n} Bangla strings (max {cap})")
    assert not grown, (
        "New Bangla text in the waiter's code — reply sentences are the AI's, menu words come from the menu, cuisine "
        "and language knowledge goes in knowledge/ (see CLAUDE.md):\n  " + "\n  ".join(grown)
    )


def test_no_restaurant_names_in_code_or_knowledge():
    hits = []
    files = glob.glob(os.path.join(ROOT, "*.py")) + glob.glob(os.path.join(ROOT, "knowledge", "**", "*.md"), recursive=True)
    for path in files:
        text = io.open(path, encoding="utf-8").read().lower()
        for name in RESTAURANT_NAMES:
            if name.lower() in text:
                hits.append(f"{os.path.relpath(path, ROOT)}: {name}")
    assert not hits, "A restaurant's name in code/knowledge (its data is its own):\n  " + "\n  ".join(hits)


def test_knowledge_packs_load_and_stay_small():
    for path in glob.glob(os.path.join(ROOT, "knowledge", "**", "*.md"), recursive=True):
        if os.path.basename(path) == "README.md":
            continue
        rel = os.path.relpath(path, os.path.join(ROOT, "knowledge")).replace("\\", "/")
        kind, key = (rel.split("/")[0], os.path.splitext(rel.split("/")[1])[0]) if "/" in rel else ("", os.path.splitext(rel)[0])
        pack = knowledge.load(kind, key)
        assert pack and pack.sections, f"{rel}: no sections"
        for s in pack.sections:
            assert not re.search(r"৳\s*\d|\$\s*\d|tk\.?\s*\d", s.text, re.I), f"{rel} / {s.title}: no prices in knowledge"
    # the always-on part for a busy restaurant stays small (it is in every turn)
    assert len(knowledge.standing(["bangla", "kabab", "fast food"], "bn")) < 4000
