"""Hands-free turn-taking (endpointer.py): the turn ends soon after the guest stops, never on noise alone, and a
listen window with only other people talking closes quietly. Real clips come from qravy.stt_ab when the database
has them (guests' own recordings — never copied into the repo); the noise/silence checks always run."""
import io
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import endpointer as E  # noqa: E402

RNG = np.random.default_rng(3)


def run(sig, **kw):
    ep = E.Endpointer(**kw)
    events = []
    pcm = (np.clip(sig, -1, 1) * 32767).astype("<i2").tobytes()
    for i in range(0, len(pcm), 640):  # 20 ms chunks, as the app sends them
        e = ep.push(pcm[i:i + 640])
        if e:
            events.append((e, i / 32000))
        if ep.done:
            break
    return dict(events), ep


def clips():
    try:
        from pymongo import MongoClient

        db = MongoClient(os.environ.get("MONGO_URI", "mongodb://mongo:27017"), serverSelectionTimeoutMS=1500)["qravy"]
        out = []
        for d in db.stt_ab.find({}, {"wav": 1}).limit(13):
            w = wave.open(io.BytesIO(bytes(d["wav"])))
            out.append(np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768)
        return out
    except Exception:
        return []


def test_noise_and_silence_never_start_a_turn():
    silent = np.zeros(16000 * 4, np.float32)
    ev, _ = run(silent, listen_ms=3000)
    assert ev == {"silence": ev.get("silence")} and 2.9 <= ev["silence"] <= 3.1, ev
    # clatter: random clicks and hiss, loud
    clatter = RNG.normal(0, 0.02, 16000 * 4).astype(np.float32)
    clatter[RNG.integers(0, len(clatter), 40)] = 0.9
    ev, _ = run(clatter, listen_ms=3000)
    assert "start" not in ev and "silence" in ev, ev
    # a steady tone (a fan, a fridge) isn't speech
    tone = (0.3 * np.sin(2 * np.pi * 180 * np.arange(16000 * 4) / 16000)).astype(np.float32)
    ev, _ = run(tone, listen_ms=3000)
    assert "start" not in ev, ev


def test_a_real_guest_turn_ends_soon_after_they_stop():
    cs = clips()
    if not cs:
        print("  (no saved clips in this database — skipped)")
        return
    for c in cs:
        idx = np.where(np.abs(c) > 0.05 * np.abs(c).max())[0]
        voice_end = idx[-1] / 16000 + 0.5
        sig = np.concatenate([np.zeros(8000, np.float32), c, np.zeros(16000 * 3, np.float32)])
        ev, ep = run(sig)
        assert "start" in ev and "end" in ev, ev
        assert voice_end - 0.15 <= ev["end"] <= voice_end + 1.6, (ev, voice_end)  # ~0.9 s after, never mid-sentence
        assert ep.voice_level() is not None


def test_a_follow_up_ignores_the_next_table_but_hears_the_guest():
    cs = clips()
    if len(cs) < 3:
        print("  (no saved clips in this database — skipped)")
        return

    def level(c):
        f = c[: len(c) // 512 * 512].reshape(-1, 512)
        r = np.sqrt((f * f).mean(1))
        return r[r > 0.3 * r.max()].mean()

    heard = opened = 0
    for k, c in enumerate(cs):
        _, first = run(np.concatenate([np.zeros(8000, np.float32), c, np.zeros(16000 * 2, np.float32)]))
        ref = first.voice_level()
        others = np.concatenate([x / level(x) for j, x in enumerate(cs) if j != k])
        table = np.resize(np.roll(others, RNG.integers(len(others))), 16000 * 6) * level(c) * 10 ** (-20 / 20)
        ev, _ = run(table + RNG.normal(0, 0.003, len(table)), listen_ms=5000, ref_db=ref)
        opened += "start" in ev
        ev, _ = run(np.concatenate([np.zeros(8000, np.float32), c, np.zeros(16000 * 2, np.float32)]),
                    listen_ms=5000, ref_db=ref)
        heard += "end" in ev
    assert opened <= 1, f"the next table (20 dB quieter) opened {opened}/{len(cs)} turns"
    assert heard >= len(cs) - 1, f"the guest was heard {heard}/{len(cs)}"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
