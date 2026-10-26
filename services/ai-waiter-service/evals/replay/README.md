# Replay set

Real guest turns, replayed through the waiter with the real model, at the original time of day and with that
restaurant's menu — the proof required before any brain change ships (see ../../CLAUDE.md).

The data is real guests' words, so it is **not in git**. Keep it in a private folder:

```
<data>/menus.json   restaurants' menus (subdomain → name, tz, opening, periods, items)
<data>/cases.py     CASES = [(id, subdomain, "HH:MM", [guest turns], expect)]  — bad answers that must now be right
<data>/good.json    [{id, restaurant, at, turns}]                             — ordinary turns, compared before/after
```

Run (needs `OPENAI_API_KEY`):

```
python evals/replay/run.py --data <data> --mode both --out report.json
```

`--mode current` is today's flow; `--mode ai-first` is the target architecture (word-pattern answers become facts for
the model). The summary prints how many expectations hold and how many replies were written by rules instead of the AI.
Every new bad conversation → a new case with its expectation. Never loosen an expectation to make a change pass.
