"""Voice matching for hands-free listen windows (voiceprint.py): the guest is never shut out, other people mostly
are, and anything too short / unknown is "can't tell" (the loudness checks decide). Real clips come from
qravy.stt_ab when the database has them; other speakers from /tmp/spk/sr-data-main when present (dev machines)."""
import glob
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import voiceprint as V  # noqa: E402
from test_endpointer import clips  # noqa: E402


def speech(c):
    idx = np.where(np.abs(c) > 0.05 * np.abs(c).max())[0]
    return c[idx[0]: idx[-1]]


def test_unknown_or_too_short_is_cant_tell():
    if not V.available():
        print("  (speaker model not installed — voice matching off, skipped)")
        return
    x = np.random.default_rng(0).normal(0, 0.05, 16000 * 2).astype(np.float32)
    assert V.same_guest("nobody-yet", x) == (None, None)  # no voiceprint yet → can't tell
    V.learn("s-short", x)
    assert V.same_guest("s-short", x[:8000]) == (None, None)  # 0.5 s → too short to judge
    V.forget("s-short")


def test_the_guest_is_never_shut_out_and_others_mostly_are():
    cs = [speech(c) for c in clips()]
    if not V.available() or len(cs) < 5:
        print("  (no speaker model / saved clips here — skipped)")
        return
    for c in cs[:3]:  # the guest's first turns (taps)
        V.learn("guest", c)
    judged = [V.same_guest("guest", c) for c in cs[3:]]
    assert all(ok is not False for ok, _ in judged), judged  # never rejects the real guest
    others = [p for p in glob.glob("/tmp/spk/sr-data-main/**/*.wav", recursive=True)]
    if others:
        rejected = 0
        for p in others:
            w = wave.open(p)
            o = speech(np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768)[: 3 * 16000]
            rejected += V.same_guest("guest", o)[0] is False
        assert rejected >= 0.8 * len(others), f"other speakers rejected {rejected}/{len(others)}"
        print(f"  other speakers rejected {rejected}/{len(others)}")
    V.forget("guest")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
