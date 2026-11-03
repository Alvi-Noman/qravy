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

## Data sections (read by the code, never pasted into the AI's instructions)
A cuisine pack may have two sections the code reads — keep the line format exactly:

    ## Schedule
    - morning 06:00-11:30: lead set menu, fried rice, soup; avoid sizzling, platter
    - lunch 11:30-16:00: lead set menu, platter, fried rice
    (…every time of day, wrapping past midnight is fine: "late night 22:30-06:00")

    ## Needs a base
    - masala, chili onion, curry -> fried rice, chowmein      (never alone: no base on now → not suggested)
    - kebab, chaap ~> naan, paratha                           (goes well with: named together when the base is on)

`lead` / `avoid` / the words before and after the arrow are matched against each dish's name, section and kind (Bangla
words anywhere inside, English words whole). The schedule decides what LEADS a recommendation at that time of day —
what can be ordered still comes from the restaurant's own hours. A menu with several cuisines uses its main cuisine's
time slots and adds the others' lead words.
