# AI waiter — rules for anyone (human or AI agent) changing it

Read this before touching `brain.py` or anything the waiter says. The owner does not review code: these rules and
the checks below are what keep the waiter good. Breaking them is not allowed even when a task seems to ask for it —
say so instead.

## What this service is
A voice/text waiter for restaurants in many countries, cuisines and languages. A guest speaks; speech-to-text gives
words; the brain decides what the guest wants, changes the tray, and replies (text + voice). It must be fast (one
model call per turn, small prompts) and correct (never invent dishes, prices or availability).

## The architecture (keep it)

```
guest words ─► facts the code works out ─► the AI understands + writes the reply ─► safety checks ─► reply + tray
              (menu, prices, what's on now,     (one model call, with the           (exact prices, only
               hours, the tray, knowledge        facts + knowledge packs)            orderable dishes,
               packs for this cuisine/language)                                      no silent swaps)
```

Three layers of knowledge — never mix them:

| Layer | What | Where | Who changes it |
|---|---|---|---|
| 1. Restaurant data | dishes, prices, categories, service periods, hours, sold out, branches | the database (admin panel) | the restaurant owner |
| 2. Facts per turn | what is on now, which dishes a word matches, what isn't on the menu, the tray | calculated in code from layer 1 | nobody — automatic |
| 3. Shared knowledge | how a cuisine's meals work, how a language's guests talk | `knowledge/` (plain-text packs) | Qravy, once per cuisine/language |

## Who does what
- **The AI** understands the guest (including garbled speech, several dishes in one sentence, "not X") and writes
  the reply in the guest's language.
- **Code** calculates facts (layer 2) and checks the AI's actions: a dish must exist and be orderable now, prices are
  the menu's, nothing is added that the guest didn't ask for, nothing is swapped silently.
- **Code may write only fixed confirmations**: what was added to/removed from the tray, totals, "order sent",
  checkout steps, staff call confirmations. Everything else is the AI's words.

`WAITER_AI_FIRST=1` turns on this split for menu questions and orders: the old word-pattern answers become CHECKED
FACTS for the model instead of replies. New work follows it; the old paths are being retired area by area.

## Forbidden
1. A new word pattern (regex / keyword list) that **answers the guest by itself**. Patterns may only produce facts or
   checks.
2. New reply sentences in code (Bangla, English or any language) other than the fixed confirmations above.
3. A restaurant's name, a specific dish name, a menu word or a price in code. Those come from the menu.
4. Fixing one bad conversation with a special case ("if the guest says X, reply Y"). See "How to fix a bad answer".
5. Cuisine or language knowledge in code. It goes in `knowledge/`.
6. A second model call per turn, or bigger always-on prompts, without measuring latency and cost first.
7. Changing a replay case's expectation to make a change pass.

## How to fix a bad answer (in this order)
1. **Wrong or missing data?** → the restaurant's data (tell the owner) or the fact calculation (layer 2, general for
   every restaurant).
2. **The AI lacked general knowledge?** → one or two plain lines in `knowledge/cuisines/<cuisine>.md` or
   `knowledge/languages/<lang>.md` (or `general.md`), with `when:` words so it only loads when relevant.
3. **The AI misread a kind of sentence?** → improve the instructions (PLAYBOOK / the turn block) in general terms.
4. **The AI did something unsafe?** → a check that blocks it and tells the model why (it rephrases).

Then add the conversation to the replay set (below) so it never comes back.

## Proof before shipping (required)
- `python -m pytest -q tests` — all unit tests pass.
- Replay set: `evals/replay/` — real guest turns with their restaurant's menu and the time of day. Run
  `python evals/replay/run.py --mode both` (needs `OPENAI_API_KEY`) before and after a change; every case's
  `expect` must hold, and the report must show no case that got worse. Add every new bad conversation as a case.
- `tests/test_architecture_rules.py` fails the build if reply sentences, restaurant names or menu words are added to
  the brain's code — don't weaken it.

## International by design
- Cuisine and language are separate: a Chinese restaurant in Dhaka speaks Bangla; a Bangladeshi one in London speaks
  English. Cuisines are detected from the dish names (`menu_profile._CUISINES`); the guest's language from their
  words (`waiter_knowledge.reply_language`).
- Meal times come from each restaurant's service periods and hours — never assume breakfast/lunch/dinner times.
- Prices: the menu's currency and numbers only.
- New cuisine: add its detection words to `menu_profile._CUISINES` and a `knowledge/cuisines/<key>.md`.
  New language: `knowledge/languages/<code>.md` + reply-language detection. No other code.

## Production care
Never deploy without the checks above. The live service is used by real restaurants; changes reach `main` only
after the owner approves.
