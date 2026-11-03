# Waiter knowledge packs

Plain-text knowledge the AI waiter reads — no code. Edit these files to teach the waiter; the server picks changes up
on the next turn (no restart).

```
knowledge/
  general.md              every restaurant, every language
  cuisines/<cuisine>.md   used when a menu is that cuisine (detected from the dish names — menu_profile.py)
  languages/<code>.md     used when the guest speaks that language (bn, en, …)
```

Cuisine file names: bangla, chinese, thai, japanese, korean, indian, kabab, arabian, fast-food, seafood, street-food,
sweets, bakery, cafe, juice. A new cuisine needs its key in `menu_profile._CUISINES` and a file here; a new language
needs a file here (and the language in the brain's reply languages).

## Format

```
# Title of the pack

## A topic
when: word, another word, শব্দ          ← optional — the section is added only when the guest's words contain one
What a good waiter knows about it, in plain sentences.
```

- No `when:` → always included for that restaurant. Keep those few and short (they go into every turn).
- With `when:` → included only on turns that mention those words (any language — add the Bangla, English, Banglish
  words people really say).
- Write general knowledge only. Never a specific restaurant's name, dish names from one menu, prices, or "if the guest
  says X, reply Y". Each restaurant's own dishes, prices and hours come from its menu automatically.
- Short beats long: a turn takes at most ~1,600 characters of triggered sections.

## Restaurant types (knowledge/types/) — the day's schedule
Every restaurant is ONE general type, read from its menu (never from the category picked in onboarding): the share of
its dishes per cuisine decides it, so every restaurant of a type behaves the same. A type pack has three data sections,
read by the code and never pasted into the AI's instructions — keep the line format exactly:

    ## Detect
    - all: chinese, fast food           (each at least 8% of the menu)   ·  "any: cafe, juice"  ·  "needs: rice house"
    ## Schedule
    - morning 06:00-11:30: lead set menu, fried rice; avoid sizzling, platter
    (…the whole day; past midnight is fine: "late night 22:30-06:00")
    ## Needs a base
    - masala, chili onion, curry -> fried rice, chowmein      (never alone: no base on now → not suggested)
    - kebab, chaap ~> naan, paratha                           (goes well with: named together when the base is on)

The best-matching type wins; none → general.md. `lead` / `avoid` / the words around the arrow are matched against each
dish's name, section and kind (Bangla words anywhere inside, English words whole). The schedule decides what LEADS a
suggestion at that time — what can be ordered still comes from the restaurant's own hours. A new kind of restaurant is
a new type file. The cuisine packs (knowledge/cuisines/) hold what the dishes ARE, whatever the type.

**Country:** every type file is the Bangladesh default (all restaurants today are in Bangladesh). For the first
restaurant in another country, add knowledge/types/<country>/<type>.md with that country's day, and teach knowledge.py
to prefer it for restaurants in that country (the country is stored per restaurant from onboarding) — about an hour.
