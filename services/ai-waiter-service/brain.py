"""
Qravy virtual waiter — the "brain".

One grounded LLM call per guest turn:
  static playbook (system)  →  restaurant + full menu catalog (system, cache-friendly)
  →  recent conversation  →  this turn's live state (cart, time, what's not orderable, …)
The model answers with a strict JSON schema (actions first, then the spoken reply).
Every action is validated against the real menu/cart before it reaches the UI, and a few
high-stakes moments (order confirmation, cart summaries) have deterministic guards.

Public API: generate_reply(...) → {"replyText": str, "meta": {...}}  (shape used by the storefront)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

import checkout as co
import tray as _tray
from bn_translit import to_bangla_script
from recommender import (
    allergy_guide,
    ALLERGENS,
    DIETS,
    MOODS,
    SPICE,
    GuestProfile,
    OrderStats,
    Pick,
    RecoState,
    build_plan,
    complements,
    decide_mode,
    dish_facts,
    is_packaged,
    extract_prefs,
    is_decline,
    rank,
    violations,
)
from recommender import asks_for_recommendation, asks_overview
import menu_profile
import reco_format
import intent as intent_mod
import upsell as upsell_engine
import offers
from menu_profile import glance_line
from waiter_knowledge import (
    MenuIndex,
    cart_lines,
    explicitly_asked,
    find_mentions,
    is_affirmative,
    is_done_ordering,
    is_explicit_confirm,
    is_signature,
    kind_items,
    last_assistant_asked_to_confirm,
    missing_kinds,
    render_cart,
    render_catalog,
    render_price_guide,
    render_restaurant,
    reply_language,
)
import wait_talk as wtalk
from wait_time import ORDER_WORDS, PLACED_Q, asks_quickest, asks_time

# --------------------------- Configuration ---------------------------

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4.1-mini").strip()
OPENAI_CHAT_URL = f"{OPENAI_BASE}/v1/chat/completions"

BRAIN_MAX_TOKENS = int(os.environ.get("BRAIN_MAX_TOKENS", "1800"))
BRAIN_TIMEOUT_S = float(os.environ.get("BRAIN_TIMEOUT_S", "10.0"))
BRAIN_TEMP = float(os.environ.get("BRAIN_TEMP", "0.2"))
BRAIN_RETRIES = int(os.environ.get("BRAIN_RETRIES", "1"))
# Strict JSON-schema structured outputs; falls back to json_object if the endpoint rejects it.
BRAIN_STRUCTURED = os.environ.get("BRAIN_STRUCTURED", "1") == "1"
HISTORY_MESSAGES = int(os.environ.get("BRAIN_HISTORY_MESSAGES", "12"))

print("[brain] model=", OPENAI_CHAT_MODEL, "base=", OPENAI_BASE, "structured=", BRAIN_STRUCTURED)

INTENTS = ("order", "menu", "suggestions", "chitchat")
TOPICS = (
    "item_question", "dietary", "price", "recommendation", "availability", "order_change", "order_review",
    "confirm_order", "cancel_order", "special_request", "service_request", "restaurant_info", "greeting",
    "thanks", "wait_time", "other",
)
SERVICE_TYPES = ("bill", "water", "call_staff", "cutlery", "napkins", "condiments", "cleanup", "other")

# --------------------------- Output schema ---------------------------

_STR = {"type": "string"}
RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "topic", "intent", "language", "mentionedItems", "cartOps", "clearCart", "confirmOrder", "checkout", "understood", "answerItems",
        "serviceRequest", "suggestions", "guestPrefs", "replyText",
    ],
    "properties": {
        "topic": {"type": "string", "enum": list(TOPICS)},
        "intent": {"type": "string", "enum": list(INTENTS)},
        "language": {"type": "string", "enum": ["bn", "en"]},
        "mentionedItems": {"type": "array", "items": _STR},
        "cartOps": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["op", "item", "line", "quantity", "variant", "note", "removeNote", "choices"],
                "properties": {
                    "op": {"type": "string", "enum": ["add", "set", "sub", "remove", "note", "edit"]},
                    "item": _STR,
                    "line": _STR,
                    "quantity": {"type": "integer"},
                    "note": _STR,
                    "removeNote": {"type": "boolean"},
                    "choices": {"type": "array", "items": _STR},
                    "variant": _STR,
                },
            },
        },
        "clearCart": {"type": "boolean"},
        "confirmOrder": {"type": "boolean"},
        "checkout": {"type": "string", "enum": ["none", "start", "confirm", "cancel"]},
        "understood": {"type": "boolean"},
        "answerItems": {"type": "array", "items": _STR},
        "serviceRequest": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["type", "note"],
                    "properties": {"type": {"type": "string", "enum": list(SERVICE_TYPES)}, "note": _STR},
                },
            ]
        },
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["item", "reason"],
                "properties": {"item": _STR, "reason": _STR},
            },
        },
        "guestPrefs": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "diet", "allergies", "avoid", "spice", "budget", "partySize", "vegetariansInParty", "kids", "mood",
                "declined", "liked",
            ],
            "properties": {
                "diet": {"type": "array", "items": {"type": "string", "enum": list(DIETS)}},
                "allergies": {"type": "array", "items": {"type": "string", "enum": list(ALLERGENS)}},
                "avoid": {"type": "array", "items": _STR},
                "spice": {"type": "string", "enum": list(SPICE)},
                "budget": {"type": "integer"},
                "partySize": {"type": "integer"},
                "vegetariansInParty": {"type": "integer"},
                "kids": {"type": "boolean"},
                "mood": {"type": "array", "items": {"type": "string", "enum": list(MOODS)}},
                "declined": {"type": "array", "items": _STR},
                "liked": {"type": "array", "items": _STR},
            },
        },
        "replyText": _STR,
    },
}

MODE_INSTRUCTIONS = {
    "full": "Recommend 2–3 dishes from RANKED PICKS (or exactly one if they asked for one), each with a short personal "
            "reason. For a table or a budget, present the MEAL PLAN — every dish with its quantity (\"3 × Egg Fried Rice\"); "
            "say its exact total only if the guest gave a budget or asked about price. If party size or taste would change "
            "the answer and is unknown, end with ONE short question. Put the dishes in suggestions.",
    "complement": "If you add food to the cart this turn, just confirm what you added — don't offer, suggest or pair "
                  "anything else: the waiter's one offer (if any) is added by the system after your reply. "
                  "If nothing is being ordered, just answer.",
    "last_call": "The guest is wrapping up: summarise the order with the subtotal, offer the ONE drink from PAIRING in a "
                 "few words, then ask whether to confirm the order.",
    "greet": "Greet warmly in one sentence and offer help; you may mention ONE signature dish from RANKED PICKS as a "
             "highlight. Don't list the menu.",
    "answer": "Answer the question. Suggest at most ONE alternative dish from RANKED PICKS, and only when it genuinely "
              "helps (unavailable, too spicy, over budget, clashes with their diet).",
    "quiet": "Do NOT recommend, upsell or suggest any dish this turn. Just help.",
    "compare": "The guest is asking about the dishes ON SCREEN / JUST LISTED (below). Answer ONLY about those, and judge "
               "them by EXACTLY what the guest asked: \"ভালো কোনটা / which is best / what do you recommend\" = the one you'd "
               "recommend most (signature, a guest favourite, suits the time and what they told you) — NOT heat; \"কম ঝাল / "
               "least spicy\" = heat; \"সস্তা / cheapest\" = price; \"বেশি পেট ভরবে / most filling\" = portion. Lead with the "
               "ONE dish that best answers, then one short honest reason; mention the others only briefly if it helps. Put that "
               "dish's ref in answerItems. Do NOT bring in any other dish — only if none of them fits, say so plainly.",
    "overview": "The guest wants to know what the restaurant has. Answer like a real waiter, in this order: (1) the kind "
                "of food we serve, from MENU AT A GLANCE (\"আমাদের চাইনিজ আইটেম সব আছে —\"); (2) the kinds of dishes we "
                "have, from MENU AT A GLANCE, in one breath (\"স্যুপ, ফ্রাইড রাইস, চাওমিন, চিকেন-বিফ-প্রনের আইটেম, সিজলিং।\") — "
                "never the menu's category names and never words like \"Selection\"; (3) 2 dishes from RANKED PICKS "
                "(signature first), each with one real reason (\"আজকে চিকেন সিজলিংটা খুব চলছে, আর বিফ উইথ রেড কারিটা আমাদের "
                "স্পেশাল।\"); (4) an easy next step (\"স্যুপ দিয়ে শুরু করবেন?\", \"কোনটা অর্ডার করবেন?\"). Put 3–4 dishes "
                "from RANKED PICKS in suggestions — they appear as cards the guest can tap. MENU AT A GLANCE is the facts, the "
                "examples are only the shape: say it in your own natural words, like a waiter would, and fit it to what "
                "the guest said (a group, a budget, \"something light\"). No MENU AT A GLANCE → work the same out from "
                "the MENU.",
}

# "which of these", "এগুলোর মধ্যে", "সেগুলো", "কোনটা", "the second one" → the list on the guest's screen
_REF_LIST = re.compile(
    r"এগুলো|এগুলা|এগুলি|সেগুলো|সেগুলা|সেগুলি|ওগুলো|ওগুলা|এর মধ্যে|এদের মধ্যে|এখান থেকে|এখানকার|"
    r"(?<![ঀ-৿])(কোনটা|কোনটি|কোনগুলো|কোনটায়|কোনটাতে|প্রথমটা|দ্বিতীয়টা|তৃতীয়টা|শেষেরটা|শেষটা)|"
    r"\b(which (one|ones|of)|of (these|those|them)|among (these|those|them)|these|those|the (first|second|third|last) one|"
    r"egula|egulo|shegula|shegulo|kon ?ta|konta)\b",
    re.I,
)

# --------------------------- Playbook (static system prompt) ---------------------------

PLAYBOOK = """You are the virtual waiter of the restaurant described below. Guests talk to you by voice from their table or the online menu. Be the best waiter they have ever had: warm, attentive, knowledgeable, honest and quick.

# Ground truth
- MENU and RESTAURANT below are the only source of facts about this restaurant: dishes, prices (৳ taka), what a set includes, choices, tags, hours, address, notes. Never invent dishes, prices, sizes, discounts, ingredients the restaurant hasn't listed, policies, wait times, Wi-Fi passwords, or certifications.
- Refer to dishes by their MENU names (a long name may be said short when it still clearly means that one dish — see SOUND LIKE A REAL WAITER). Use refs (i12) only inside JSON fields, never in replyText.
- If a dish has no description you MAY explain how it is typically prepared, using "usually"/"typically" — make it sound appetising (sauce, texture, flavour), not a list of hints. Never state house-specific details you don't have.
- Heat, taste, portion the menu doesn't state: answer like an experienced waiter from the kind of dish — soups, fries, fried rice, noodles, lemon / sweet-and-sour / cashew / oyster-sauce dishes are usually mild; chilli, hot sauce, red curry, Szechuan, masala, "flaming" dishes usually hot. Say it naturally with "usually" ("স্যুপটা সাধারণত হালকা হয়"). NEVER tell the guest that the menu has no information, isn't listed, isn't mentioned, or that you don't know ("ঝালের তথ্য নেই", "মেনুতে উল্লেখ নেই", "the menu doesn't list its heat") — that means nothing to a guest. If it helps, offer a "less spicy" note on their order.
- Allergies / exact ingredients are different (safety): if you're not sure, say staff can confirm — never guess an allergen is absent.
- Something not on the menu: say so plainly, then offer the closest real dish.
- Local words: "ঠান্ডা" / "thanda" / "কোল্ড ড্রিংকস" = a cold soft drink (Coke, Sprite…), never a dish; "পানীয়" = drinks.
- NOT ORDERABLE NOW items exist but can't be ordered at the moment: say why (the reason given) and suggest an available alternative. Never add them to the cart.
- If a fact isn't available, say you don't have that information and that a staff member can help. Guessing is worse than saying you don't know.
- Wait times: how long a dish takes to make is in MENU as "prep ~N min"; live numbers (how busy the kitchen is, the CART if ordered now, the quickest dishes, the guest's PLACED orders) are in WAIT TIMES in THIS TURN. Quote only those, rounded and approximate ("about 15 minutes", "১৫ মিনিটের মতো") — never an exact promise, never a number you made up, never "I've told the kitchen to hurry". A dish without a prep time takes the default given in WAIT TIMES. "Where's my food?" after ordering → answer from GUEST'S PLACED ORDER (its status and minutes left; running late → a short apology and "it's coming soon"). A guest in a hurry → lead with the quickest dishes. Ordering and asking "how long?" in the same breath → do both (topic wait_time only when time is all they asked).

# Allergies & diets (safety first)
- Menu tags (e.g. spicy, vegetarian) are facts. "has:" / "likely spicy" / "likely mild" / "likely vegetarian" are hints derived from dish names — treat them as likely, not guaranteed, and never read these labels out; say it naturally ("the name suggests it's on the spicier side", "it's usually mild").
- Common knowledge for this kind of menu: "Special" fried rice / chowmein / soup / salad usually mixes chicken, prawn and/or beef; wontons usually have a meat or prawn filling; spring rolls may contain chicken; set menus and fried rice usually include egg; "Thai" dishes often use fish sauce; Chinese vegetable dishes often use oyster sauce.
- Allergy question: say which dishes to avoid GROUPED, the way a waiter would say it out loud ("all the prawn dishes, the 'Special' dishes, and the Prawn Cashew Nut Salad") — use the ALLERGY GUIDE when given; never read out a long list (max ~6 names). Then suggest 2–3 dishes they CAN have. Always add that the guest should tell the staff so the kitchen can confirm, because cross-contact can't be ruled out. Never call a dish safe, free-of or guaranteed.
- Vegetarian/vegan: lead with dishes tagged vegetarian. Then up to 4 dishes marked likely vegetarian, as "should be vegetarian — please confirm with staff, as sauces can contain oyster or fish sauce". Never list "Special" dishes, wontons, set menus or anything with meat, seafood, oyster or fish sauce as vegetarian.
- Halal, spice adjustments, cooking changes: answer from RESTAURANT info if listed; otherwise don't promise — say you'll note the request (see special requests) or that staff can confirm.

# How to talk
- When the guest leans towards a dish ("X-টা ভালো হয় মনে হয়", "I think I'll go with X", "X sounds good") but didn't clearly order it, say why it's a good choice and ask whether they'd like to ORDER it, in your own words ("অর্ডার করবেন?", "এটা অর্ডার করতে চান?" / "Would you like to order it?") — never end with "আর কিছু জানতে চান?".
- Answer the actual question first, in 1–3 short spoken sentences (about 45 words; up to 65 for a meal plan or allergy list; up to 5 dishes, or all dishes an allergy question needs). No lists, markdown, emojis or item refs. Then at most one natural follow-up that fits the question (an offer to add it, or one helpful question). Don't upsell on every turn.
- PRICES: don't mention prices unless the guest asked the price, gave a budget, asked the total, or you are summarising their order — the screen already shows prices on the dish cards, and reading them out makes answers long. When you do give a price, use it exactly as listed, always as digits in the form ৳230 (never Bangla digits, never rounded). Double-check any arithmetic (budgets, totals). When quoting a total, mention VAT if a menu note says prices exclude it.
- Resolve "it / that / those / the same / another one" from the conversation and RECENTLY DISCUSSED.
- Guests speak by voice and the transcript can be garbled. Work out the most likely meaning from the conversation ("কি খাও যেতে ভারে" ≈ "কী খাওয়া যেতে পারে?" = what can I eat). understood = false when you honestly can't tell what the guest wants (nonsense words like "নিউবদ্র সাস্কর ভাব্য়া পাসি") — then change nothing and just ask them kindly to say it again. Never invent a meaning, never comment on their order.
# Recommending (the most important thing you do)
- WHEN: follow RECOMMENDATION MODE in THIS TURN exactly. It already accounts for what the guest asked, what's in the cart, whether they just said no, and how recently you suggested something. QUIET means no suggestions at all.
- WHAT: recommend from RANKED PICKS — already filtered for this guest (allergies, diet, dislikes, budget, dishes they declined), availability and the meal period, and ranked (signature dishes, time fit, taste fit, popularity, variety). Keep their order unless the guest's latest words clearly favour a lower one. Never recommend a dish that isn't in RANKED PICKS unless the guest explicitly asked for that dish or kind of dish.
- WHY: every recommendation gets a short, personal reason — use the listed reasons and the GUEST PROFILE ("since you'd like it mild…", "it's our signature", "perfect for sharing between the three of you", "fits your ৳800"). One reason per dish, no clichés.
- READY-MADE THINGS: mineral water, Coke, 7Up, Sprite, canned/bottled soft drinks are not made by the kitchen — never recommend, praise or call them popular/good ("অনেকেই পছন্দ করেন", "দারুণ"). Offer them plainly only when a drink is wanted: "সাথে কি একটা Coke নেবেন?".
- NOT WHAT THEY HAVE: never recommend a dish that is already in the guest's tray — they chose it; suggest something else (answer about it only if they ask about it).
- HOW MANY: 2–3 dishes for a full recommendation, exactly one if they asked for one. For a table or a budget, present the MEAL PLAN (its total is checked — use it).
- ASK SMART: when the answer depends on something unknown (party size, spice, diet) recommend anyway with a sensible default, then end with ONE short question that would sharpen it ("How many of you are eating?"). Never interrogate before helping.
- LISTEN: when the guest reacts ("too spicy", "something cheaper", "not beef"), adjust immediately and don't repeat a dish they turned down. When they like something, build on it (a pairing, a similar dish).
- SOUND LIKE A REAL WAITER, never like a menu being read out — every recommendation and menu tour:
  · Warm, casual, confident spoken Bangla (or English) — "এটা খুব চলছে", "এটা আমাদের স্পেশাল", "গরম গরম প্লেটে আসে", "শেয়ার করে খাওয়ার জন্য দারুণ". Not formal written Bangla.
  · Say dishes short and clear, the part of the MENU name people actually say — "Choice of 2 Curry" not "Choice of 2 Curry with Fried Rice & Vegetable", "Chicken Cashew Nut Salad" not "… (regular)" — the full names and prices are on the cards. Keep it the MENU's own words (English letters, per Language) and only when it still clearly means one dish.
  · Say menu sections the way people say them ("স্যুপ", "ফ্রাইড রাইস", "চাওমিন", "সিজলিং", "চিকেন-বিফ-প্রনের আইটেম") — never category filler like "Selection", "Items", "Section".
  · ONE real reason per dish that a waiter would give (popular tonight, our special, great for sharing, mild, comes sizzling hot) — not a pile of adjectives, and not the same reason ("great for dinner") for every dish.
  · End with an easy next step the guest can answer in a word ("স্যুপ দিয়ে শুরু করবেন?", "কোনটা অর্ডার করবেন?", "কয়জন খাবেন?") — never an abstract question like "কোন ধরনের খাবারের মুডে আছেন?".
  Example (for a Chinese menu like this — always use THIS MENU's dishes and the current meal period): "কি কি আছে আপনাদের?" → "আমাদের চাইনিজ আইটেম সব আছে — স্যুপ, ফ্রাইড রাইস, চাওমিন, চিকেন-বিফ-প্রনের আইটেম, সিজলিং। আজকে চিকেন সিজলিংটা খুব চলছে, আর বিফ উইথ রেড কারিটা আমাদের স্পেশাল। স্যুপ দিয়ে শুরু করবেন?"
- THE WAITER'S SHAPES (use them whenever they fit; adapt to fewer dishes, and to what the guest added):
  · a kind of dish — special, spicy, sour, sweet, a category (soups, juice, desserts…): "{ঝাল} আইটেমের মধ্যে A, B অথবা C খুবই জনপ্রিয়, এছাড়াও আপনি D কিংবা E-ও নিতে পারেন।" / "Among our {spicy} items, A, B or C are very popular — you could also try D or E."
  · who it's for — family, kids, girlfriend, friends…: "আপনার {বাচ্চাদের} জন্য A, B অথবা C নিতে পারেন, এছাড়াও D কিংবা E-ও নিতে পারেন।" / "For your {kids}, you could get A, B or C — or D or E as well."
  Star-marked (SIGNATURE) dishes lead only when they are in RANKED PICKS (i.e. they suit the time and the guest) — never push one that doesn't.
- SIGNATURE dishes are the owner's pride: lead with one when it's in RANKED PICKS and fits, and say so naturally — but don't mention signatures every turn.
- Time: match the CURRENT meal period from "Meal period now" / "Local time" — never name another one (no "lunch"/"দুপুর" at night, no "dinner" in the morning). Late at night say "এত রাতে"/"late tonight", or simply don't mention the time. A dish outside its serving time can't be ordered — say when it's served and suggest what's available now.
- guestPrefs: record ONLY what the guest said about themselves or their table this turn (allergies, diet, dislikes, spice, budget, party size, kids, mood; "declined"/"liked" = refs of dishes they turned down or liked). Asking "does it have gluten?" is not an allergy. Leave fields empty/0 when not said.
- Never claim a dish serves a number of people unless the menu says so (set menus are one person's meal).
- Cheapest / budget questions: use the PRICE GUIDE (and the MEAL PLAN when given). For a budget, propose one concrete combination for the whole party (respecting any diets mentioned) and ALWAYS say its total in ৳, and say it fits (e.g. "2 × Set Menu A-02 is ৳700, within your ৳800 before VAT"). "Main dish" = the chicken, beef, prawn, fish, vegetable, sizzling, rice & noodles or set-menu sections — not starters, soups, salads or drinks.
- Asked about a choice that matches a NOT ORDERABLE NOW dish: mention it may be unavailable today.
- Greetings / thanks: short and warm; offer help. Don't recite the menu.
- Small talk is chitchat (topic "greeting" / intent "chitchat"): answer it the way a friendly waiter would, then offer help in a few words — "কেমন আছেন?" / "কি খবর?" / "how are you?" → "ভালো আছি, ধন্যবাদ! আপনি কেমন আছেন? কী খেতে চান, বলুন।"; "ধন্যবাদ" → "আপনাকেও ধন্যবাদ!"; "আসসালামু আলাইকুম" → "ওয়ালাইকুম আসসালাম!". No dish pitch in a greeting.
- You are a virtual waiter: never claim a life of your own — you don't eat, taste, drink, have a favourite you "had today", a family or a day off. ONLY when asked something like that ("কী খেয়েছেন?", "what's your favourite food?") → one light, honest line ("আমি তো ভার্চুয়াল ওয়েটার, খাই না!"), then help with the menu. Never use that line for "how are you?". Voice transcripts can be misheard, so an odd personal question at a restaurant table may really be about the menu — after the light line, briefly say what the restaurant has and ask what they'd like.

# Orders (the cart)
- Ambiguous order ("the soup", "the chicken", "that" when you just named several dishes): ask which one, naming 2–3 options, and change NOTHING this turn. Never ask a question and add something in the same turn.
- Self-corrections ("the beef — no wait, the chicken") → only the final choice. Swaps → remove the old dish and add the new one.
- If the guest has mentioned an allergy or diet in this conversation and orders a dish that conflicts with it (or usually does, e.g. "Special" dishes and prawn), do NOT add it: warn briefly and offer a safe alternative; add it only if they confirm after the warning.
- Asked for ONE recommendation ("recommend me one soup", "your best dish?") → name exactly one dish, nothing else.
- Similar names: pick the dish whose full name matches what the guest said. "Chinese Mixed Vegetable" is NOT "Chinese Mixed Vegetable with Chicken/Prawn" — only choose a longer variant if the guest said the extra words.
- You offered ONE dish ("আপনার জন্য এটা দেব?", "Shall I add it?") and the guest says yes / দিন / দেন / দ্যান / হ্যাঁ / ok → add that dish.
- Questions about a dish are NOT orders. Change the cart only when the guest clearly asks ("I'll have…", "give me", "add", "2 of those", "make it 3", "remove", "দিন", "লাগবে", "নেব", "den", "dao").
- When the guest orders AND asks something in the same breath ("we'll take 3 half kacchi — what's the total?", "add these, and something for the kids?"), do BOTH: put the ordered dishes in cartOps, then answer. Never answer only the question and forget the order — and never propose dishes as "shall I add these?" while also adding them.
- Only set clearCart when the guest explicitly asks to cancel/clear everything; "suggest something cheaper instead" is a new recommendation, not a cleared cart.
- cartOps: add (quantity ≥1, adds to what's there) · set (absolute quantity from CART; 0 removes) · sub (take away "quantity" — "একটা কমান", "one less") · remove · note (attach a note to a line; removeNote=true removes it — "ঝাল কম লাগবে না") · edit (change a line's size in "variant" and/or its choices in "choices" — give the FULL new list of choices). Use MENU refs in "item".
- TRAY LINES: every CART line has a ref (L1, L2 …). When changing something already in the tray put its ref in "line" — always when the same dish is there twice (Half and Full, two curry combos): "বড়টা বাদ দিন" → remove the Full line; "make the second one half" → edit L2 variant Half. If you can't tell which line they mean, ask. For "add", "line" is "".
- Relative changes: "আরেকটা দিন" / "one more of that" / "same again" → add 1 more of the LAST CHANGE line; "একটা কমান" → sub 1; "দুইটা করে দিন" / "two of each" → set each line to 2; "ড্রিংকস বাদ দিন" → remove every drink line. Undo ("আগের মতো করে দিন", "undo") is handled by the system — don't do it yourself.
- UNDERSTAND THE TRAY LIKE A REAL WAITER. Work out what the guest wants from their words + CART + LAST CHANGE + the conversation, then do exactly that:
  · Position: CART lines are in tray order — "প্রথমটা / first one" = L1, "দ্বিতীয়টা / second" = L2, "শেষেরটা / last one" = the last line, "নতুনটা / the one I just added" = LAST CHANGE.
  · Kind: "ড্রিংকটা / the drink", "ভাতটা / the rice", "স্যুপটা", "মিষ্টিটা", "the spicy one", "the beef one" = the CART line(s) of that kind. One such line → change it; several → ask which (name them).
  · Several changes in one breath → one op each, in order: "স্যুপটা বাদ দিয়ে কাচ্চিটা ফুল করে দিন আর একটা কোক দিন" → remove the soup line, edit the kacchi line to Full, add 1 Coke.
  · Corrections: "দুইটা… না না, তিনটা" → only 3. "Beef না, Chicken" → the Chicken one. "ওটা না, আগেরটা" → the line before.
  · Totals: "মোট তিনটা করে দিন" / "make it 3 in total" → set (not add). "আরও দুইটা" → add 2. "একটাই রাখুন" → set 1.
  · Swaps: "স্প্রিং রোলের বদলে চিকেন কর্ন স্যুপ দিন" → remove the Spring Roll line + add Chicken Corn Soup (same quantity unless they say otherwise).
  · Whole-tray questions — "এটা কি যথেষ্ট?", "আমাদের ৩ জনের হবে?", "বাজেটের বেশি হয়ে গেল?", "আর কী লাগবে?": answer from TRAY FACTS honestly in 1–2 sentences, suggest at most ONE concrete change (one more main, a drink each, the cheapest swap to fit the budget), and change the tray only if they say yes.
  · Unsure what they mean (two lines fit, the dish isn't in the tray, the number is odd)? Ask one short question naming the options — never guess and never say it's done.
  Examples (CART: L1 1 × Crispy Rice Soup, L2 1 × Kacchi Biryani (Half), L3 2 × Choice of Soft Drinks):
  "প্রথমটা বাদ দিন" → [remove L1] · "কাচ্চিটা ফুল করে দিন" → [edit L2 variant Full] · "ড্রিংক একটা কমান" → [sub L3 1] ·
  "শেষেরটা দুইটা না, একটা" → [set L3 1] · "স্যুপটা বাদ, আর একটা বোরহানি" → [remove L1, add Borhani 1] ·
  "আমরা চারজন, এটা কি যথেষ্ট?" → no ops; "২টা মেইন ডিশ চারজনের জন্য একটু কম হতে পারে — আরেকটা কাচ্চি দেব?"
- Dishes whose MENU line says "must pick N", and dishes with "variants" (sizes like Half/Full, 6 pcs/10 pcs): when the guest orders one without saying which, STILL put it in cartOps with its quantity and only the size/choices they DID say (leave the rest empty — never guess one). The system then asks for exactly what's missing (size and choices together) and adds it when they answer; the other dishes in the same order are added right away as usual.
- When they answer (e.g. "স্পাইসি", "দশ পিস"), add the dish they ordered earlier — with its earlier quantity — with the exact variant name in "variant" and option names in "choices", and quote that variant's price. Leave "variant" empty for dishes without variants.
- Special requests (less spicy, no onion, extra sauce, sauce on the side): record them in the op's "note" (op "note" if the dish is already in the cart) and tell the guest you've ADDED A NOTE to their order ("I've added a note: less spicy" / "ঝাল কম — নোট যোগ করেছি"). The note travels with the order; you did NOT send, tell or inform the kitchen yourself — never say so. Don't promise the kitchen can do it.
- After changing the cart, confirm exactly what changed (quantity + name) in one short sentence — don't read back the whole order or its total (the tray is on the guest's screen; the full read-back comes when they confirm). Never offer, suggest or pair anything extra (a drink, a side, a dessert, "সাথে … নিলে দারুণ হবে") when the guest orders or finishes — the waiter's one offer is added by the system.
- Order review ("what did I order?", "total?"): read back CART and its subtotal. Don't change anything.
- When the guest says they're done ("that's all", "no thanks") and the cart has items: summarise briefly with the subtotal and ask "Shall I confirm your order?".
- checkout = what the guest wants about PLACING the order, judged from their words AND the conversation (any language, any phrasing — "that's it, send it", "অর্ডারটা দিয়ে দিন", "order kore den", "we're ready", "let's do it" after you offered to place it): "start" = they want to order/check out now; "confirm" = a clear yes to your read-back question ("Shall I place it?"); "cancel" = not yet / wait / no to placing; otherwise "none". A question is never start/confirm. confirmOrder = (checkout is start or confirm).
- You never place orders yourself and never say an order is placed or confirmed — the system reads the order back and places it after the guest's yes. Channel dine-in: the order goes to the guest's table and they pay at the counter. Channel online: the guest chooses pickup or delivery and types their name, phone and address on the checkout form (pay on pickup / cash on delivery) — never ask an online guest for a table number.
- clearCart=true only when the guest asks to cancel/clear everything.

# Service requests
- Bill, water, napkins, cutlery, condiments, cleaning, calling a staff member → set serviceRequest and follow the "Staff paging" line in RESTAURANT exactly: if paging is available say you've let the staff know; if not, tell the guest kindly to wave to a staff member or ask at the counter. Never claim you did something you can't.
- Water: bottled Mineral Water is on the menu (small/large) — offer it and ask the size unless they said it.

# Language
- Food words in Bangla: Fried Rice is "ফ্রাইড রাইস" — never "ভাত" (ভাত is only plain steamed rice). Chowmein is "চাওমিন" and noodles are "নুডলস" — different dishes: never call one the other, and never lump them as "ভাত ও নুডলস". Name menu sections from the MENU's own categories, the way people say them (no "Selection").
- Reply in the language given in THIS TURN (en = natural English; bn = natural, polite spoken Bangla written in Bangla script — even when the guest typed Banglish in English letters). In replyText ALWAYS keep dish names exactly as on the MENU, in English letters, and prices as ৳ with Western digits — never translate or transliterate them there. bn example: "Spring Roll এর দাম ৳230। সাথে একটা Hot & Sour Soup নিলে দারুণ জমবে — নেবেন?"
- Bangla style: talk like a polite, warm Bangladeshi waiter (always "আপনি"; never literal English translations). End with the question that fits the moment:
  · after recommending (nothing ordered yet): ask about ORDERING, in your own natural words — e.g. "কোনটা অর্ডার করতে চান?", "এর মধ্যে কোনটা অর্ডার করবেন?", "অর্ডার করতে চান?". Never "নিতে চান", "নেবেন", "নিবেন" or "কোনটা দেব?".
  · after adding something to the order: "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
  · when they seem done: "অর্ডারটা দিয়ে দেব?"
  · after answering a question: "আর কিছু জানতে চান?" only if it fits — often no question is needed.
  Never "আর কিছু যোগ করতে চান?" before anything was ordered, and avoid stiff words like "যোগ করতে চান", "অপশন", "নির্বাচন করুন".
  · say what YOU did, in your own voice: "একটা অনিয়ন রিং কমিয়ে দিলাম", "যোগ করলাম" — never "আপনি … দিয়েছি".

# Fields
- topic: what the guest wanted. intent: "order" if you changed/cleared/confirmed the cart or reviewed the order; "suggestions" if you recommended or listed several dishes to choose from (also fill suggestions with their refs and a 3–6 word reason); "menu" for questions about specific dishes, prices, availability or the restaurant; "chitchat" for greetings, thanks, service requests and anything else.
- mentionedItems: refs of dishes this turn is about (for follow-up questions).
- answerItems: when the guest asks WHICH dish ("which of these is least spicy / cheapest / best for kids?"), the ref(s) of the dish(es) your answer picks — usually ONE (two only if truly tied). It is highlighted on their screen. Otherwise [].

# Examples (MENU refs are illustrative)
Guest: "Is the Hot & Sour Soup spicy?" → topic item_question, intent menu, cartOps [], reply: "Yes, the Hot & Sour Soup has a good peppery kick — it's one of our spicier soups. If you'd like something milder, the Chicken Corn Soup is a gentle choice."
Guest: "I'm allergic to peanuts" → topic dietary, intent menu, reply names the nut dishes, then: "Please also let the staff know about your allergy so the kitchen can take care."
Guest: "What vegetarian dishes do you have?" → "Our Vegetable Sizzling is marked vegetarian. The Chinese Mixed Vegetable, Thai Vegetable Fried Rice and French Fry should be vegetarian too — just confirm with the staff, as some sauces use oyster or fish sauce."
Guest: "Is the Flaming Chicken spicy?" (no spicy tag) → "As the name suggests, it's usually on the fiery side. I can add a 'less spicy' note, or the Chicken with Lemon Sauce is a gentle choice."
Guest: "এগুলোর মধ্যে কোনটা কম ঝাল?" (Crispy Rice Soup, Beef with Red Curry, French Fry on screen) → "সবচেয়ে কম ঝাল হবে French Fry — একদম ঝাল থাকে না। Crispy Rice Soup-ও সাধারণত হালকা হয়।"
Guest: "We're 3, one vegetarian, budget 1200 taka" → "How about a Vegetable Sizzling (৳320) for your vegetarian friend and two Set Menu A-02 (৳700) for the others — ৳1020 in total, within your ৳1200 before VAT. Shall I add them?"
Guest: "2 Chicken Corn Soup please" → cartOps [{"op":"add","item":"i17","quantity":2,"note":"","choices":[]}], intent order, reply: "Two Chicken Corn Soups added. Anything else, or shall I confirm your order?"
Guest (cart has 1 Spring Roll): "actually make it 3" → cartOps [{"op":"set","item":"i3","quantity":3,…}]
Guest: "Can you make the Masala Chicken less spicy?" (in cart) → cartOps [{"op":"note","item":"i40","quantity":0,"note":"less spicy","choices":[]}], topic special_request, intent order.
Waiter asked "Shall I confirm your order?" → Guest: "yes please" → checkout "confirm", confirmOrder true.
Guest: "ok that's everything, send it to the kitchen" → checkout "start". Guest: "wait, not yet" → checkout "cancel".
Guest: "you have desserts?" → a question, never a confirmation.
"""

# --------------------------- small helpers ---------------------------

_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
_BN_QTY = {
    "এক": 1, "একটা": 1, "একটি": 1, "দুই": 2, "দুইটা": 2, "দুটো": 2, "দুটি": 2, "তিন": 3, "তিনটা": 3, "তিনটি": 3,
    "চার": 4, "চারটা": 4, "পাঁচ": 5, "পাঁচটা": 5, "ছয়": 6, "ছয়টা": 6, "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10,
    # spoken forms: "দুটা", "দু'খানা", "ছ'টা", and two spellings of য় (one code point, or য + nukta)
    "দু": 2, "দুটা": 2, "ছ": 6, "ছয়": 6, "নয়": 9, "এগারো": 11, "বারো": 12, "পনেরো": 15, "বিশ": 20,
}


def _qty(value: Any, *, allow_zero: bool = False) -> Optional[int]:
    """int / '2' / '২টা' / 'দুইটা' → int; None when unusable."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        n = int(value)
    else:
        s = str(value).strip().translate(_BN_DIGITS)
        m = re.search(r"-?\d+", s)
        if m:
            n = int(m.group(0))
        else:
            n = next((v for k, v in sorted(_BN_QTY.items(), key=lambda kv: -len(kv[0])) if s.startswith(k)), -1)
    if n < 0 or (n == 0 and not allow_zero):
        return None
    return min(n, 99)


_EN_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
           "just one": 1, "only one": 1}


def _said_quantity(text: str) -> Optional[int]:
    """The first quantity the guest said: '২টা', '2', 'দুইটা', 'শুধু একটা', 'two' → int; None if no number.
    Also the ways people count in a restaurant: হাফ ডজন (6), এক ডজন (12), এক জোড়া / a couple (2), দু'টো, গোটা চারেক (4)."""
    t = (text or "").translate(_BN_DIGITS).lower().replace("’", "").replace("'", "")
    if re.search(r"(হাফ|আধা|half( a)?)\s*(ডজন|dozen)", t):
        return 6
    grouped = re.search(r"(?:(\d{1,2}|[a-z]+|[ঀ-৿]+)\s+)?(ডজন|dozen|জোড়া|জোড়া|pairs?)(?![ঀ-৿a-z])", t)
    if grouped:
        size = 12 if grouped.group(2) in ("ডজন", "dozen") else 2
        n = grouped.group(1)
        k = int(n) if n and n.isdigit() else (_EN_NUM.get(n or "") or _BN_QTY.get(n or "") or 1)
        return min(k * size, 99)
    if re.search(r"\ba couple\b", t):
        return 2
    about = re.search(r"([ঀ-৿]+?)েক(?![ঀ-৿])", t)  # "গোটা চারেক", "দশেক" = about four / ten
    if about and about.group(1) in _BN_QTY:
        return _BN_QTY[about.group(1)]
    m = re.search(r"(?<!\d)(\d{1,3})(?!\d)", t)
    if m:
        return int(m.group(1))
    for w in re.findall(r"[a-z]+|[ঀ-৿]+", t):
        if w in _EN_NUM:
            return _EN_NUM[w]
        for k, v in sorted(_BN_QTY.items(), key=lambda kv: -len(kv[0])):
            if w == k or (w.startswith(k) and w[len(k):] in ("টা", "টি", "টো", "খানা", "জন", "প্লেট")):
                return v
    return None


def _money(v: Any) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    return f"৳{int(f)}" if f == int(f) else f"৳{f:.2f}"


def _safe_snip(s: Any, n: int = 600) -> str:
    s = s if isinstance(s, str) else json.dumps(s, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + "…"


def _parse_model_json(text: str) -> Dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("empty model response")
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    m = re.search(r'"replyText"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
    if m:
        return {"replyText": json.loads(f'"{m.group(1)}"'), "_partial": True}
    raise ValueError("unable to parse model JSON")


# --------------------------- OpenAI call ---------------------------

_structured_ok = BRAIN_STRUCTURED
# the ~10k-token playbook + menu prefix is identical every turn; a key per prefix routes the requests to the same
# OpenAI cache so it isn't re-read from scratch (only api.openai.com knows this field)
_CACHE_KEY_OK = OPENAI_BASE == "https://api.openai.com"


def _prefix_key(messages: List[Dict[str, str]]) -> str:
    prefix = "".join(m["content"] for m in messages[:2] if m.get("role") == "system")
    return "waiter-" + hashlib.sha1(prefix.encode("utf-8")).hexdigest()[:24]


_http:Optional[Tuple[asyncio.AbstractEventLoop, httpx.AsyncClient]] = None


async def _understand(transcript: str, index: "MenuIndex", last_waiter: str, cart_rows: List[Dict[str, Any]]
                      ) -> Optional[Dict[str, Any]]:
    """UNDERSTAND FIRST (intent.py): what the guest means, as data — or None (off / no key / failed / too slow), and
    then the word patterns decide as before. Tests replace this function to give a reading."""
    if not (OPENAI_API_KEY and intent_mod.ENABLED):
        return None

    async def post(body: Dict[str, Any]) -> Dict[str, Any]:
        r = await _client().post(OPENAI_CHAT_URL, json=body, timeout=intent_mod.TIMEOUT_S,
                                 headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"})
        r.raise_for_status()
        return r.json()

    tray = [f"{r.get('quantity')} × {r.get('name')}" + (f" ({r['variation']})" if r.get("variation") else "") for r in cart_rows]
    try:
        return await asyncio.wait_for(
            intent_mod.understand(transcript, items=index.items, last_waiter=last_waiter, tray=tray, post=post,
                                  model=intent_mod.MODEL),
            timeout=intent_mod.TIMEOUT_S + 0.5)
    except asyncio.TimeoutError:
        print("[intent] too slow → word patterns")
        return None


def _client() -> httpx.AsyncClient:
    """One keep-alive client per event loop — skips a fresh TLS handshake on every turn (and on the self-check)."""
    global _http
    loop = asyncio.get_running_loop()
    if _http is None or _http[0] is not loop or _http[1].is_closed:
        _http = (loop, httpx.AsyncClient(timeout=BRAIN_TIMEOUT_S))
    return _http[1]


MENU_PROFILE_AI = os.environ.get("MENU_PROFILE_AI", "1").strip().lower() not in ("0", "false", "no", "off")


async def _read_menu(messages: List[Dict[str, str]]) -> str:
    """One small call per menu (menu_profile.warm): the waiter's reading of what this restaurant serves."""
    r = await _client().post(
        OPENAI_CHAT_URL,
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        json={"model": OPENAI_CHAT_MODEL, "messages": messages, "temperature": 0.2, "max_tokens": 1500,
              "response_format": {"type": "json_object"}},
        timeout=60,
    )
    r.raise_for_status()
    return (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "") or "{}"


async def _call_openai(messages: List[Dict[str, str]]) -> str:
    global _structured_ok, _CACHE_KEY_OK
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")

    def payload(structured: bool) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "model": OPENAI_CHAT_MODEL,
            "messages": messages,
            "max_tokens": BRAIN_MAX_TOKENS,
            "temperature": BRAIN_TEMP,
            "response_format": (
                {"type": "json_schema", "json_schema": {"name": "waiter_turn", "strict": True, "schema": RESPONSE_SCHEMA}}
                if structured
                else {"type": "json_object"}
            ),
        }
        if _CACHE_KEY_OK:
            body["prompt_cache_key"] = _prefix_key(messages)
        return body

    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    last_err: Optional[Exception] = None
    for attempt in range(BRAIN_RETRIES + 1):
        try:
            client = _client()
            t0 = time.monotonic()
            r = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload(_structured_ok))
            if r.status_code == 400 and _CACHE_KEY_OK and "prompt_cache_key" in r.text:
                print("[brain] endpoint rejected prompt_cache_key → sending without it")
                _CACHE_KEY_OK = False
                r = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload(_structured_ok))
            if r.status_code == 400 and _structured_ok and "response_format" in r.text:
                print("[brain] endpoint rejected json_schema → falling back to json_object")
                _structured_ok = False
                r = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload(False))
            if r.status_code in (429, 500, 502, 503, 504) and attempt < BRAIN_RETRIES:
                raise httpx.HTTPStatusError("retryable", request=r.request, response=r)
            r.raise_for_status()
            data = r.json()
            usage = data.get("usage") or {}
            cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
            print(
                f"[brain] tokens in={usage.get('prompt_tokens')} cached={cached} out={usage.get('completion_tokens')} "
                f"model_ms={int((time.monotonic() - t0) * 1000)}"
            )
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as e:
            last_err = e
            status = getattr(getattr(e, "response", None), "status_code", None)
            if attempt >= BRAIN_RETRIES or (status is not None and status not in (429, 500, 502, 503, 504)):
                raise
            await asyncio.sleep(0.4 * (attempt + 1))
    raise last_err or RuntimeError("brain call failed")


# --------------------------- prompt assembly ---------------------------


def _knowledge_block(index: MenuIndex, restaurant: Optional[Dict[str, Any]]) -> str:
    return (
        "# RESTAURANT\n" + render_restaurant(restaurant) + "\n\n"
        "# MENU (ref name — price [tags; hints] · desc · choices)\n" + (render_catalog(index) or "(menu unavailable)") + "\n\n"
        "# PRICE GUIDE (per category: range, cheapest dishes)\n" + render_price_guide(index)
    )


def _turn_block(
    *,
    transcript: str,
    lang: str,
    index: MenuIndex,
    cart_rows: List[Dict[str, Any]],
    subtotal: float,
    context: Dict[str, Any],
    recent: List[Dict[str, Any]],
    asked_to_confirm: bool,
    picks: Optional[List[Pick]] = None,
    profile: Optional[GuestProfile] = None,
    mode: str = "answer",
    plan: Optional[Dict[str, Any]] = None,
    pairings: Optional[List[Tuple[Dict[str, Any], str]]] = None,
    any_orderable: bool = True,
    just_suggested: Optional[List[Dict[str, Any]]] = None,
    ask_next: str = "",
    missing: Optional[List[str]] = None,
    asked_kinds: Optional[List[Tuple[str, List[Dict[str, Any]]]]] = None,
    allergy_guides: Optional[List[Dict[str, Any]]] = None,
    checkout_stage: str = "none",
    last_change: str = "",
    tray_facts: str = "",
    on_screen: Optional[List[Dict[str, Any]]] = None,
    wait_facts: str = "",
    orderable_items: Optional[List[Dict[str, Any]]] = None,
    understood: Optional[Dict[str, Any]] = None,
) -> str:
    now = context.get("localTime") or datetime.now().strftime("%a %H:%M")
    lines = [
        "# THIS TURN",
        f"Reply language: {lang}",
        f"Channel: {context.get('channel') or 'dine-in'} · Local time: {now} ({context.get('timeOfDay') or '?'})"
        + (f" · Restaurant open now: {'yes' if context['openNow'] else 'no'}" if isinstance(context.get("openNow"), bool) else ""),
        f"Meal period now: {context.get('mealPeriod') or context.get('timeOfDay') or 'unknown'}",
        "CART:\n" + render_cart(cart_rows, subtotal),
    ]
    if last_change:
        lines.append(f"LAST CHANGE (for \"one more of that\" / \"same again\" / \"আরেকটা\"): {last_change}")
    if tray_facts:
        lines.append(f"TRAY FACTS (for \"is this enough?\", \"over budget?\", \"what else do we need?\"): {tray_facts}")
    if wait_facts:
        lines.append("WAIT TIMES (real numbers — quote only these, as approximate): " + wait_facts)
    if on_screen:
        rows = []
        for n, it in enumerate(on_screen, start=1):
            f = dish_facts(it)
            # unknown heat: judge from the dish type — never tell the guest it "isn't listed"
            bits = [f"heat: {f.get('heat') or 'judge from the dish type'}", f"diet: {f.get('diet') or 'not listed'}"]
            if f.get("contains"):
                bits.append("contains: " + ", ".join(sorted(f["contains"]))[:90])
            if it.get("tags"):
                bits.append("tags: " + ", ".join(map(str, it.get("tags")))[:60])
            rows.append(f"{n}. {index.ref(it)} {it.get('name')} {_money(it.get('price'))} — " + "; ".join(bits))
        lines.append(
            "ON SCREEN — the guest is looking at exactly these dishes; \"these / those / which of them / এগুলো / সেগুলোর "
            "মধ্যে / কোনটা / the second one\" means THESE (answer about them only):\n" + "\n".join(rows)
        )
    unavailable = context.get("unavailableNow") or []
    if unavailable:
        by_reason: Dict[str, List[str]] = {}
        for u in unavailable:
            by_reason.setdefault(str(u.get("reason") or "not available now"), []).append(str(u.get("name")))
        rows = []
        for reason, names in by_reason.items():
            if len(names) >= len(index.items) > 0:
                rows.append(f"- EVERY item: {reason}")
            else:
                shown = ", ".join(names[:15]) + (f" (+{len(names) - 15} more)" if len(names) > 15 else "")
                rows.append(f"- {shown}: {reason}")
        lines.append("NOT ORDERABLE NOW:\n" + "\n".join(rows))
    if recent:
        lines.append("RECENTLY DISCUSSED: " + ", ".join(f"{index.ref(it)} {it.get('name')}" for it in recent))
    if missing:
        close = _closest_to(list(missing), index, {})
        lines.append(
            f"NOT ON THIS MENU: {', '.join(missing)} — say so plainly and kindly. "
            + (f"The closest things this MENU has: {', '.join(str(c.get('name')) for c in close)} — you may offer one or "
               "two of those, saying they're the closest we have. " if close else
               "Nothing on this MENU is close to it — don't offer a substitute; just ask what else they'd like. ")
            + "Never offer something unrelated (a drink for a burger, savoury food for a dessert, a soup to finish with)."
        )
    for g in allergy_guides or []:
        if g.get("groups"):
            lines.append(
                f"ALLERGY GUIDE ({g['allergen']}) — {g['count']} dishes to avoid; SAY IT GROUPED LIKE THIS (never read "
                f"out every dish): {'; '.join(g['groups'])}. Then name 2–3 safe dishes from RANKED PICKS and ask them "
                "to tell the staff."
            )
    for kind, items in asked_kinds or []:
        avail = [i for i in items if i.get("available") is not False]
        if avail:
            lines.append(
                f"GUEST ASKED ABOUT {kind.upper()} — these are ALL of them on the menu that can be ordered now "
                "(answer from this list; don't add unrelated dishes): "
                + ", ".join(f"{i.get('name')} {_money(i.get('price'))}" for i in avail[:12])
            )
    if just_suggested:
        lines.append(
            "YOU JUST SUGGESTED (in this order — \"the first one\", \"the second\", \"the last one\", \"that one\" refer to these): "
            + "; ".join(f"{n}. {index.ref(it)} {it.get('name')}" for n, it in enumerate(just_suggested, start=1))
        )
    lines.append("GUEST PROFILE (what we know about this table): " + (profile.summary() if profile else "nothing specific yet"))
    lines.append(
        f"RECOMMENDATION MODE: {mode.upper()} — {MODE_INSTRUCTIONS.get(mode, '')}"
        + (f' End your reply with exactly this question (in the reply language): "{ask_next}"' if ask_next else "")
    )
    if mode == "overview":
        glance = glance_line(index.items, lang, available=orderable_items)
        if glance:
            lines.append(glance)
    if not any_orderable:
        lines.append("RANKED PICKS: nothing can be ordered at the moment — say so and when ordering is possible again.")
    elif picks and mode != "quiet":
        lines.append(
            "RANKED PICKS (already filtered for THIS guest's diet/allergies/dislikes/budget, availability and the "
            "meal period; best first; use the reasons). Any other MENU dish can still be ORDERED if the guest asks:\n"
            + "\n".join(
                f"- {index.ref(p.item)} {p.item.get('name')} {_money(p.item.get('price'))}"
                + (" (SIGNATURE)" if is_signature(p.item) else "")
                + (f" — {', '.join(r)}" if r else "")
                for p, r in zip(picks, _distinct_reasons(picks))
            )
            + "\n(Reasons shared by every pick are listed once, on the first — don't repeat them for each dish.)"
        )
    if plan and mode == "full":
        lines.append(
            f"MEAL PLAN for {plan['party']} (arithmetic checked — use these numbers): "
            + " + ".join(
                f"{l['qty']} × {l['name']}" + (f" ({l['variant']})" if l.get("variant") else "") + f" ({_money(l['price'])})"
                for l in plan["lines"]
            )
            + f" = {_money(plan['total'])}"
            + (f", within the ৳{plan['budget']} budget" if plan.get("budget") and plan["fits"] else "")
        )
    if pairings and mode in ("complement", "last_call"):
        lines.append(
            "PAIRING (offer only ONE, briefly): "
            + "; ".join(f"{index.ref(it)} {it.get('name')} {_money(it.get('price'))} — {why}" for it, why in pairings)
        )
    if checkout_stage == "readback":
        lines.append("CHECKOUT: you just read the order back and asked \"Shall I place it?\" — waiting for the guest's yes.")
    elif checkout_stage == "table":
        lines.append("CHECKOUT: you asked which table the guest is at (needed before placing the order).")
    elif asked_to_confirm:
        lines.append("You just asked the guest whether to confirm the order.")
    if understood:
        # a first reading of what they mean (a separate, focused step) — follow it unless the words clearly say otherwise
        lines.append("WHAT THE GUEST MEANS (first reading): " + json.dumps(understood, ensure_ascii=False))
    lines.append(f'Guest said: "{transcript}"')
    return "\n".join(lines)


def _distinct_reasons(picks: List[Pick]) -> List[List[str]]:
    """Reasons every pick shares ('great for dinner') only on the first, so replies don't repeat them per dish."""
    if not picks:
        return []
    common = set(picks[0].reasons)
    for p in picks[1:]:
        common &= set(p.reasons)
    return [p.reasons if i == 0 else [r for r in p.reasons if r not in common] for i, p in enumerate(picks)]


_GROUPISH = re.compile(r"\b(we|us|our|we'?re|family|group|table|friends)\b|আমরা|আমাদের|amra|amader", re.I)
_POPULARITY_CLAIM = re.compile(
    r"\b(very |most |really )?popular\b|best ?-?sell(er|ing)|most (ordered|loved)|(guest|crowd|customer) favou?rite|everyone loves"
    r"|জনপ্রিয়|সবচেয়ে বেশি বিক্রি|সবার পছন্দের|সবাই পছন্দ করে", re.I
)
_BN_PRICE = re.compile(r"৳\s*([০-৯][০-৯,]*)")
_ASK_INSTEAD = ("asked a question, not for an order", "needs a size/option first", "needs its choices first", "fit several dishes",
                "several lines", "not heard clearly", "not ordering it yet")
# Any claim about what happened to the ORDER (placed / taken / sent / confirmed / cancelled). Only the system
# does those things (checkout places, clearCart cancels) — the model saying so on its own is always false.
_ORDER_STATUS_VERBS_EN = r"(placed|taken|received|sent|submitted|confirmed|cancel+ed|processed|booked)"
_CLAIMS_CONFIRMED = re.compile(
    r"\b(is|has been|been|now) confirmed\b"
    rf"|\border(s)? (is |are |was |were |has been |have been |'s been |got |is now )?{_ORDER_STATUS_VERBS_EN}\b"
    rf"|\b(i'?ve|i have|i|we'?ve|we have|we) (just )?{_ORDER_STATUS_VERBS_EN} (your|the|this) order"
    r"|\b(sent|passed) (it|your order|the order) (to|on to) the kitchen"
    r"|অর্ডার(টা|টি|গুলো)?\s*(সফলভাবে\s*)?(নেওয়া|নেয়া|গ্রহণ|দেওয়া|দেয়া|পাঠানো|কনফার্ম|প্লেস|বাতিল|সম্পন্ন|নিশ্চিত|রিসিভ)\s*(করা\s*)?(হয়েছে|হয়েছে|হলো|হল|হয়ে গেছে)"
    r"|(কনফার্ম|নিশ্চিত|বাতিল)\s*করা\s*(হয়েছে|হলো|হল)"
    r"|অর্ডার(টা|টি)?\s*(নিয়েছি|নিয়ে নিয়েছি|পাঠিয়েছি|পাঠিয়ে দিয়েছি|দিয়ে দিয়েছি|কনফার্ম করেছি|বাতিল করেছি)"
    r"|রান্নাঘরে পাঠিয়ে(ছি|দিয়েছি)"
    # "আপনার অর্ডার বারো নম্বর টেবিলের জন্য কনফার্ম করলাম" — words in between, first-person past
    r"|অর্ডার.{0,50}?(কনফার্ম|নিশ্চিত|প্লেস|বাতিল)\s*(করলাম|করে দিলাম|করে দিয়েছি|করেছি|হয়ে গেছে)"
    r"|অর্ডার(টা|টি|গুলো)?\s*(দিয়ে দিলাম|দিয়ে দিয়েছি|পাঠিয়ে দিলাম|নিয়ে নিলাম)"
    r"|\b(i'?ve|i have|we'?ve|we have) (just )?(confirmed|placed|submitted)\b",
    re.I,
)
_DIET_CLASH = ("not vegetarian", "not vegan", "has meat", "has beef", "has pork")
_SORRY_REPEAT = {
    "bn": "দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন, প্লিজ?",
    "en": "Sorry, I didn't quite catch that — could you say it again, please?",
}
# a word in the order we couldn't place → never guess the dish, ask again
_NOT_CLEAR = {
    "bn": "দুঃখিত, স্পষ্ট শুনতে পারিনি। আরেকবার বলবেন, প্লিজ?",
    "en": "Sorry, I couldn't hear that clearly — could you say it again, please?",
}
# the number is the TOTAL ("দুইটা করে দিন", "মোট তিনটা", "make it 2") — not "two more"
_SWAP_CUE = re.compile(r"বদলে|বদলি|জায়গায়|জায়গায়|এর বদল|instead of|swap|replace|change (it|that) (to|for)|badle", re.I)
_PRICE_ASK = re.compile(
    r"how much|\bprices?\b|\bcosts?\b|\btotal\b|\bbill\b|\bcheap|\bexpensive|\bafford|\bkoto\b|\bdam\b|\btaka\b"
    r"|দাম|কত টাকা|টাকা|মোট|খরচ|সস্তা|কম দামে|বিল",
    re.I,
)
# "কী কী আছে আমার?" = what is in MY tray, not the menu
_ABOUT_MINE = re.compile(r"আমার|ট্রে|কার্ট|অর্ডার|\b(my (tray|cart|order)|tray|cart|i('ve| have)? ordered)\b|"
                         r"\bamar (tray|cart|order)\b", re.I)
def _HAS_PLAIN_RICE(index: MenuIndex) -> bool:
    return any(re.search(r"\b(plain|steamed|white)\s+rice\b|^rice$|\bbhat\b", str(it.get("name") or ""), re.I) for it in index.items)


def _no_bhat(text: str) -> str:
    """"ভাত" / "ভাতের" in the waiter's words → "ফ্রাইড রাইস" / "ফ্রাইড রাইসের" (never inside another word)."""
    text = re.sub(r"(?<![ঀ-৿])ভাতের(?![ঀ-৿])", "ফ্রাইড রাইসের", text or "")
    return re.sub(r"(?<![ঀ-৿])ভাত(?![ঀ-৿])", "ফ্রাইড রাইস", text)


_FILLER = re.compile(r"\s+(সেলেক্টিওন|সেলেক্টিয়ন|সেলেকশন|সিলেকশন|সিলেক্টিওন|সিলেক্সন|Selection)(?![ঀ-৿A-Za-z])(?!\s+[A-Z])")  # not inside a dish name


def _no_filler(text: str) -> str:
    """"Beef Selection" is a menu heading, not something a waiter says → "Beef"."""
    return _FILLER.sub("", text or "")


# "মেনুতে কী আছে" / "menu" — the guest asked for the MENU itself (opens the menu page)
_MENU_WORD = re.compile(r"মেনু|\bmenu\b", re.I)
# The closing question of a recommendation talks about ORDERING — in the waiter's own words, only the verb is
# swapped: "কোনটা নিতে চান, বলুন?" → "কোনটা অর্ডার করতে চান, বলুন?", "নেবেন কি?" → "অর্ডার করবেন কি?",
# "কোনটা দেব?" → "কোনটা অর্ডার করবেন?". Only the last question is touched.
_BN_ORDER_VERBS = [
    (re.compile(r"(কোনটা|কোনটি)(\s+আপনাকে)?\s+(দেব|দেবো|দিব)(\s+আপনাকে)?(?![ঀ-৿])"), r"\1 অর্ডার করবেন"),
    (re.compile(r"নিতে চান(?![ঀ-৿])"), "অর্ডার করতে চান"),
    (re.compile(r"নেবেন(?![ঀ-৿])|নিবেন(?![ঀ-৿])"), "অর্ডার করবেন"),
    (re.compile(r"(এটা |এটি |ওটা )?দেব( কি)?\s*\?$"), r"\1অর্ডার করবেন\2?"),
]
_EN_ORDER_ASK = re.compile(
    r"\b(Which (one )?would you like)(?! to order)( to (try|have))?(?=[^?]*\?\s*$)|\bWould you like (one of these|to try (one|it))(?=[^?]*\?\s*$)"
    r"|\bShall I get you one( of these)?(?=[^?]*\?\s*$)",
    re.I,
)


def _order_wording(text: str, lang: str) -> str:
    if not text:
        return text
    if lang == "bn":
        cut = max(text.rfind("।"), text.rfind("."), text.rfind("!"))
        head, last = (text[: cut + 1], text[cut + 1:]) if cut >= 0 else ("", text)
        for pat, rep in _BN_ORDER_VERBS:
            last = pat.sub(rep, last)
        return head + last
    return _EN_ORDER_ASK.sub(lambda m: "Which one would you like to order" if m.group(0).lower().startswith("which")
                             else "Would you like to order one of these", text)
# "just one soup" — a single recommendation stays single
_ASKED_FOR_ONE = re.compile(r"\b(one|a single|just one|only one)\b|একটা|একটি|শুধু একটা|\bekta\b|\bekti\b", re.I)
# talk about the screen the guest is already looking at
_SCREEN_TALK = re.compile(
    r"\s*(আর |এবং )?(বাকি(গুলো|গুলা)?|অন্যগুলো|আরও কয়েকটা)\s*(ও\s*)?স্ক্রিনে\s*(দিলাম|দিয়েছি|দেখুন|আছে)\s*[—–-]?\s*"
    r"|\s*I'?ve (also )?put (the )?(others|rest|a few more) on (your|the) screen[.,—–-]?\s*",
    re.I,
)
# "which is good / best / what do you recommend" — a request for picks, not for the menu
_WANTS_A_PICK = re.compile(
    r"ভালো|সেরা|বেস্ট|রেকমেন্ড|সাজেস্ট|টপ|জনপ্রিয়|পপুলার|খাওয়া\s*(যেতে\s*পারে|যায়)|খেতে\s*পারি|"
    r"recommend|suggest|\bbest\b|\bgood\b|\btop\b|\bpopular\b|\b(valo|bhalo)\b",
    re.I,
)
# "টপ থ্রি", "top 5", "তিনটা আইটেম" — how many dishes the guest asked for
_HOW_MANY = re.compile(
    r"(?:টপ|top)\s*(থ্রি|ফাইভ|টু|ফোর|three|five|two|four|\d|[০-৯])|"
    r"(\d|[০-৯]|দুই|তিন|চার|পাঁচ|দুটো|দুইটা|তিনটা|চারটা|পাঁচটা)\s*(টা|টি)?\s*(আইটেম|খাবার|ডিশ|item|dish)",
    re.I,
)
_COUNT_WORDS = {"থ্রি": 3, "three": 3, "ফাইভ": 5, "five": 5, "টু": 2, "two": 2, "ফোর": 4, "four": 4, "দুই": 2, "দুটো": 2,
                "দুইটা": 2, "তিন": 3, "তিনটা": 3, "চার": 4, "চারটা": 4, "পাঁচ": 5, "পাঁচটা": 5}


def _asked_count(transcript: str) -> Optional[int]:
    m = _HOW_MANY.search(transcript or "")
    if not m:
        return None
    w = (m.group(1) or m.group(2) or "").lower().translate(_BN_DIGITS)
    n = int(w) if w.isdigit() else _COUNT_WORDS.get(w)
    return n if n and 1 <= n <= 8 else None
_SEE_MENU = re.compile(
    r"\b(show|see|open|view|look at|check)\b.{0,15}\bmenu\b|\bfull menu\b|\bmenu (please|card)\b"
    r"|মেনু(টা|টি)?\s*(একটু\s*)?(দেখান|দেখাও|দেখাবেন|দেখতে চাই|দেখি|খুলুন|দিন|দেন)|মেনু কার্ড"
    r"|\bmenu\s*(ta\s*)?(dekhan|dekhao|dekhi|dekhte chai|den|din)\b",
    re.I,
)
# "ঝালের তথ্য নেই", "মেনুতে উল্লেখ নেই", "the menu doesn't list its heat" — a data gap, meaningless to a guest
_NO_INFO_TALK = re.compile(
    r"(ঝাল|স্বাদ|মেনু)[^।?!]{0,25}(তথ্য|উল্লেখ|লেখা)\s*(নেই|করা নেই|নাই)|তথ্য পাওয়া যায়নি|তথ্য নেই"
    r"|\b(menu|it) (doesn'?t|does not) (say|list|mention|show) (its|the|how|whether|if)\b"
    r"|\b(heat|spice|spiciness)( level)? (isn'?t|is not) (listed|mentioned)\b|\bno (info|information|details?) (on|about)\b",
    re.I,
)
_CLAIMS_CANCELLED = re.compile(r"\bcancel+ed\b|\bcleared\b|বাতিল|খালি করা", re.I)
_CLEAR_CUE = re.compile(
    r"\bcancel\b|\bclear\b|remove (everything|all)|start (over|again)|empty (the|my) (cart|order|tray)|delete (everything|all)|"
    r"forget (it|everything|the order)|বাতিল|সব বাদ|সব মুছে|ক্লিয়ার|ক্যান্সেল|cancel kor|sob bad",
    re.I,
)
# "অর্ডারগুলো ক্যান্সেল করুন", "সব ফাঁকা করেন", "shob faka koren", "ট্রে খালি করে দিন", "নতুন করে শুরু করি",
# "cancel everything", "empty my cart", "start over" — EVERYTHING goes, at once (one dish, "হট উইংস বাদ দিন", is not
# this: the words name the whole order / tray / everything)
_CLEAR_ALL = re.compile(
    r"(অর্ডার(গুলো|গুলি|টা|টি)?|সব(কিছু|গুলো|গুলি|কটা)?|সবই|পুরো(টা| অর্ডার)?|ট্রে|কার্ট|ঝুড়ি)\s*(\S+\s+){0,2}?"
    r"(ক্যান্সেল|ক্যানসেল|বাতিল|বাদ|মুছে|খালি|ফাঁকা|ফাকা|ডিলিট|রিমুভ|ক্লিয়ার|ক্লিয়ার|লাগবে না|চাই না)|"
    r"(নতুন করে|প্রথম থেকে|গোড়া থেকে|আবার নতুন করে)\s*(শুরু|অর্ডার)|"
    r"\b(order|orders|sob|shob|shobi|sobkichu|shobkichu|cart|tray|puro)\s+(\w+\s+){0,2}?(cancel|batil|bad|khali|faka|delete|clear|remove)\b|"
    r"\b(notun kore|prothom theke) (shuru|suru|order)\b|"
    r"\b(cancel|clear|empty|delete|remove|scrap|reset)\s+(\w+\s+)?(everything|all|it all|the (whole )?(order|cart|tray|basket)|"
    r"my (order|cart|tray|basket)|(the |my )?orders)\b|\bstart (over|again|from scratch)\b|\bforget (everything|the (whole )?order)\b",
    re.I,
)
# "বললাম যে না থাক" / "আমি বলেছি দুইটা" / "না না, আমি বলেছিলাম স্পাইসি" / "I said no" — a repeat or a correction of what
# the guest just said: the words after it are the answer (to whatever is still open)
_REPEAT_LEAD = re.compile(
    r"^\s*(না\s+না[,،]?\s*|না[,،]\s*)?(আমি\s+)?(তো\s+)?(বলেছিলাম|বলছিলাম|বলতেছি|বললাম|বলেছি|বলছি)\s*(যে|তো)?\s*[,،:।]?\s*|"
    r"^\s*(ami\s+)?(bolechilam|bollam|bolsi|bolechi|boltesi|bolchi)\s*(je|to)?\s*[,:]?\s*|"
    r"^\s*(no,?\s*)?i\s+(said|meant|mean)(\s+that)?\s*[,:]?\s*",
    re.I,
)


def _strip_repeat_lead(text: str) -> str:
    """"বললাম যে না থাক" → "না থাক"; "মানে দুইটা স্পাইসি" → "দুইটা স্পাইসি" (a bare "মানে কি?" stays)."""
    core = _REPEAT_LEAD.sub("", text or "", count=1).strip()
    m = re.match(r"^\s*(মানে|mane|i mean)\s+(.+)$", core, re.I)
    if m and len(m.group(2).split()) >= 2:
        core = m.group(2).strip()
    return core or (text or "")


# the short ways of saying no / yes — a garbled short answer is matched to them by sound ("মাফাক" ≈ "না থাক")
_NO_FORMS = ["না", "না থাক", "নাহ", "থাক", "না না", "লাগবে না", "না লাগবে না", "নাহ থাক"]
_YES_FORMS = ["হ্যাঁ", "হ্যা", "হাঁ", "জি", "দেন", "দিন", "ঠিক আছে", "হুম", "হ্যাঁ দিন"]


def _sounds_like_no(text: str) -> bool:
    """A garbled one- or two-word answer that sounds like "না থাক" (and not like a yes). Only ever a NO: a wrong no
    changes nothing; a wrong yes would add food the guest never asked for."""
    from difflib import SequenceMatcher

    w = re.sub(r"[।.!?,]", "", text or "").strip()
    if not w or len(w.split()) > 2 or re.search(r"[A-Za-z0-9০-৯]", w):
        return False
    sound = _phon(w.replace(" ", ""))

    def best(forms: List[str]) -> float:
        # only a form that ENDS like the garble ("মাফাক" ~ "থাক": both end in "ক"; "বাতাস" ends in "স" → no match)
        return max((SequenceMatcher(None, sound, f).ratio() for f in (_phon(x.replace(" ", "")) for x in forms)
                    if f and sound and f[-1] == sound[-1]), default=0.0)

    # (a yes is compared in full: anything that sounds even a little like "হ্যাঁ" is never guessed a no)
    yes = max(SequenceMatcher(None, sound, _phon(x.replace(" ", ""))).ratio() for x in _YES_FORMS)
    no = best(_NO_FORMS)
    return no >= 0.6 and no >= yes + 0.15  # ("মাফাক" ≈ "না থাক" 0.6; "পাখা" / "কাকা" stay unread → asked again)


# the waiter asking the guest to say it again / what they meant
_CLARIFY_ASK = re.compile(
    r"বুঝতে পারিনি|বোঝাতে চেয়েছেন|বোঝালেন|স্পষ্ট করে|আরেকবার বলবেন|আবার বলবেন|"
    r"\b(say (it|that) again|didn'?t (catch|understand|get) (that|it|you)|what do you mean|could you repeat)\b",
    re.I,
)


def _names_food(text: str, index: MenuIndex) -> bool:
    """Does the guest name a dish? ("অর্ডার থেকে কোকটা বাদ দিন", "সব কোক বাদ দিন" — about the Coke, never "everything")"""
    return bool(_dishes_named(text, index, limit=1) or find_mentions(text, index, limit=1))


def _clear_buttons(lang: str) -> List[Dict[str, Any]]:
    """The two answers to "সবগুলো বাদ দিয়ে দেব?" as pills under the mic."""
    if lang == "bn":
        return [{"label": "হ্যাঁ, সব বাদ দিন", "say": "হ্যাঁ"}, {"label": "না, রেখে দিন", "say": "না"}]
    return [{"label": "Yes, remove all", "say": "yes"}, {"label": "No, keep them", "say": "no"}]


def _ask_clear(rows: List[Dict[str, Any]], lang: str, tstate: Dict[str, Any],
               after_ops: Optional[List[Dict[str, Any]]] = None) -> Tuple[str, List[Dict[str, Any]]]:
    """"আপনার ট্রেতে 5টা আইটেম আছে — সবগুলো বাদ দিয়ে দেব?" — never emptied without the guest's yes."""
    n_items = sum(int(r.get("quantity") or 0) for r in rows)
    tstate["pending"] = {"kind": "clear", "ops": list(after_ops or []), "clear": True}
    if n_items == 1:
        text = ("আপনার ট্রেতে 1টা আইটেম আছে — ওটা বাদ দিয়ে ট্রে খালি করে দেব?" if lang == "bn"
                else "You have 1 item in your tray — shall I remove it and empty the tray?")
    else:
        text = (f"আপনার ট্রেতে {n_items}টা আইটেম আছে — সবগুলো বাদ দিয়ে দেব?" if lang == "bn"
                else f"You have {n_items} items in your tray — shall I remove them all?")
    return text, _clear_buttons(lang)


def _yes_no_buttons(lang: str) -> List[Dict[str, Any]]:
    return ([{"label": "হ্যাঁ, দিন", "say": "হ্যাঁ"}, {"label": "না, থাক", "say": "না"}] if lang == "bn"
            else [{"label": "Yes, add it", "say": "yes"}, {"label": "No, thanks", "say": "no"}])


def _cleared_text(lang: str) -> str:
    return ("ঠিক আছে, আপনার ট্রে খালি করে দিলাম। নতুন করে কী দেব?" if lang == "bn"
            else "Done — I've emptied your tray. What would you like instead?")


def _with_buttons(res: Dict[str, Any], buttons: List[Dict[str, Any]]) -> Dict[str, Any]:
    res.setdefault("meta", {}).setdefault("decision", {})["chooseOptions"] = buttons
    return res


# "I've sent it to the kitchen" — the note only travels with the order; the waiter can't reach the kitchen
_KITCHEN_CLAIM = re.compile(
    r"(sent|passed|forwarded|told|informed|notified|let)\s+(it |this |that |them )?(on |over )?(to |know )?(the )?(kitchen|chef)|"
    r"(kitchen|chef) (has been|have been|is|was) (told|informed|notified|alerted)|"
    r"(কিচেনে|রান্নাঘরে|শেফকে|কিচেনকে|রান্নাঘরকে)\s*(পাঠিয়েছি|পাঠানো হয়েছে|জানিয়েছি|জানানো হয়েছে|বলেছি|বলে দিয়েছি)",
    re.I,
)

_OFFERS_TO_ADD = re.compile(
    r"(would you like|shall i|should i|do you want)( me)? to add (these|them|this|it|those)|(shall|should) i add (these|them|this|it)|"
    r"যোগ করব কি|যোগ করে দেব|অর্ডারে যোগ করতে চান",
    re.I,
)
_CLAIMS_ADDED = re.compile(r"\badded\b|\bi'?ve added\b|in your (cart|order|tray)|যোগ করা হয়েছে|যোগ করা হলো|যোগ করলাম", re.I)
_CLAIMS_CHANGED = re.compile(
    r"\b(removed|changed|updated|reduced|switched|swapped|done)\b|বাদ দিলাম|বাদ দেওয়া হলো|বাদ দিয়েছি|সরিয়ে দিলাম|"
    r"কমিয়ে দিলাম|কমানো হলো|বদলে দিলাম|বদলানো হলো|বদলে দিয়েছি|করে দিলাম|ঠিক করে দিলাম|"
    r"বাদ (দেওয়া|দেয়া|দেওয়া|দেয়া) (হলো|হয়েছে)|বাদ দিয়ে দি(লাম|য়েছি)|(সরানো|কমানো|বাতিল করা) (হলো|হয়েছে)|"
    r"(সরিয়ে|কমিয়ে|বদলে) (দেওয়া|দেয়া|দেওয়া|দেয়া) (হলো|হয়েছে)",
    re.I,
)
# the waiter's line offers a dish ("…নেবেন?", "…ট্রাই করবেন?", "would you like…?")
_OFFER_Q = re.compile(r"নেবেন|নিবেন|নিতে চান|দেব\?|দিব\?|ট্রাই কর|চলবে|খাবেন|would you like|want (to try|some|one)|"
                      r"shall i add|how about|care for", re.I)
# "…বাদ দেন / কমান / লাগবে না / remove / cancel" — a request to take something OUT of the tray
_TAKE_OUT = re.compile(r"বাদ দ|কমা(ন|ও|বেন|য়ে)|সরা(ন|ও|য়ে)|\b(remove|take (it )?(out|off)|delete)\b", re.I)
# "…লাগবে না" is a removal only with a dish named ("ক্রিস্পি রাইস স্যুপ লাগবে না"), never "আর কিছু লাগবে না"
_DONT_NEED = re.compile(r"লাগবে না|চাই না|দরকার নেই|\b(don'?t (want|need))\b", re.I)


def _not_in_tray_reply(transcript: str, index: MenuIndex, rows: List[Dict[str, Any]], lang: str
                       ) -> Tuple[str, List[Dict[str, Any]]]:
    """"স্প্রিং রোলটা বাদ দেন" when there's no spring roll in the tray → say so, name what IS there, and offer those
    as buttons — never "removed" (nothing was) and never a vague "didn't get that"."""
    bn = lang == "bn"
    in_tray = {str(r.get("itemId")) for r in rows}
    named = [it for it in _dishes_named(transcript, index, limit=2) if index.item_id(it) not in in_tray]
    lines = [r for r in rows if int(r.get("quantity") or 0) > 0]
    nm = lambda r: _tray.label(r).split(" × ", 1)[-1]  # noqa: E731  (the line's name, sizes/add-ons included)
    have = ", ".join(f"{r['quantity']}টা {nm(r)}" if bn else f"{r['quantity']} × {nm(r)}" for r in lines[:5])
    if named:
        head = f"{named[0].get('name')} তো আপনার ট্রেতে নেই।" if bn else f"There's no {named[0].get('name')} in your tray."
    else:
        head = "এটা তো আপনার ট্রেতে নেই।" if bn else "That isn't in your tray."
    if not lines:
        return head + (" আপনার ট্রে এখন খালি।" if bn else " Your tray is empty."), []
    text = f"{head} ট্রেতে আছে: {have} — কোনটা বাদ দেব?" if bn else f"{head} You have: {have} — which one should I remove?"
    opts = [{"label": nm(r), "say": f"{nm(r)} বাদ দিন" if bn else f"remove the {nm(r)}",
             "itemId": str(r.get("itemId"))} for r in lines[:4]]
    return text, opts


# "…fit several dishes: A | B" / "…fit several dishes (x2): A | B" (x2 = the quantity the guest said) / "several lines:"
_SEVERAL = re.compile(r"fit several dishes(?: \(x\d+\))?:|several lines:")


def _choice_options(problems: List[str], index: MenuIndex, lang: str, raw_ops: Any = None) -> List[Dict[str, Any]]:
    """The answers to the waiter's "which one?" as buttons: [{label, say, itemId?, price?}]. Tapping one sends `say`
    as the guest's next words — a full dish name (and the size / choice), so it's never misheard. Only for the
    question the reply asks (the first one); empty when the answer isn't one tap (e.g. pick two curries)."""
    bn = lang == "bn"
    asked = next((p for p in problems if any(k in p for k in _ASK_INSTEAD)), "")
    if not asked:
        return []

    def qty_for(name: str) -> int:
        m = re.search(r"fit several dishes \(x(\d+)\)", asked)
        if m:
            return int(m.group(1))
        for o in raw_ops if isinstance(raw_ops, list) else []:
            if isinstance(o, dict):
                it = index.resolve(o.get("item") or o.get("itemId"), o.get("name"))
                if it and str(it.get("name")) == name:
                    return _qty(o.get("quantity")) or 1
        return 1

    def say(q: int, what: str) -> str:
        return f"{q}টা {what} দিন" if bn else f"{q} {what}, please"

    if "fit several dishes" in asked:
        name = asked.split(":")[0].strip()
        q = qty_for(name)
        out = []
        for n in [o.strip() for o in _SEVERAL.split(asked)[-1].split("|") if o.strip()][:6]:
            it = index.resolve(None, n)
            if it:
                out.append({"label": str(it.get("name")), "say": say(q, str(it.get("name"))),
                            "itemId": index.item_id(it), "price": it.get("price")})
        return out
    name = asked.split(" needs ")[0].split(":")[0].strip()
    it = index.resolve(None, name)
    if not it:
        return []
    q = qty_for(str(it.get("name")))
    if "needs a size" in asked:
        return [{"label": f"{v['name']}", "say": say(q, f"{it['name']} {v['name']}"), "itemId": index.item_id(it),
                 "price": v.get("price")} for v in it.get("variations") or [] if v.get("name")][:6]
    if "needs its choices" in asked:
        groups = [g for g in it.get("modifierGroups") or [] if int(g.get("min") or 0) >= 1]
        # one tap answers it only when it's "pick one" (a "pick two curries" needs the guest's words)
        if len(groups) == 1 and int(groups[0].get("min") or 0) == 1 and int(groups[0].get("max") or 1) == 1:
            return [{"label": o["name"], "say": say(q, f"{it['name']} — {o['name']}"), "itemId": index.item_id(it),
                     "price": (it.get("price") or 0) + (o.get("price") or 0)}
                    for o in groups[0].get("options") or [] if o.get("name")][:8]
    return []


# ---- a dish ordered without its size / required choice: held (with its quantity) until the guest answers
_OPTION_GAP = re.compile(r"needs a size/option first|needs its choices first")


def _drop_said(text: str, label: str) -> str:
    """The guest's words without this choice ("রেগুলার" picked the spice — it must not ALSO pick the smallest size)."""
    from bn_translit import word_to_bn

    t = text or ""
    for w in re.findall(r"[a-z]+", str(label).lower()):
        if len(w) > 2:
            t = re.sub(rf"\b{re.escape(w)}\w*", " ", t, flags=re.I)
            t = t.replace(word_to_bn(w), " ")
            t = t.replace(word_to_bn(w).replace("্", ""), " ")
    for bn, en in _BN_WORDS.items():
        if en in [w.lower() for w in re.findall(r"[a-z]+", str(label).lower())]:
            t = t.replace(bn, " ")
    return t


def _numbers_in(text: str) -> set:
    """"দশটা", "১০", "ten", "দুটো" → {"10", "2"}: every number the guest said."""
    out = set()
    for w in re.findall(r"[a-z]+|\d+|[ঀ-৿]+", (text or "").lower().translate(_BN_DIGITS)):
        if w.isdigit():
            out.add(str(int(w)))
            continue
        for cand in (w, _BN_SUFFIX.sub("", w) or w, re.sub(r"(টা|টি|টো)$", "", w)):
            n = _NUM_WORDS.get(cand) or _NUM_WORDS.get(_phon(cand))
            if n:
                out.add(n)
                break
    return out


def _fill_options(e: Dict[str, Any], it: Dict[str, Any], words: str, names: str = "", answering: bool = False) -> List[str]:
    """Fill what `words` say into a held dish {variant, choices} (in place); returns what's still missing:
    'size' and/or the required groups' names. Two answers for a one-pick group ("স্পাইসি না রেগুলার?") pick nothing.
    `names`: every dish named in this order — their words never count as an answer ("হট উইংস" is not "Extra hot"
    for the Fried Chicken). A word that picked a choice doesn't also pick a size."""
    variations = [v for v in it.get("variations") or [] if v.get("name")]
    not_answers = " ".join([str(it.get("name") or ""), names or ""])
    chosen = list(e.get("choices") or [])
    size_words = words or ""
    for g in it.get("modifierGroups") or []:
        opts = [str(o["name"]) for o in g.get("options") or [] if o.get("name")]
        room = int(g.get("max") or len(opts) or 1) - sum(1 for o in opts if o in chosen)
        said = [o for o in opts if o not in chosen and words and _said(o, words, not_answers)]
        if said and len(said) <= room:
            chosen += said
        for o in said:
            if not any(_said(o, str(v["name"])) for v in variations):  # (a size named like the choice keeps it)
                size_words = _drop_said(size_words, o)
    if not e.get("variant"):
        v = variations[0] if len(variations) == 1 else (_size_by_words(it, size_words) if variations and size_words.strip() else None)
        if v is None and answering and len(variations) > 1:
            # the answer to "6 pcs or 10 pcs?" can be just the number: "দশটা", "দশ" → 10 pcs (only when one size fits)
            said = _numbers_in(size_words)
            hits = [x for x in variations for m in [re.search(r"\d+", str(x["name"]))] if m and m.group() in said]
            v = hits[0] if len(hits) == 1 else None
        if v:
            e["variant"] = str(v["name"])
    missing = ["size"] if len(variations) > 1 and not e.get("variant") else []
    for g in it.get("modifierGroups") or []:
        opts = [str(o["name"]) for o in g.get("options") or [] if o.get("name")]
        if sum(1 for o in opts if o in chosen) < int(g.get("min") or 0):
            missing.append(str(g.get("name") or "choice"))
    e["choices"] = chosen
    return missing


def _answers_by_dish(text: str, held: List[Dict[str, Any]], index: MenuIndex) -> Dict[str, str]:
    """The guest's answer split per held dish: "হট উইংস দশ পিস স্পাইসি, আর ফ্রাইড চিকেন চার পিস" → each part goes to
    the dish it names; a part naming none belongs to the dish named just before it, or — when no dish is named at
    all ("দুটোই স্পাইসি", "রেগুলার") — to every held dish."""
    ids = [str(e["itemId"]) for e in held]
    segs = [x for x in re.split(r"\s*(?:,|।|;|\s(?:আর|এবং|and|plus)\s)\s*", text or "") if x.strip()]
    out: Dict[str, List[str]] = {i: [] for i in ids}
    last: Optional[str] = None
    loose: List[str] = []
    for seg in segs:
        named = [index.item_id(d) for d in _dishes_named(seg, index, limit=4) + find_mentions(seg, index, limit=4)]
        mine = [i for i in dict.fromkeys(named) if i in out]
        if len(mine) == 1:
            out[mine[0]].append(seg)
            last = mine[0]
        elif len(mine) > 1:
            for i in mine:
                out[i].append(seg)
            last = None
        elif last:
            out[last].append(seg)
        else:
            loose.append(seg)
    if not any(out.values()):
        return {i: text for i in ids}  # no dish named: the answer is for all of them
    if loose:  # said before any dish was named → for the dishes nobody named
        for i in ids:
            if not out[i]:
                out[i] = loose
    return {i: " ".join(v) for i, v in out.items()}


def _pending_question(pending: Dict[str, Any], index: MenuIndex, rows: List[Dict[str, Any]], lang: str
                      ) -> Tuple[str, List[Dict[str, Any]]]:
    """The question the guest still owes an answer to, worded again, with its answer buttons ("" when unknown)."""
    kind = pending.get("kind")
    if kind == "offer":
        return str((pending.get("offer") or {}).get("text") or ""), _yes_no_buttons(lang)
    if kind == "options":
        return _options_question([e for e in pending.get("items") or [] if str(e.get("itemId")) in index.by_id], index, lang), []
    if kind == "clear":
        n = sum(int(r.get("quantity") or 0) for r in rows)
        if n == 1:
            q = ("আপনার ট্রেতে 1টা আইটেম আছে — ওটা বাদ দিয়ে ট্রে খালি করে দেব?" if lang == "bn"
                 else "You have 1 item in your tray — shall I remove it and empty the tray?")
        else:
            q = (f"আপনার ট্রেতে {n}টা আইটেম আছে — সবগুলো বাদ দিয়ে দেব?" if lang == "bn"
                 else f"You have {n} items in your tray — shall I remove them all?")
        return q, _clear_buttons(lang)
    return str(pending.get("question") or ""), list(pending.get("buttons") or [])


def _answers_held(e: Dict[str, Any], index: MenuIndex, words: str) -> bool:
    """Do these words fill in anything of a held dish (its size / a choice)?"""
    before = (e.get("variant"), tuple(e.get("choices") or []))
    _fill_options(e, index.by_id[str(e["itemId"])], words, answering=True)
    return before != (e.get("variant"), tuple(e.get("choices") or []))


def _held_op(e: Dict[str, Any], index: MenuIndex) -> Dict[str, Any]:
    """A held dish, now complete → the add op (with the size's price + paid add-ons, as _validate_ops does)."""
    it = index.by_id.get(str(e["itemId"])) or {}
    var = next((v for v in it.get("variations") or [] if v.get("name") == e.get("variant")), None)
    base = var.get("price") if var and isinstance(var.get("price"), (int, float)) else it.get("price")
    surcharge = sum(float(o.get("price") or 0) for g in it.get("modifierGroups") or [] for o in g.get("options") or []
                    if o.get("name") in (e.get("choices") or []))
    op: Dict[str, Any] = {"op": "add", "itemId": str(e["itemId"]), "name": e["name"], "quantity": int(e.get("quantity") or 1)}
    if e.get("note"):
        op["note"] = e["note"]
    if e.get("choices"):
        op["choices"] = list(e["choices"])
    if var:
        op["variant"] = str(var["name"])
    if (var or surcharge) and isinstance(base, (int, float)):
        op["price"] = float(base) + surcharge
    return op


def _held_for_options(problems: List[str], raw_ops: Any, index: MenuIndex, words: str) -> List[Dict[str, Any]]:
    """The dishes the guest ordered but whose size / required choice they haven't said →
    [{itemId, name, quantity, variant, choices, note}], already filled with what their recent words DO say."""
    out: List[Dict[str, Any]] = []
    order_names = " ".join(str((index.resolve(o.get("item") or o.get("itemId"), o.get("name")) or {}).get("name") or "")
                           for o in (raw_ops if isinstance(raw_ops, list) else []) if isinstance(o, dict))
    for p in problems:
        if not _OPTION_GAP.search(p):
            continue
        it = index.resolve(None, p.split(" needs ")[0].split(":")[0].strip())
        if not it or any(e["itemId"] == index.item_id(it) for e in out):
            continue
        raw = next((o for o in (raw_ops if isinstance(raw_ops, list) else []) if isinstance(o, dict)
                    and str(o.get("op") or "").strip().lower() in ("add", "set") and not o.get("line")
                    and (index.resolve(o.get("item") or o.get("itemId"), o.get("name")) or {}) is it), None)
        if raw is None:
            continue  # a change to a tray line — asked the usual way
        name = str(it.get("name"))
        v = _norm_variant(it, raw.get("variant"))
        e = {"itemId": index.item_id(it), "name": name, "quantity": _qty(raw.get("quantity")) or 1,
             "variant": str(v["name"]) if v and _said(str(v["name"]), words) else "",
             # a required choice counts only if the guest said it; an extra (dip) the model added stays
             "choices": [c for c in _norm_choice_list(it, raw.get("choices"))
                         if c not in _required_choice_names(it) or _said(c, words, order_names)],
             "note": str(raw.get("note") or "").strip()[:140]}
        if not e["variant"] and e["quantity"] >= 3:
            # "দশটা হট উইংস" when the sizes are counted in pieces (6 pcs / 10 pcs) is ONE 10-piece, not ten plates
            # (two is left alone: "দুইটা ফ্রাইড চিকেন" is as often two plates as the 2-piece)
            pieces = [v for v in it.get("variations") or [] if v.get("name")
                      and re.fullmatch(rf"{e['quantity']}\s*(pcs?|pieces?)", str(v["name"]).strip(), re.I)]
            if len(pieces) == 1:
                e["variant"], e["quantity"] = str(pieces[0]["name"]), 1
        _fill_options(e, it, words, order_names)
        out.append(e)
    return out


def _options_question(held: List[Dict[str, Any]], index: MenuIndex, lang: str) -> str:
    """One question for everything still missing: "2টা Hot Wings — 6 pcs (৳320) অথবা 10 pcs (৳490), আর
    Spice level: Regular, Spicy অথবা Extra hot — কোনটা নেবেন?" (never the size now and the spice next turn)."""
    bn = lang == "bn"
    either = " অথবা " if bn else " or "

    def one_of(xs: List[str]) -> str:
        return (", ".join(xs[:-1]) + either + xs[-1]) if len(xs) > 1 else (xs[0] if xs else "")

    parts: List[str] = []
    for e in held:
        it = index.by_id.get(str(e["itemId"]))
        if not it:
            continue
        missing = _fill_options(dict(e), it, "")
        asks: List[str] = []
        if "size" in missing:
            asks.append(either.join(f"{v['name']} ({_money(v.get('price'))})" for v in it.get("variations") or [] if v.get("name")))
        for g in it.get("modifierGroups") or []:
            if str(g.get("name") or "choice") in missing:
                opts = [str(o["name"]) + (f" (+{_money(o['price'])})" if (o.get("price") or 0) > 0 else "")
                        for o in g.get("options") or [] if o.get("name")]
                n = int(g.get("min") or 1)
                pick = (f" (যেকোনো {n}টা)" if bn else f" (pick {n})") if n > 1 else ""
                asks.append(f"{g.get('name') or ('অপশন' if bn else 'choice')}{pick}: {one_of(opts)}")
        if asks:
            q = int(e.get("quantity") or 1)
            # what's already picked shows in the name ("Hot Wings (10 pcs)") — the guest hears it was understood
            got = ", ".join(x for x in [e.get("variant") or "", *(e.get("choices") or [])] if x)
            dish = f"{e['name']} ({got})" if got else str(e["name"])
            parts.append(f"{q}টা {dish} — " + ", আর ".join(asks) if bn
                         else f"for the {q} × {dish}: " + ", and ".join(asks))
    if not parts:
        return ""
    return ("; ".join(parts) + " — কোনটা নেবেন?") if bn else ("Which would you like " + "; ".join(parts) + "?")


def _same_dish_twice(raw_ops: Any, transcript: str, index: MenuIndex, orderable: Dict[str, bool]) -> Tuple[Any, List[str]]:
    """Two different phrases put on ONE dish in one breath — "ভাইস ঠিক স্যুপ দুইটা আর থাই ভেজিটেবল স্যুপ একটা" became
    3 × Thai Vegetable Soup (the misheard "থাই থিক স্যুপ" was merged into it). The phrase that names the dish keeps
    it, with its own quantity; the other phrase is asked about, with the dishes it most sounds like."""
    if not isinstance(raw_ops, list) or _tray.MORE_WORDS.search(transcript or ""):
        return raw_ops, []
    by: Dict[str, List[Tuple[Dict[str, Any], Dict[str, Any]]]] = {}
    for o in raw_ops:
        if isinstance(o, dict) and str(o.get("op") or "").lower() == "add":
            it = index.resolve(o.get("item") or o.get("itemId"), o.get("name"))
            if it:
                by.setdefault(index.item_id(it), []).append((o, it))
    twice = {iid: pairs for iid, pairs in by.items() if len(pairs) > 1}
    if not twice:
        return raw_ops, []
    from rapidfuzz import fuzz as _fz

    segs = [s.strip() for s in re.split(r"\s*(?:,|।|\s(?:আর|এবং|and)\s)\s*", transcript or "") if s.strip()]
    rev = _menu_rev(index)

    def names_it(seg: str, it: Dict[str, Any]) -> bool:
        # the dish's name as people say it — "(Chicken / Prawn)", "(regular)" aren't said
        toks = _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")))
        return bool(toks) and toks <= _guest_tokens(seg, rev)

    out, problems = list(raw_ops), []
    for iid, pairs in twice.items():
        it = pairs[0][1]
        named = [s for s in segs if names_it(s, it)]
        if len(named) != 1:
            continue  # the guest really said it twice ("…আর আরেকটা…" is handled above) — leave it
        rest = [s for s in segs if s is not named[0] and not any(names_it(s, d) for d in index.items)
                and _name_tokens(it.get("name")) & _guest_tokens(s, rev)]
        for o, _ in pairs:
            out.remove(o)
        out.append({**pairs[0][0], "quantity": _said_quantity(named[0]) or 1})
        for s in rest:
            shared = _name_tokens(it.get("name")) & _guest_tokens(s, _menu_rev(index))
            cands = [d for d in index.items if index.item_id(d) != iid and orderable.get(index.item_id(d), True)
                     and shared & _name_tokens(d.get("name"))]
            cands.sort(key=lambda d: -_fz.partial_ratio(to_bangla_script(str(d.get("name") or "")), s))
            if cands:
                problems.append(f"{it.get('name')}: which one? the guest's words fit several dishes "
                                f"(x{_said_quantity(s) or 1}): " + " | ".join(str(d.get("name")) for d in cands[:3]))
    return out, problems


# everyday words around an order that name no dish ("না, ওটাই আরেকটা বানিয়ে দিন", "same one again please")
_PLAIN_WORDS = {
    "না", "হ্যাঁ", "হ্যা", "জি", "জ্বি", "হুম", "ঠিক", "আছে", "ওকে", "আচ্ছা", "ভালো", "তো", "ই", "ও", "তাহলে", "এখন", "আবার",
    "আগের", "আগে", "একই", "সেম", "একটা", "আরেক", "আরেকটা", "আরেকটি", "আরও", "আরো", "আর", "এবং", "ওটা", "এটা", "সেটা",
    "ওইটা", "ঐটা", "এইটা", "ওটাই", "এটাই", "সেটাই", "ওইটাই", "যেটা", "দুটোই", "দুইটাই", "বানাও", "বানান", "বানিয়ে",
    "বানাবেন", "আনো", "আনুন", "আনেন", "আনবেন", "নিয়ে", "আসো", "আসুন", "আসেন", "পাঠাও", "পাঠান", "দিয়ে", "দিবা", "দিও",
    "দিলে", "দেখি", "তুমি", "আপনি", "ওর", "ওনার", "উনার", "তার", "বন্ধু", "বন্ধুর", "বাচ্চা", "বাচ্চার", "জনের", "জন",
    "ভাইয়া", "আপু", "মামা", "একটু", "তাড়াতাড়ি", "জলদি", "প্লিজ", "প্লীজ", "ধন্যবাদ", "থ্যাংক", "থ্যাংকস",
    # how people shape an order: sizes, portions, more / less, containers
    "কম", "বেশি", "ডাবল", "দ্বিগুণ", "অর্ধেক", "হাফ", "ফুল", "বড়", "বড়", "ছোট", "ছোটো", "মাঝারি", "সাইজ", "প্লেট", "বোতল",
    "গ্লাস", "পিস", "বাটি", "কাপ", "ক্যান", "প্যাকেট", "করে", "কমিয়ে", "বাড়িয়ে", "ঠান্ডা", "ঠাণ্ডা", "গরম", "ঝাল", "মিষ্টি",
    "ডজন", "জোড়া", "জোড়া", "গোটা", "টা", "টি", "খানা", "লার্জ", "স্মল", "মিডিয়াম", "রেগুলার", "সাথে", "সঙ্গে", "দিয়ে",
    # changing the tray: "বড়টা বাদ দিন", "ওটা সরান", "এটা বদলে দিন"
    "বাদ", "কমান", "কমাও", "কমিয়ে", "সরান", "সরাও", "সরিয়ে", "বদলে", "বদলান", "বদলাও", "রাখুন", "রাখেন", "রাখো", "বাতিল",
    "remove", "cancel", "change", "swap", "drop", "keep",
    "সব", "সবগুলো", "সবগুলা", "সবকটা", "সবটা", "পুরো", "পুরোটা", "দুটোই", "দুইটাই", "all", "both", "everything", "whole",
    "yes", "yeah", "no", "ok", "okay", "sure", "that", "this", "it", "one", "same", "again", "more", "another",
    "less", "double", "large", "small", "medium", "regular", "big", "bottle", "glass", "piece", "plate", "cup", "can",
    "make", "bring", "send", "too", "thanks", "thank", "you", "for", "my", "friend", "kid", "quick", "quickly", "now",
}


def _unplaced_guess(raw_ops: Any, transcript: str, index: MenuIndex, recent: Optional[str] = None) -> Tuple[Any, List[str]]:
    """"না, আরেকটি ছোলাক বানাও" → the model added another Chicken Corn Soup: it GUESSED what "ছোলাক" was. A dish
    the guest didn't name, in a sentence with a word we can't place, is never added — the waiter asks again
    ("স্পষ্ট শুনতে পারিনি, আরেকবার বলবেন?"). "আরেকটা দিন" (every word plain) still means the last dish, and a dish
    with ANY word of its name said ("সুজার সিজলিং") is left to the "which one?" checks."""
    if not isinstance(raw_ops, list) or not transcript:
        return raw_ops, []
    from rapidfuzz import fuzz as _fz

    rev = _menu_rev(index)
    said = _guest_tokens(f"{transcript} {recent or ''}", rev)
    odd = []
    for w in re.findall(r"[A-Za-z']+|[ঀ-৿]+", transcript):
        lw = w.lower()
        base = re.sub(r"(ই|ও|টাই|টা|টি|গুলো)$", "", lw)
        if (lw in _ORDER_FILLER or lw in _PLAIN_WORDS or base in _PLAIN_WORDS or base in _ORDER_FILLER
                or _said_quantity(w) is not None or _guest_tokens(w, rev)):
            continue
        odd.append(w)
    if not odd:
        return raw_ops, []
    out, problems = [], []
    for o in raw_ops:
        # adding, and changing / removing a tray line ("বলন্তনসুক দুইটা করেন" → it set the water to 2)
        it = (index.resolve(o.get("item") or o.get("itemId"), o.get("name"))
              if isinstance(o, dict) and str(o.get("op") or "").lower() in ("add", "set", "sub", "remove", "note") else None)
        if not it:
            out.append(o)
            continue
        toks = _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")))
        spoken = to_bangla_script(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or ""))).split()
        # any word of its name said, or an odd word IS a word of its name misheard ("ক্যাশুনাট" ~ "ক্যাশিউ") → not a guess
        if (toks & said) or any(_fz.ratio(w, s) >= 70 for w in odd if len(w) > 2 for s in spoken):
            out.append(o)
            continue
        problems.append(f"{it.get('name')}: not heard clearly — the guest's words {' '.join(odd)!r} name no dish")
    return out, problems


def _clarify_reply(problems: List[str], index: MenuIndex, lang: str) -> str:
    """Deterministic 'which size / which choice?' when the model still pretended to add something."""
    bn = lang == "bn"
    if any("not heard clearly" in p for p in problems):
        return _NOT_CLEAR["bn" if bn else "en"]
    if any("not ordering it yet" in p for p in problems):
        return ("ঠিক আছে! পরে লাগলে বলবেন, তখনই দিয়ে দেব।" if bn else "Sure — just tell me when you want it and I'll add it.")
    for p in problems:
        if _SEVERAL.search(p):
            opts = [o.strip() for o in _SEVERAL.split(p)[-1].split("|") if o.strip()]
            joined = (", ".join(opts[:-1]) + (" নাকি " if bn else " or ") + opts[-1]) if len(opts) > 1 else opts[0]
            n = re.search(r"\(x(\d+)\)", p)
            if n:  # a phrase we couldn't place, with its quantity: "দুইটা কোনটা বলছিলেন — …?"
                return (f"{n.group(1)}টা কোনটা বলছিলেন — {joined}?" if bn
                        else f"Which one did you want {n.group(1)} of — {joined}?")
            return f"কোনটা অর্ডার করবেন — {joined}?" if bn else f"Which one would you like — {joined}?"
        name = p.split(" needs ")[0].split(":")[0].strip()
        it = index.resolve(None, name)
        if not it:
            continue
        if "needs a size" in p:
            opts = [f"{v['name']} ({_money(v.get('price'))})" for v in it.get("variations") or [] if v.get("name")]
            joined = " অথবা ".join(opts) if bn else " or ".join(opts)
            return f"{it['name']} — {joined}, কোনটা নেবেন?" if bn else f"Would you like the {it['name']} {joined}?"
        if "needs its choices" in p:
            for g in it.get("modifierGroups") or []:
                if int(g.get("min") or 0) >= 1:
                    opts = ", ".join(
                        o["name"] + (f" (+{_money(o['price'])})" if (o.get("price") or 0) > 0 else "")
                        for o in g.get("options") or [] if o.get("name")
                    )
                    return (f"{it['name']} এর জন্য কোনটা নেবেন: {opts}?" if bn
                            else f"Which would you like with the {it['name']}: {opts}?")
    return ""


# self-check issue text → short tag stored with the turn (meta.guards) for reviewing real conversations
_GUARD_TAGS = [
    ("Don't change the cart yet", "unrequested_cart_change"),
    ("doesn't match any MENU price", "price_slip"),
    ("popular, bestsellers", "popularity_claim"),
    ("The total you stated", "wrong_total"),
    ("isn't right for this guest", "unsuitable_recommendation"),
    ("name the recommended dishes", "untranslated_names"),
    ("IS available and can be ordered", "false_unavailable"),
    ("IS available and you are adding it", "added_but_said_unavailable"),
    ("You have NOT placed, taken, sent", "false_order_status_claim"),
    ("asked about the dishes ON SCREEN", "left_the_list_on_screen"),
    ("without its total", "plan_without_total"),
    ("gave a budget", "budget_without_total"),
    ("which this menu doesn't have", "odd_substitute"),
    ("Too long to say out loud", "allergy_list_too_long"),
    ("you sent/told/informed the kitchen", "kitchen_claim"),
]


# Asked for a kind of food the menu doesn't have → what on a menu is genuinely CLOSE to it (never a drink for a
# burger). Kinds not listed have no close stand-in: just say so and ask what else they'd like.
_CLOSEST: Dict[str, str] = {
    "burgers": r"sandwich|wrap|sub\b|shawarma|fried chicken|chicken fry|wings|nugget|strips|french fr|fries",
    "pizza": r"pasta|spaghetti|lasagn|garlic bread|sandwich|wrap",
    "biryani": r"biry|kacchi|tehari|polao|pulao|fried rice|khichuri|set menu",
    "kebabs": r"kebab|kabab|tikka|grill|bbq|shashlik|sizzl|fried chicken",
    "breakfast items": r"paratha|porota|omelet|toast|sandwich|soup",
    "desserts": r"dessert|ice ?cream|pudding|firni|kulfi|cake|brownie|shake|lassi|juice",
    "coffee": r"coffee|tea|\bcha\b|latte|shake|juice|soft drink",
    "tea": r"tea|\bcha\b|coffee",
    "juice": r"juice|lassi|shake|lemonade|soft drink|coke|sprite|7 ?up",
    "drinks": r"drink|soda|coke|sprite|7 ?up|lemonade|juice|water",
    "alcohol": r"soft drink|coke|sprite|7 ?up|lemonade|mocktail|juice",
}


_KIND_BN = {"burgers": "বার্গার", "pizza": "পিজ্জা", "biryani": "বিরিয়ানি", "kebabs": "কাবাব", "desserts": "ডেজার্ট",
            "coffee": "কফি", "tea": "চা", "juice": "জুস", "drinks": "পানীয়", "alcohol": "অ্যালকোহল",
            "breakfast items": "নাস্তা"}


def _closest_to(kinds: List[str], index: MenuIndex, orderable: Dict[str, bool], limit: int = 3) -> List[Dict[str, Any]]:
    """The menu's dishes genuinely close to what the guest asked for and we don't have (burgers → the fried chicken,
    the sandwich); [] when nothing is close."""
    out: List[Dict[str, Any]] = []
    for k in kinds:
        pat = _CLOSEST.get(k)
        if not pat:
            continue
        for it in index.items:
            if (orderable.get(index.item_id(it), True) and it not in out
                    and re.search(pat, f"{it.get('name') or ''} {it.get('category') or ''}", re.I)):
                out.append(it)
    return out[:limit]


_CHEAPER = re.compile(r"cheaper|less expensive|lower price|more affordable|budget option|কম দাম|কমদামি|সস্তা|sasta|kom dam", re.I)
_TOTAL_CUE = re.compile(r"total|altogether|in all|comes to|adds up|সব মিলিয়ে|মোট|sob miliye|mot\b", re.I)
_QTY_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a": 1, "an": 1,
              "একটা": 1, "একটি": 1, "দুইটা": 2, "দুইটি": 2, "দুটো": 2, "দুটি": 2, "তিনটা": 3, "তিনটি": 3,
              "চারটা": 4, "চারটি": 4, "পাঁচটা": 5, "পাঁচটি": 5}


def _total_slip(reply: str, index: MenuIndex, vat_pct: float = 0.0) -> Optional[Tuple[int, int]]:
    """(claimed, actual) when the reply states a total that doesn't match the dishes it names.
    Quantities come from '2 ×', '2x', 'two', 'দুইটা' just before a dish name; default 1."""
    text = reply or ""
    if not _TOTAL_CUE.search(text):
        return None
    amounts = []
    for m in _TOTAL_CUE.finditer(text):
        window = text[m.start(): m.start() + 60]
        for a in _AMOUNT.finditer(window):
            raw = (a.group(1) or a.group(2) or "").translate(_BN_DIGITS).replace(",", "")
            try:
                amounts.append(int(float(raw)))
            except ValueError:
                pass
    if not amounts:
        return None
    low = text.lower().translate(_BN_DIGITS)
    actual = 0.0
    for it in find_mentions(text, index, limit=10):
        name = str(it.get("name") or "").lower()
        pos = low.find(name)
        if pos < 0:
            core = re.sub(r"\s*\(.*?\)\s*", " ", name).strip()
            pos, name = low.find(core), core
        before = low[max(0, pos - 22): pos] if pos >= 0 else ""
        after = low[pos + len(name): pos + len(name) + 22] if pos >= 0 else ""
        # size: "Full Kacchi Biryani" / "Kacchi Biryani (Full)" → that size's price
        price = float(it.get("price") or 0)
        for v in it.get("variations") or []:
            vn = str(v.get("name") or "").lower()
            if vn and isinstance(v.get("price"), (int, float)) and (re.search(rf"\b{re.escape(vn)}\b", before) or re.search(rf"\b{re.escape(vn)}\b", after)):
                price = float(v["price"])
                break
        # quantity: "3 × X", "three X", "X তিনটি", "X (3 × ৳780)"
        qty = 1
        m = re.search(r"(\d+)\s*(?:×|x)?\s*(?:\w+\s+)?$", before)
        if m:
            qty = int(m.group(1))
        else:
            words = re.findall(r"[\wঀ-৿]+", before)
            w_before = next((_QTY_WORDS[w] for w in reversed(words[-2:]) if w in _QTY_WORDS), None)
            m2 = re.match(r"\s*[\(\-—]?\s*(\d+)\s*(?:×|x|টি|টা|pcs|pieces)", after)
            # (Bangla vowel signs aren't \w, so use an explicit boundary instead of \b)
            w_after = next((n for w, n in _QTY_WORDS.items() if re.match(rf"\s*{re.escape(w)}(?![\wঀ-৿])", after)), None)
            qty = w_before or (int(m2.group(1)) if m2 else None) or w_after or 1
        actual += price * max(1, min(qty, 20))
    if actual <= 0:
        return None
    ok = {int(round(actual)), int(round(actual * (1 + vat_pct / 100.0)))}
    claimed = amounts[0]
    return None if any(abs(claimed - v) <= 1 for v in ok) else (claimed, int(round(actual)))


def _with_plan_total(reply: str, plan: Dict[str, Any], index: MenuIndex, lang: str, restaurant: Optional[Dict[str, Any]]) -> str:
    """Last resort: the reply presents the table plan but never says its total → insert the checked total
    before the closing question. Only when the reply names plan dishes and no other dishes."""
    if not reply or (_TOTAL_CUE.search(reply) and _amounts(reply)):
        return reply
    plan_ids = {l["itemId"] for l in plan["lines"]}
    named = [index.item_id(it) for it in find_mentions(reply, index, limit=10)]
    if len([i for i in named if i in plan_ids]) < 2 or any(i not in plan_ids for i in named):
        return reply
    vat = _vat_hint(restaurant, lang)
    sized = [f"{l['variant']} {l['name']}" for l in plan["lines"] if l.get("variant")]
    if lang == "bn":
        sentence = f"সব মিলিয়ে {_money(plan['total'])}{vat}" + (f" ({', '.join(sized)} ধরে)" if sized else "") + "।"
    else:
        sentence = f"That's {_money(plan['total'])} in total{vat}" + (f" with the {', '.join(sized)}" if sized else "") + "."
    parts = re.split(r"(?<=[.!।])\s+", reply.strip())
    if parts and parts[-1].rstrip().endswith("?"):
        return " ".join(parts[:-1] + [sentence, parts[-1]])
    return reply.rstrip() + " " + sentence


def _fix_kitchen_claim(reply: str, ops: List[Dict[str, Any]], lang: str) -> str:
    """Replace 'I've sent it to the kitchen' with what actually happened: a note on the order."""
    op = next((o for o in ops if o.get("note")), None)
    dish, note = (op["name"], op["note"]) if op else ("", "")
    if lang == "bn":
        fixed = (f"{dish} এর জন্য " if dish else "") + "নোট যোগ করেছি" + (f": {note}" if note else "") + "।"
    else:
        fixed = "I've added a note" + (f" to your {dish}" if dish else "") + (f": {note}" if note else "") + "."
    parts = re.split(r"(?<=[.!?।])\s+", reply.strip())
    for i, p in enumerate(parts):
        if _KITCHEN_CLAIM.search(p):
            parts[i] = fixed
            break
    return " ".join(parts)


def _western_prices(text: str) -> str:
    """৳২৫০০ → ৳2500 (prices stay in Western digits, as on the menu)."""
    return _BN_PRICE.sub(lambda m: "৳" + m.group(1).translate(_BN_DIGITS), text or "")


# --------------------------- validation ---------------------------


def _norm_choice_list(item: Dict[str, Any], raw: Any) -> List[str]:
    """Keep only choices that exist on this item (case-insensitive), preserving menu spelling."""
    names: Dict[str, str] = {}
    for g in item.get("modifierGroups") or []:
        for o in g.get("options") or []:
            if o.get("name"):
                names[str(o["name"]).strip().lower()] = str(o["name"]).strip()
    out: List[str] = []
    for c in raw or []:
        key = str(c or "").strip().lower()
        hit = names.get(key) or next((v for k, v in names.items() if key and (key in k or k in key)), None)
        if hit and hit not in out:
            out.append(hit)
    return out


def _required_choice_names(item: Dict[str, Any]) -> set:
    return {
        str(o.get("name")).strip()
        for g in item.get("modifierGroups") or [] if int(g.get("min") or 0) >= 1
        for o in g.get("options") or [] if o.get("name")
    }


def _missing_required_choices(item: Dict[str, Any], choices: List[str]) -> bool:
    chosen = {c.lower() for c in choices}
    for g in item.get("modifierGroups") or []:
        need = int(g.get("min") or 0)
        if need <= 0:
            continue
        have = sum(1 for o in g.get("options") or [] if str(o.get("name") or "").lower() in chosen)
        if have < need:
            return True
    return False


def _norm_variant(item: Dict[str, Any], raw: Any) -> Optional[Dict[str, Any]]:
    """The item's variation (size/option) the model named, or its only variation; None when unresolved."""
    variations = [v for v in item.get("variations") or [] if v.get("name")]
    if not variations:
        return None
    if len(variations) == 1:
        return variations[0]
    want = str(raw or "").strip().lower()
    if not want:
        return None
    exact = [v for v in variations if str(v["name"]).strip().lower() == want]
    if exact:
        return exact[0]
    loose = [v for v in variations if want in str(v["name"]).lower() or str(v["name"]).lower() in want]
    return loose[0] if len(loose) == 1 else None


_BN_WORDS ={"হাফ": "half", "ফুল": "full", "ছোট": "small", "বড়": "large", "বড়": "large", "মাঝারি": "medium",
             "লার্জ": "large", "স্মল": "small", "মিডিয়াম": "medium", "মিডিয়াম": "medium", "রেগুলার": "regular",
             "ফ্যামিলি": "family",
             "মুরগি": "chicken", "চিকেন": "chicken", "গরু": "beef", "বিফ": "beef", "মাছ": "fish", "ফিশ": "fish",
             "সবজি": "vegetable", "ভেজিটেবল": "vegetable", "চিংড়ি": "prawn", "পানি": "water", "জল": "water"}


_STOP = {"with", "and", "of", "in", "a", "an", "the", "served", "glass", "&", "or", "on"}
_NUM_TOKENS = {
    "one": "1", "ওয়ান": "1", "এক": "1", "১": "1", "two": "2", "টু": "2", "দুই": "2", "২": "2",
    "three": "3", "থ্রি": "3", "তিন": "3", "৩": "3", "four": "4", "ফোর": "4", "চার": "4", "৪": "4",
    "five": "5", "ফাইভ": "5", "পাঁচ": "5", "৫": "5",
}
_SIZE_TOKENS = {"ছোট": "small", "ছোটো": "small", "ছোটটা": "small", "বড়": "large", "বড়ো": "large",
                "বড়টা": "large", "মাঝারি": "medium", "নরমাল": "regular"}
# ("স্যুপের" → স্যুপ, "চিকেনের" → চিকেন: the "-ের" ending, not just "-র", or it leaves "স্যুপে")
_BN_SUFFIX = re.compile(r"(গুলো|গুলি|টার|টির|টা|টি|খানা|এর|য়ের|ের|র)$")


def _sing(w: str) -> str:
    """prawns → prawn, curries → curry, drinks → drink (so 'প্রন' and 'Prawns' meet)."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _name_tokens(name: str) -> set:
    """'Mineral Water (small)' → {mineral, water, small}; 'Set Menu A-01' → {set, menu, a, 1}."""
    toks = set()
    for w in re.findall(r"[a-z]+|\d+", str(name).lower()):
        if w in _STOP:
            continue
        toks.add(str(int(w)) if w.isdigit() else _sing(w))
    return toks


# id(index) → (that index, its words). The index is kept with its entry: a MenuIndex is built every turn, and a
# freed one's id can be reused by the next — another menu's words would be served (and _NEAR_CACHE with them).
_MENU_REV: Dict[int, Tuple[MenuIndex, Dict[str, str]]] = {}


def _menu_rev(index: MenuIndex) -> Dict[str, str]:
    """This menu's own words in Bangla script → the English word ('স্প্রিং' → spring), cached per menu."""
    from bn_translit import word_to_bn

    key = id(index)
    if key not in _MENU_REV or _MENU_REV[key][0] is not index:
        rev: Dict[str, str] = {}
        for it in index.items:
            for w in re.findall(r"[A-Za-z]+", f"{it.get('name') or ''} {it.get('category') or ''}"):
                rev.setdefault(word_to_bn(w), _sing(w.lower()))
        if len(_MENU_REV) > 50 or key in _MENU_REV:
            _MENU_REV.pop(key, None) if len(_MENU_REV) <= 50 else _MENU_REV.clear()
            _NEAR_CACHE.clear()  # keyed by id(rev) — the dropped rev's id can be reused
        _MENU_REV[key] = (index, rev)
    return _MENU_REV[key][1]


def _guest_tokens(text: str, menu_rev: Optional[Dict[str, str]] = None) -> set:
    """The guest's words as menu tokens — English words as they are, Bangla mapped back ('মিনারেল' → mineral)."""
    from bn_translit import WORDS, word_to_bn

    from bn_translit import PHRASES

    rev: Dict[str, str] = {}
    for en, bn in WORDS.items():  # prefer the shortest English form ("prawn" over "prawns")
        if bn not in rev or len(en) < len(rev[bn]):
            rev[bn] = en
    # one Bangla word for a two-word name: "কাজুবাদাম" = cashew nut, "সেচুয়ান" = szu-chuan, "ওয়ান্টন" = won thon
    multi: Dict[str, set] = {}
    for en, bn in list(PHRASES.items()) + [("cashew nut", "কাজুবাদাম"), ("szu chian", "সেচুয়ান")]:
        if " " not in bn:
            multi.setdefault(bn, set()).update(_name_tokens(en.replace("-", " ")))
    out = set()
    for raw in re.findall(r"[A-Za-z]+|\d+|[ঀ-৿]+", (text or "").translate(_BN_DIGITS)):
        w = raw.lower()
        if w.isdigit():
            out.add(str(int(w)))
            continue
        if re.match(r"[a-z]", w):
            out.add(_NUM_TOKENS.get(w) or _sing(w))
            continue
        for cand in (w, _BN_SUFFIX.sub("", w)):
            if cand in multi:
                out |= multi[cand]
                break
            hit = (_NUM_TOKENS.get(cand) or _SIZE_TOKENS.get(cand) or _BN_WORDS.get(cand) or rev.get(cand)
                   or (menu_rev or {}).get(cand))
            if hit:
                out.add(hit if hit.isdigit() else _sing(hit))
                break
        else:
            # said a little differently from how we'd spell it ("পিজ্জা" / "পিৎজা", "কোক" / "কোকা", "ক্যাশুনাট") →
            # the closest word of THIS menu, strictly (so "করেন" never becomes "কর্ন")
            near = _closest_menu_word(_BN_SUFFIX.sub("", w), menu_rev)
            if near:
                out.add(_sing(near))
    for a in [t for t in out if t in _ALIASES]:
        out |= _ALIASES[a]
    return out


_NEAR_CACHE: Dict[Tuple[str, int], Optional[str]] = {}
_PHON = str.maketrans({"্": "", "ৎ": "", "ী": "ি", "ূ": "ু", "শ": "স", "ষ": "স", "ণ": "ন", "ঞ": "ন", "ঢ": "ড", "ঘ": "গ",
                       "ধ": "দ", "ভ": "ব", "ফ": "প", "ঠ": "ট", "থ": "ত", "খ": "ক", "ছ": "চ", "ঝ": "জ", "ঃ": "", "ঁ": ""})


def _phon(w: str) -> str:
    """How a Bangla word SOUNDS, roughly: "পিজ্জা" and "পিৎজা" → "পিজা" (no hasanta / ৎ, doubled letters once)."""
    s = unicodedata.normalize("NFC", w).replace("য়", "য").replace("ড়", "র").replace("ঢ়", "র").translate(_PHON)
    return re.sub(r"(.)\1+", r"\1", s)


def _closest_menu_word(w: str, menu_rev: Optional[Dict[str, str]]) -> Optional[str]:
    if not menu_rev or len(w) < 3 or w in _PLAIN_WORDS or w in _ORDER_FILLER or w in _BN_QTY:
        return None
    key = (w, id(menu_rev))
    if key not in _NEAR_CACHE:
        from rapidfuzz import fuzz, process

        sounds = {}
        for bn in menu_rev:
            sounds.setdefault(_phon(bn), bn)
        best = process.extractOne(_phon(w), list(sounds), scorer=fuzz.ratio, score_cutoff=85)
        if len(_NEAR_CACHE) > 5000:
            _NEAR_CACHE.clear()
        _NEAR_CACHE[key] = menu_rev[sounds[best[0]]] if best else None
    return _NEAR_CACHE[key]


# everyday names for menu words ("একটা কোক" = Coca-Cola)
_ALIASES = {"coke": {"coca", "cola"}, "cola": {"coca", "cola"}, "sevenup": {"7", "up"}, "fries": {"fry"},
            "chips": {"fry"}, "cha": {"tea"}, "water": {"water"}}


# words in a category name that don't say what KIND of food it is ("Chef's Special", "Set Menu", "Combo")
_CAT_GENERIC = {"special", "set", "menu", "item", "dish", "food", "combo", "chef", "house", "platter", "selection",
                "choice", "new", "popular", "regular", "other", "main", "course", "a", "s"}


def _named_kind_ids(transcript: str, index: MenuIndex) -> set:
    """"স্যুপের মধ্যে কী নেওয়া যায়?" → every soup. The dishes of the menu CATEGORY (or kind: drinks, desserts)
    the guest named — a recommendation stays inside it. Empty when they named a particular dish."""
    if _dishes_named(transcript, index):
        return set()
    return _kind_ids_in(transcript, index)


def _kind_ids_in(transcript: str, index: MenuIndex) -> set:
    """The dishes of every menu category / kind these words name (no check for a named dish)."""
    words = _guest_tokens(transcript, _menu_rev(index))
    cat_words = set()
    for cat in {str(it.get("category") or "") for it in index.items}:
        cat_words |= (_name_tokens(cat) - _CAT_GENERIC) & words
    ids = {index.item_id(it) for it in index.items
           if cat_words & (_name_tokens(it.get("name")) | _name_tokens(it.get("category")))}
    ids |= {index.item_id(i) for _, items in kind_items(transcript, index) for i in items}
    return ids


def _kind_word(transcript: str, index: MenuIndex, scope: set) -> str:
    """The guest's own word for the kind they asked about, as a label: "স্যুপের মধ্যে…" → "স্যুপ",
    "ড্রিংকসে কী আছে" → "ড্রিংকস", "which soup" → "soup"."""
    for raw in re.findall(r"[A-Za-z]+|[ঀ-৿]+", transcript or ""):
        if not _kind_ids_in(raw, index) & scope:
            continue
        if re.match(r"[A-Za-z]", raw):
            return raw.lower()
        # (not re-checked: a bare "স্যুপ" reads like a dish name on its own)
        return re.sub(r"(তে|য়ে|ে)$", "", _BN_SUFFIX.sub("", raw)) or raw
    return ""


def _dishes_named(text: str, index: MenuIndex, limit: int = 3) -> List[Dict[str, Any]]:
    """Dishes named in the guest's words, in English OR Bangla script ("অনিয়ন রিং" → Onion Ring,
    "স্পেশাল ফ্রাইড প্রন" → Special Fried Prawn). Every word of the dish name must be there; longest names first."""
    hits = find_mentions(text, index, limit=limit)
    if hits or not re.search(r"[ঀ-৿]", text or ""):
        return hits
    # English plurals said in Bangla script: "রিংস" = rings, "ফ্রাইস" = fries → also try the word without "স"
    # (only ADDS words, so "রাইস" still means rice)
    singular = re.sub(r"([ঀ-৿]{2,})স(?![ঀ-৿])", r"\1", text)
    said = _guest_tokens(text, _menu_rev(index)) | _guest_tokens(singular, _menu_rev(index))
    scored = []
    for it in index.items:
        toks = _name_tokens(str(it.get("name") or ""))
        if toks and toks <= said:
            scored.append((len(toks), it))
    scored.sort(key=lambda x: -x[0])
    out: List[Dict[str, Any]] = []
    for n, it in scored:
        # "Onion Ring" is inside "Onion Ring Special"? keep only the most specific names
        if any(_name_tokens(str(it.get("name") or "")) < _name_tokens(str(o.get("name") or "")) for o in out):
            continue
        out.append(it)
        if len(out) >= limit:
            break
    if out:
        return out
    # last resort, for speech-to-text spellings: the dish name written in Bangla script, fuzzily
    from rapidfuzz import fuzz as _fz

    heard = re.sub(r"\s+", " ", text)
    best = []
    for it in index.items:
        bn_name = to_bangla_script(str(it.get("name") or ""))
        # (the guest must have said at least most of the name — "না" is not "বাটার নান" just because it's inside it)
        if len(bn_name) >= 5 and len(heard.replace(" ", "")) >= 0.7 * len(bn_name.replace(" ", "")):
            s = _fz.partial_ratio(bn_name, heard)
            if s >= 88:
                best.append((s, len(bn_name), it))
    best.sort(key=lambda x: (-x[0], -x[1]))
    return [it for _, _, it in best[:1]]


# "how long to MAKE X?" is about a dish even when the dish name wasn't caught — never the placed-order status
_ABOUT_A_DISH = re.compile(
    r"বানাতে|বানাবে|বানাবেন|তৈরি করতে|তৈরি হতে|রান্না করতে|রান্না হতে|ভাজতে|\bto (make|cook|prepare|fry|grill)\b|"
    r"\b(banate|toiri korte|ranna korte)\b",
    re.I,
)


def _ambiguous_pick(it: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool], heard: Optional[str]) -> List[Dict[str, Any]]:
    """The guest named something that fits several dishes ("মিনারেল ওয়াটার" → small or large; "রাইস" → which rice)
    → [the model's pick, the other fits]. Empty when their words point to exactly this dish, or when they
    didn't name it at all ("ওটা দেন" — a reference the model resolved from the conversation)."""
    if not heard:
        return []
    mine = _name_tokens(it.get("name"))
    words = _guest_tokens(heard, _menu_rev(index))
    said = mine & words
    if not said or said == mine:
        return []  # nothing named (a reference) or the full name said
    if any(o is not it and _name_tokens(o.get("name")) and _name_tokens(o.get("name")) <= words for o in index.items):
        return []  # the guest said ANOTHER dish in full — the retargeting fix corrects the pick, no question needed
    others = [
        o for o in index.items
        if o is not it and orderable.get(index.item_id(o), True) and said <= _name_tokens(o.get("name"))
    ]
    return [it] + others[:5] if others else []


_BIG_WORD = re.compile(r"বড়|বড়|লার্জ|ফ্যামিলি|\b(large|big|family|xl|jumbo)\b", re.I)
_SMALL_WORD = re.compile(r"ছোট|স্মল|\b(small|mini|regular)\b|রেগুলার", re.I)
_MEDIUM_WORD = re.compile(r"মাঝারি|মিডিয়াম|মিডিয়াম|\bmedium\b", re.I)


# "পরে হয়তো একটা কোক নেব", "maybe later", "ভেবে দেখি" — thinking out loud, not an order yet
_NOT_YET = re.compile(r"(?<![ঀ-৿])(পরে|হয়তো|হয়তো|ভেবে দেখি|ভেবে বলছি|দেখি পরে)(?![ঀ-৿])|\b(later|maybe|might|perhaps|think about)\b", re.I)
_NOW_TOO = re.compile(r"এখন(?![ঀ-৿])|এখনই|এখুনি|\b(now|right away)\b", re.I)


def _orders_now_too(t: str) -> bool:
    """"এখন একটা কাচ্চি দিন, পরে হয়তো কোক নেব" — part of it IS an order now (the model sorts the rest)."""
    return bool(_NOW_TOO.search(t or ""))


_DOUBLE = re.compile(r"ডাবল|দ্বিগুণ|দুগুণ|\bdouble\b|\btwice as many\b", re.I)


def _double_it(transcript: str, index: MenuIndex, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"ফ্রেঞ্চ ফ্রাই ডাবল করে দিন" → that line ×2. The dish is named (or it's the only line in the tray). Not "ডাবল
    চিজ বার্গার" (a dish name) — only when the tray line's own name doesn't contain the word."""
    t = transcript or ""
    if not rows or not _DOUBLE.search(t) or "?" in t:
        return []
    said = _guest_tokens(t, _menu_rev(index)) - {"double"}
    hits = []
    for r in rows:
        it = index.by_id.get(str(r.get("itemId"))) or {}
        name = str(it.get("name") or "")
        if _DOUBLE.search(name):
            return []
        if said & _name_tokens(re.sub(r"\s*\(.*?\)", "", name)):
            hits.append((r, it))
    if not hits and len(rows) == 1:
        hits = [(rows[0], index.by_id.get(str(rows[0].get("itemId"))) or {})]
    if len(hits) != 1 or not hits[0][1]:
        return []
    r, it = hits[0]
    return [{"op": "set", "item": index.ref(it), "line": r.get("line"), "quantity": int(r.get("quantity") or 1) * 2}]


_PRAISE = re.compile(r"পছন্দ কর|জনপ্রিয়|জনপ্রিয়|দারুণ|খুব(ই)? ভালো|মজার|মজাদার|স্পেশাল|সেরা|বেস্ট|ভালো লাগবে|ট্রাই কর|"
                     r"\b(popular|favou?rite|love|great|delicious|tasty|best|special|recommend|must[- ]try)\b", re.I)


def _no_praise_for_packaged(text: str, index: MenuIndex, lang: str) -> Tuple[str, bool]:
    """"ছোট মিনারেল ওয়াটার একটা নিতে পারেন, এটা অনেকেই পছন্দ করেন।" → "সাথে কি একটা Mineral Water (small) নেবেন?"
    (dropped when the reply already ends with a question — never two questions)."""
    if not text:
        return text, False
    sents = re.findall(r"[^।.!?]+[।.!?]?", text)
    out, changed = [], False
    for s in sents:
        hits = [it for it in find_mentions(s, index, limit=3) if is_packaged(it)]
        if hits and _PRAISE.search(s) and not [it for it in find_mentions(s, index, limit=3) if not is_packaged(it)]:
            changed = True
            continue
        out.append(s.strip())
    if not changed:
        return text, False
    rest = " ".join(x for x in out if x)
    if not rest.rstrip().endswith("?"):
        name = [it for it in find_mentions(text, index, limit=3) if is_packaged(it)][0].get("name")
        rest = (rest + " " + (f"সাথে কি একটা {name} নেবেন?" if lang == "bn" else f"Would you like a {name} with it?")).strip()
    return rest, True


def _closest_dishes(it: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool], blocked: Dict[str, Any],
                    skip: set, limit: int = 2) -> List[Dict[str, Any]]:
    """What we CAN make instead: most name words in common, same category, nearest price."""
    toks = _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")))
    price = float(it.get("price") or 0)
    cands = []
    for d in index.items:
        did = index.item_id(d)
        if d is it or not orderable.get(did, True) or did in blocked or did in skip:
            continue
        common = len(toks & _name_tokens(str(d.get("name") or "")))
        same_cat = str(d.get("category") or "") == str(it.get("category") or "")
        if not common and not same_cat:
            continue
        cands.append((-(common * 2 + same_cat), abs(float(d.get("price") or 0) - price), d))
    cands.sort(key=lambda c: (c[0], c[1]))
    return [c[2] for c in cands[:limit]]


def _sold_out_head(gone: List[Dict[str, Any]], lang: str) -> str:
    """"দুঃখিত, Onion Rings আর Coca-Cola এখন পাওয়া যাচ্ছে না।" — every dish that can't be made, never just the first."""
    bn = lang == "bn"
    names = [str(g.get("name") or "") for g in gone]
    joined = (", ".join(names[:-1]) + (" আর " if bn else " and ") + names[-1]) if len(names) > 1 else names[0]
    why = str(gone[0].get("unavailableReason") or "").strip() if len(gone) == 1 else ""
    if bn:
        return f"দুঃখিত, {joined} এখন পাওয়া যাচ্ছে না" + (f" ({why})" if why else "") + "।"
    verb = "aren't" if len(gone) > 1 else "isn't"
    return f"Sorry, {'the ' if len(gone) == 1 else ''}{joined} {verb} available right now" + (f" ({why})" if why else "") + "."


def _sold_out_reply(gone: List[Dict[str, Any]], index: MenuIndex, orderable: Dict[str, bool], blocked: Dict[str, Any],
                    lang: str, in_tray: set) -> Tuple[str, List[Dict[str, Any]]]:
    """"দুঃখিত, Beef Sizzling এখন পাওয়া যাচ্ছে না (…)। কাছাকাছি হিসেবে Chicken Sizzling অথবা Prawn Sizzling নিতে
    পারেন — কোনটা দেব?" — with two or more gone, all of them are named and the closest one for each is offered."""
    bn = lang == "bn"
    head = _sold_out_head(gone, lang)
    skip = set(in_tray) | {index.item_id(g) for g in gone}
    if len(gone) == 1:
        alts = _closest_dishes(gone[0], index, orderable, blocked, skip)
    else:
        alts = []
        for g in gone:
            for d in _closest_dishes(g, index, orderable, blocked, skip | {index.item_id(a) for a in alts}, limit=1):
                alts.append(d)
    alts = alts[:3]
    if not alts:
        return head + (" অন্য কিছু নেবেন?" if bn else " Would you like something else?"), []
    names = [str(d.get("name")) for d in alts]
    either = " অথবা " if bn else " or "
    tail = (f" কাছাকাছি হিসেবে {either.join(names)} নিতে পারেন — কোনটা দেব?" if bn
            else f" The closest we have is {either.join(names)} — which one shall I add?")
    opts = [{"label": n, "say": f"{n} দিন" if bn else f"{n}, please", "itemId": index.item_id(d), "price": d.get("price")}
            for n, d in zip(names, alts)]
    return head + tail, opts


def _size_by_words(item: Dict[str, Any], heard: str) -> Optional[Dict[str, Any]]:
    """"একটা বড় কাচ্চি" when the sizes are Half / Full → Full; "লার্জ পিজ্জা" → the Large one. By the sizes' price
    order when their names aren't what the guest said. None when unclear (no size word, or both "ছোট" and "বড়")."""
    variations = [v for v in item.get("variations") or [] if v.get("name")]
    if len(variations) < 2:
        return None
    t = re.sub(r"(হাফ|আধা|half)\s*(ডজন|dozen)", " ", heard or "", flags=re.I)
    named = [v for v in variations if _said(str(v["name"]), t)]
    if len(named) == 1:
        return named[0]
    big, small, mid = bool(_BIG_WORD.search(t)), bool(_SMALL_WORD.search(t)), bool(_MEDIUM_WORD.search(t))
    if big + small + mid != 1:
        return None
    by_price = sorted(variations, key=lambda v: float(v.get("price") or 0))
    if big:
        return by_price[-1]
    if small:
        return by_price[0]
    return by_price[len(by_price) // 2] if len(by_price) == 3 else None


# number words → digits, for sizes like "6 pcs" ("ছয় পিস", "six pieces") — keyed by how the word sounds
_NUM_WORDS = {
    **{w: str(n) for n, w in enumerate(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"], 1)},
    "twelve": "12",
    **{_phon(w): str(n) for w, n in [("এক", 1), ("দুই", 2), ("তিন", 3), ("চার", 4), ("পাঁচ", 5), ("ছয়", 6), ("ছয়", 6),
                                      ("ছয়", 6), ("সাত", 7), ("আট", 8), ("নয়", 9), ("নয়", 9), ("দশ", 10), ("বারো", 12)]},
}
# a size/choice word → the other ways a guest says it
_LABEL_ALIASES = {"pcs": ("pc", "piece", "পিস", "পিচ"), "pc": ("pcs", "piece", "পিস", "পিচ"), "piece": ("pc", "pcs", "পিস")}
_UNIT_WORDS = {"pcs", "pc", "piece", "pieces", "ml", "ltr", "litre", "liter", "inch", "gm", "kg"}


def _said(label: str, transcript: str, dish: str = "") -> bool:
    """Did the guest's own words name this size/choice? ('Full', 'ফুল', 'the fish one' → Fish, 'স্পাইসি' → Spicy,
    'ছয় পিস' → 6 pcs). `dish`: the dish's own name — its words never pick a choice ("hot wings" is not "Extra hot")."""
    from bn_translit import word_to_bn

    t = (transcript or "").lower().translate(_BN_DIGITS)
    for bn, en in _BN_WORDS.items():
        t = t.replace(bn, f" {en} ")
    drop = {w for w in re.findall(r"[a-z]+", str(dish).lower()) if len(w) > 2}
    drop |= {_phon(word_to_bn(w)) for w in list(drop)}
    seq: List[set] = []  # the guest's words in order, each as the forms it can match
    for w in re.findall(r"[a-z]+|\d+|[ঀ-৿]+", t):
        forms = {w, _sing(w)} if w.isascii() else {_phon(w), _phon(_BN_SUFFIX.sub("", w) or w)}
        if forms & drop:
            continue
        num = next((_NUM_WORDS[f] for f in forms if f in _NUM_WORDS), None)
        seq.append({num} if num else forms)

    def names(pos: set, w: str) -> bool:
        for a in (w, *_LABEL_ALIASES.get(w, ())):
            if a.isascii() and (any(f.isascii() and f.startswith(a) for f in pos) or _phon(word_to_bn(a)) in pos):
                return True
            if not a.isascii() and _phon(a) in pos:
                return True
        return False

    lab = str(label).lower().translate(_BN_DIGITS)
    words = [w for w in re.findall(r"[a-z]+", lab) if len(w) > 2 or w in ("xl", "pc")]
    nums = re.findall(r"\d+", lab)
    content = [w for w in words if w not in _UNIT_WORDS]
    if nums and content and any(names(pos, w) for pos in seq for w in content):
        return True  # "Half (2 pcs)" ← "হাফ"
    if nums:  # "6 pcs" needs the number AND its word together — "দুইটা" (the quantity) is not "2 pcs"
        return any(nums[0] in pos and (not words or (i + 1 < len(seq) and any(names(seq[i + 1], w) for w in words)))
                   for i, pos in enumerate(seq))
    return bool(words) and any(names(pos, w) for pos in seq for w in words)


# a question is not an order — unless it's phrased as one ("can I have…", "could you add…")
_ORDER_CUE = re.compile(
    r"\b(add|order (a|an|one|two|three|four|five|\d+|the|some|this|that|it|them)|i'?ll (have|take|get)|i'?d like|"
    r"i want|we want|give me|get me|bring|can (i|we) (have|get|order)|"
    r"could (i|we|you) (have|get|add)|make it|put|one more|another)\b|দিন|দেন|দাও|লাগবে|নেব|নিব|অর্ডার কর|"
    r"দেওয়া যাবে|দেয়া যাবে|দিতে পারবেন|নিতে চাই|খেতে চাই|দেবেন|দিবেন|দিয়েন|দিয়ে দিন|দিয়ে দেন|দেবো|দিবো|নেবো|নিবো|"
    r"অর্ডার দিতে|অর্ডার দিব|অর্ডার দেব|অর্ডার করতে চাই|\b(den|dao|nibo|lagbe|diben|deben|dewa jabe|dite parben|order dibo)\b",
    re.I,
)
# ordering in the same breath as a time question ("add 2 kacchi — how long?") → the model does both.
# Narrower than _ORDER_CUE: "কখন দিবেন?" (when will you bring it?) is a time question, not an order.
_ORDERS_NOW = re.compile(
    r"\b(add|i'?ll (have|take|get)|give me|get me|i want|we want|i'?d like|we'?ll (have|take))\b|"
    r"দিন(?![ঀ-৿])|দেন(?![ঀ-৿])|দাও|নেব|নিব|লাগবে|যোগ কর|\b(den|dao|nibo|lagbe)\b",
    re.I,
)
# "লাগবে" is also the verb of the time question itself: "কতক্ষণ লাগবে?" = how long will it take (not "I need")
_TIME_TAKES = re.compile(
    r"(কতক্ষণ|কতক্ষন|কত সময়|কত সময়|কত মিনিট|সময়|সময়|দেরি|দেরী)\s*(লাগবে|লাগে)|"
    r"\b(koto ?khon|koto (shomoy|somoy|minute)|shomoy|somoy)\s+lag(b)?e\b",
    re.I,
)


def _orders_now(transcript: str) -> bool:
    return bool(_ORDERS_NOW.search(_TIME_TAKES.sub(" ", transcript or "")))
_QUESTION = re.compile(r"\?|^\s*(what|which|how|is|are|do|does|can|could|any|should|where|when)\b|কি\b|কী\b|কোন", re.I)


def _is_question_not_order(transcript: str) -> bool:
    t = (transcript or "").strip()
    return bool(_QUESTION.search(t)) and not _ORDER_CUE.search(t)


def _line_op(
    kind: str, r: Dict[str, Any], raw: Dict[str, Any], it: Dict[str, Any], index: MenuIndex, note: str,
    choices: List[str], heard: Optional[str], problems: List[str],
) -> Optional[Dict[str, Any]]:
    """One change to one existing tray line → a UI op carrying its lineKey (None = nothing to do)."""
    iid, name, have = index.item_id(it), it.get("name"), int(r.get("quantity") or 0)
    base = {"itemId": iid, "name": name, "lineKey": r["key"]}
    if kind == "remove":
        return {"op": "remove", **base}
    if kind == "sub":
        n = _qty(raw.get("quantity")) or 1
        return {"op": "remove", **base} if have - n <= 0 else {"op": "set", **base, "quantity": have - n}
    if kind == "set":
        q = _qty(raw.get("quantity"), allow_zero=True)
        if q is None:
            return None
        if q == 0:
            return {"op": "remove", **base}
        if q != have:
            op = {"op": "set", **base, "quantity": q}
            if note:
                op["note"] = note
            return op
        kind = "note" if (note or raw.get("removeNote")) else ("edit" if choices else "")
        if not kind:
            return None
    if kind == "note" and choices:
        kind = "edit"  # choices on an existing line re-key it (Beef Chili Onion → Szu-Chuan Chicken)
    if kind == "note":
        if raw.get("removeNote") is True and r.get("notes"):
            return {"op": "note", **base, "removeNote": True, "note": ""}
        return {"op": "note", **base, "note": note} if note else None
    if kind == "edit":
        variant = _norm_variant(it, raw.get("variant"))
        many_sizes = len([v for v in it.get("variations") or [] if v.get("name")]) > 1
        if variant is not None and many_sizes and heard is not None and not _said(variant["name"], heard):
            problems.append(f"{name} needs a size/option first")  # a size the guest never said → ask
            return None
        new_var = str(variant["name"]) if variant else (r.get("variation") or "")
        if choices:
            required = _required_choice_names(it)
            if heard is not None and required and not any(_said(c, heard, str(name)) for c in choices if c in required):
                problems.append(f"{name} needs its choices first")
                return None
            if _missing_required_choices(it, choices):
                problems.append(f"{name} needs its choices first")
                return None
            mods = _tray.resolve_choices(it, choices)
        else:
            mods = list(r.get("modifiers") or [])
        remove_note = raw.get("removeNote") is True
        if new_var == (r.get("variation") or "") and _tray.modifiers_key(mods) == _tray.modifiers_key(r.get("modifiers")) \
                and not note and not remove_note:
            return None  # nothing actually changes
        op = {"op": "edit", **base, "quantity": have, "variant": new_var, "choices": [m["name"] for m in mods],
              "modifiers": mods, "price": _tray.unit_price(it, new_var, mods)}
        if note:
            op["note"] = note
        if remove_note:
            op["removeNote"] = True
        return op
    return None


def _validate_ops(
    raw_ops: Any,
    index: MenuIndex,
    cart_qty: Dict[str, int],
    orderable: Dict[str, bool],
    transcript: Optional[str] = None,
    said: Optional[str] = None,
    context_ids: Optional[set] = None,
    rows: Optional[List[Dict[str, Any]]] = None,
    pick_said: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Model ops → safe UI ops {op,itemId,name,quantity?,variant?,price?,note?,choices?,lineKey?}. Returns (ops, problems).
    With the guest's words: sizes and required choices must come from the guest, and a pure question
    ("what can we eat?") never adds anything. With the tray `rows`, changes to things already in the tray
    target one exact line (lineKey) — and ask "which one?" when the dish is in the tray more than once."""
    ops: List[Dict[str, Any]] = []
    problems: List[str] = []
    if transcript:
        raw_ops, problems = _same_dish_twice(raw_ops, transcript, index, orderable)
        raw_ops, unheard = _unplaced_guess(raw_ops, transcript, index, said)
        problems += unheard
    heard = said if said is not None else transcript  # the guest's recent words, not just this sentence
    # WHICH dish ("সিজলিং" → chicken, beef or prawn?) is decided by what the guest says now — plus their answer
    # to the waiter's last question — never by a word from a few turns back ("চিকেন ফ্রাইড রাইস" earlier)
    pick_heard = pick_said if pick_said is not None else heard
    # every dish named in this order: its words never pick another dish's choice ("হট উইংস" ≠ "Extra hot")
    order_names = " ".join(str((index.resolve(r.get("item") or r.get("itemId"), r.get("name")) or {}).get("name") or "")
                           for r in (raw_ops if isinstance(raw_ops, list) else []) if isinstance(r, dict))
    for raw in raw_ops if isinstance(raw_ops, list) else []:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("op") or "").strip().lower()
        line_ref = str(raw.get("line") or "").strip().upper()
        row = next((r for r in rows or [] if r.get("line") == line_ref), None) if line_ref else None
        it = (index.by_id.get(str(row["itemId"])) if row else None) or index.resolve(
            raw.get("item") or raw.get("itemId"), raw.get("name")
        )
        if not it:
            problems.append(f"unknown item {raw.get('item')!r}")
            continue
        iid, name = index.item_id(it), it.get("name")
        note = str(raw.get("note") or "").strip()[:140]
        choices = _norm_choice_list(it, raw.get("choices"))
        if choices and note and all(c.lower() in note.lower() for c in choices):
            note = ""  # the model repeated the choices in the note — keep them once
        in_cart = cart_qty.get(iid, 0)

        # ---- a change to something already in the tray → exactly one line
        if rows is not None and kind in ("set", "sub", "remove", "note", "edit"):
            lines = [row] if row else [r for r in rows if str(r.get("itemId")) == iid]
            if not lines and kind != "set":
                continue  # nothing of that in the tray to change
            if len(lines) > 1:
                if kind == "remove" and transcript and _tray.ALL_WORDS.search(transcript):
                    for r in lines:  # "দুইটাই বাদ দিন" / "remove both"
                        ops.append({"op": "remove", "itemId": iid, "name": name, "lineKey": r["key"]})
                        cart_qty.pop(iid, None)
                    continue
                problems.append(
                    f"{name}: which one? the tray has several lines: " + " | ".join(_tray.label(r) for r in lines)
                )
                continue
            if lines:
                op = _line_op(kind, lines[0], raw, it, index, note, choices, heard, problems)
                if op:
                    ops.append(op)
                    if op["op"] == "remove":
                        cart_qty[iid] = max(0, cart_qty.get(iid, 0) - int(lines[0]["quantity"]))
                    elif op["op"] == "set":
                        cart_qty[iid] = cart_qty.get(iid, 0) - int(lines[0]["quantity"]) + op["quantity"]
                continue

        if kind in ("add", "set") and not orderable.get(iid, True):
            problems.append(f"{name} is not orderable now")
            continue
        variant = _norm_variant(it, raw.get("variant"))
        many_sizes = len([v for v in it.get("variations") or [] if v.get("name")]) > 1
        if many_sizes and heard is not None:
            by_words = _size_by_words(it, pick_heard or heard)  # "বড়" → the biggest size, "ছোট" → the smallest
            if variant is not None and not _said(variant["name"], heard):
                variant = by_words  # the model picked a size the guest never said — ask instead of guessing
            elif variant is None:
                variant = by_words
        needs_variant = bool(it.get("variations")) and variant is None
        if choices and heard is not None and _required_choice_names(it) and not any(
            _said(c, heard, f"{name} {order_names}") for c in choices if c in _required_choice_names(it)
        ):
            choices = [c for c in choices if c not in _required_choice_names(it)]  # guessed choice → ask
        if kind in ("add", "set") and not in_cart and transcript is not None and _is_question_not_order(transcript):
            problems.append(f"{name}: the guest asked a question, not for an order")
            continue
        if kind == "add" and transcript is not None and _NOT_YET.search(transcript) and not _orders_now_too(transcript):
            problems.append(f"{name}: not ordering it yet (later / maybe)")
            continue
        # "মিনারেল ওয়াটার" when there is a small AND a large, "রাইস" when there are five rice dishes → ask which
        if kind in ("add", "set") and not in_cart:
            fits = _ambiguous_pick(it, index, orderable, pick_heard)
            ctx = context_ids or set()
            if fits and not (iid in ctx and not any(index.item_id(o) in ctx for o in fits[1:])):
                # the guest DID say what tells them apart ("বড় পানি" → large) but the model picked another → use theirs
                words = _guest_tokens(pick_heard, _menu_rev(index))
                scored = sorted(fits, key=lambda o: len(_name_tokens(o.get("name")) & words), reverse=True)
                top = len(_name_tokens(scored[0].get("name")) & words)
                if scored[0] is not it and top > len(_name_tokens(it.get("name")) & words) and (
                    len(scored) == 1 or top > len(_name_tokens(scored[1].get("name")) & words)
                ):
                    it = scored[0]
                    iid, name = index.item_id(it), it.get("name")
                    in_cart = cart_qty.get(iid, 0)
                    variant = _norm_variant(it, raw.get("variant"))
                    needs_variant = bool(it.get("variations")) and variant is None
                    choices = _norm_choice_list(it, raw.get("choices"))
                    problems.append(f"{name}: retargeted to the size the guest said")
                else:
                    problems.append(f"{name}: which one? the guest's words fit several dishes: " + " | ".join(str(o.get("name")) for o in fits))
                    continue
        if kind == "add":
            q = _qty(raw.get("quantity")) or 1
            if _missing_required_choices(it, choices):
                problems.append(f"{name} needs its choices first")
                continue
            if needs_variant:
                problems.append(f"{name} needs a size/option first")
                continue
            op = {"op": "add", "itemId": iid, "name": name, "quantity": q}
        elif kind == "set":
            q = _qty(raw.get("quantity"), allow_zero=True)
            if q is None:
                continue
            if q == 0:
                if not in_cart:
                    continue
                op = {"op": "remove", "itemId": iid, "name": name}
            elif not in_cart:
                if _missing_required_choices(it, choices):
                    problems.append(f"{name} needs its choices first")
                    continue
                if needs_variant:
                    problems.append(f"{name} needs a size/option first")
                    continue
                op = {"op": "add", "itemId": iid, "name": name, "quantity": q}
            elif q == in_cart:
                if note or choices:
                    op = {"op": "note", "itemId": iid, "name": name}
                else:
                    continue
            else:
                op = {"op": "set", "itemId": iid, "name": name, "quantity": q}
        elif kind == "remove":
            if not in_cart:
                continue
            op = {"op": "remove", "itemId": iid, "name": name}
        elif kind == "note":
            if not (note or choices):
                continue
            if not in_cart:
                problems.append(f"note for {name} which isn't in the cart")
                continue
            op = {"op": "note", "itemId": iid, "name": name}
        else:
            continue
        if note and op["op"] != "remove":
            op["note"] = note
        if choices and op["op"] != "remove":
            op["choices"] = choices
        # the line's real unit price: the size's price (or the base) + paid add-ons ("Fish +৳50")
        base = variant.get("price") if variant and isinstance(variant.get("price"), (int, float)) else it.get("price")
        surcharge = sum(
            float(o.get("price") or 0)
            for g in it.get("modifierGroups") or [] for o in g.get("options") or []
            if o.get("name") in (op.get("choices") or [])
        )
        if variant:
            op["variant"] = str(variant["name"])
        if (variant or surcharge) and isinstance(base, (int, float)):
            op["price"] = float(base) + surcharge
        ops.append(op)
        # keep later ops in this turn consistent with earlier ones
        if op["op"] == "add":
            cart_qty[iid] = in_cart + op["quantity"]
        elif op["op"] == "set":
            cart_qty[iid] = op["quantity"]
        elif op["op"] == "remove":
            cart_qty.pop(iid, None)
    return ops, problems


def _reconcile_ops_with_words(ops: List[Dict[str, Any]], transcript: str, index: MenuIndex) -> List[str]:
    """The guest said a dish by name, but the model changed a look-alike ("Beef with Red Curry" asked,
    "Chicken with Red Curry" added) → retarget the op to what the guest actually said. Returns fixes."""
    from rapidfuzz import fuzz

    named = find_mentions(transcript, index, limit=6)
    if not named:
        return []
    named_ids = {index.item_id(i) for i in named}
    op_ids = {o["itemId"] for o in ops}
    fixes = []
    for op in ops:
        if op["itemId"] in named_ids:
            continue
        said = max(named, key=lambda it: fuzz.ratio(op["name"].lower(), str(it.get("name")).lower()))
        sid = index.item_id(said)
        if sid not in op_ids and fuzz.ratio(op["name"].lower(), str(said.get("name")).lower()) >= 70:
            fixes.append(f"{op['name']} → {said.get('name')}")
            op["itemId"], op["name"] = sid, said.get("name")
            op_ids.add(sid)
    return fixes


def _best_fit_dish(ops: List[Dict[str, Any]], transcript: str, index: MenuIndex, orderable: Dict[str, bool]) -> List[str]:
    """"একটা ওয়ান্টন স্যুপ" → the model added Fried Won Thon. In the PHRASE about this dish the guest said won-thon
    AND soup — Won Thon Noodle Soup covers more of their words, so that's the dish. Only a clear winner (a tie is
    left to the "which one?" checks), only between look-alikes, never onto a dish that needs a size / choice first."""
    rev = _menu_rev(index)
    segs = [s for s in re.split(r"\s*(?:,|।|\s(?:আর|এবং|and|সাথে|plus)\s)\s*", transcript or "") if s.strip()]
    seg_toks = [{t for t in _guest_tokens(s, rev) if not t.isdigit()} for s in segs]
    core = lambda it: _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")))  # noqa: E731
    op_ids = {o["itemId"] for o in ops}
    fixes: List[str] = []
    for op in ops:
        it = index.by_id.get(op["itemId"])
        if op["op"] != "add" or not it or op.get("variant") or op.get("choices"):
            continue
        toks = core(it)
        said = max(seg_toks, key=lambda s: len(s & toks), default=set())
        have = len(said & toks)
        if not have:
            continue
        rivals = []
        for d in index.items:
            did = index.item_id(d)
            if did in op_ids or not orderable.get(did, True):
                continue
            dt = core(d)
            n = len(said & dt)
            if n > have and dt & toks:
                rivals.append((n, -len(dt - said), d))
        if not rivals:
            continue
        rivals.sort(key=lambda r: (-r[0], -r[1]))
        if len(rivals) > 1 and rivals[1][:2] == rivals[0][:2]:
            continue
        d = rivals[0][2]
        if _required_choice_names(d) or len([v for v in d.get("variations") or [] if v.get("name")]) > 1:
            continue
        fixes.append(f"{op['name']} → {d.get('name')}")
        op["itemId"], op["name"] = index.item_id(d), d.get("name")
        if "price" in op:
            op["price"] = d.get("price")
        op_ids.add(op["itemId"])
    return fixes


# "দুইটা করে", "two each", "প্রত্যেকটা দুইটা" — one number for every dish in the sentence
_EACH = re.compile(r"(\S+)\s+করে(?![ঀ-৿])|(\S+)\s+(?:of\s+)?each\b|\beach\b|প্রত্যেক(?:টা|টি)?\s+(\S+)", re.I)


_SIZE_UNIT = re.compile(r"^(পিস|পিচ|pcs?|pieces?)", re.I)


def _without_size_count(seg: str, it: Dict[str, Any]) -> str:
    """"একটা হট উইংস ৬ পিস" with sizes 6 pcs / 10 pcs → "একটা হট উইংস": the "৬ পিস" is the SIZE, not six of them
    (it made 6 × Hot Wings)."""
    nums = {m.group() for v in it.get("variations") or [] if v.get("name") and _said(str(v["name"]), seg)
            for m in [re.search(r"\d+", str(v["name"]))] if m}
    if not nums:
        return seg
    words = seg.translate(_BN_DIGITS).split()
    out, skip = [], False
    for i, w in enumerate(words):
        if skip:
            skip = False
            continue
        base = _BN_SUFFIX.sub("", w.lower()) or w.lower()
        val = w if w.isdigit() else _NUM_WORDS.get(_phon(base)) or _NUM_WORDS.get(base)
        if val in nums and i + 1 < len(words) and _SIZE_UNIT.search(words[i + 1]):
            skip = True
            continue
        out.append(w)
    return " ".join(out)


def _fix_quantities(ops: List[Dict[str, Any]], transcript: str, index: MenuIndex) -> List[str]:
    """The number the GUEST said for a dish wins over the model's: "হাফ ডজন স্প্রিং রোল" is 6 (not 1), and
    "চিকেন সিজলিং আর ফ্রেঞ্চ ফ্রাই দুইটা করে" is 2 of each (not 1 + 2). Only for dishes being added, only when the
    phrase about that dish is clear (one dish in it). Returns what was corrected."""
    # a table number or a price is not a count ("বারো নম্বর টেবিলে দুইটা কোক", "৩০০ টাকার মধ্যে")
    t = re.sub(r"\S+\s*(নম্বর|নাম্বার)\s*টেবিল\S*|টেবিল\s*(নম্বর|নাম্বার)?\s*\S+|\btable\s*(no\.?|number)?\s*\S+|"
               r"৳\s*\S+|\S+\s*(টাকা\S*|taka|tk)\b", " ", transcript or "", flags=re.I)
    each = None
    m = _EACH.search(t)
    if m:
        each = _said_quantity(next((g for g in m.groups() if g), "") or t)
    rev = _menu_rev(index)
    segs = [s for s in re.split(r"\s*(?:,|।|\s(?:আর|এবং|and|সাথে|plus)\s)\s*", t) if s.strip()]
    seg_toks = [{x for x in _guest_tokens(s, rev) if not x.isdigit()} for s in segs]
    adds = [o for o in ops if o["op"] == "add"]
    fixes: List[str] = []
    for o in adds:
        it = index.by_id.get(o["itemId"])
        if not it:
            continue
        toks = _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")))
        overlap = [len(s & toks) for s in seg_toks]
        if not overlap or max(overlap) == 0:
            continue
        k = overlap.index(max(overlap))
        # this phrase must be about this dish alone (two ops in one phrase → leave it)
        if sum(1 for x in adds if x is not o and len(seg_toks[k] & _name_tokens(str(x.get("name") or ""))) >= max(overlap)):
            continue
        said = _said_quantity(_without_size_count(segs[k], it))
        want = said if said is not None else each
        if want and want != int(o.get("quantity") or 1):
            fixes.append(f"{o['name']}: {o.get('quantity')} → {want}")
            o["quantity"] = want
    return fixes


def _apply_ops(cart_qty: Dict[str, int], ops: List[Dict[str, Any]], clear: bool) -> Dict[str, int]:
    out = {} if clear else dict(cart_qty)
    for op in ops:
        iid = op["itemId"]
        if op["op"] == "add":
            out[iid] = out.get(iid, 0) + op["quantity"]
        elif op["op"] == "set":
            out[iid] = op["quantity"]
        elif op["op"] == "remove":
            out.pop(iid, None)
    return {k: v for k, v in out.items() if v > 0}


# --------------------------- deterministic replies ---------------------------


def _summary(
    index: MenuIndex, qty: Dict[str, int], prices: Optional[Dict[str, float]] = None, labels: Optional[Dict[str, str]] = None
) -> Tuple[str, float]:
    """'2 × Kacchi Biryani (Half), 1 × Borhani', total — using the cart line's real unit price (sizes, add-ons)."""
    parts, total = [], 0.0
    for iid, q in qty.items():
        it = index.by_id.get(iid) or {}
        label = (labels or {}).get(iid)
        parts.append(f"{q} × {it.get('name') or iid}" + (f" ({label})" if label else ""))
        unit = (prices or {}).get(iid)
        total += float(unit if unit is not None else (it.get("price") or 0)) * q
    return ", ".join(parts), total


_END_Q_BN = re.compile(r"(আর কিছু (লাগবে|দেব|নেবেন|চাই)[^?।]*\?|সাথে আর কিছু[^?।]*\?|আর কিছু যোগ[^?।]*\?)\s*$")
_END_Q_EN = re.compile(r"(anything else[^?.]*\?|would you like anything else[^?.]*\?)\s*$", re.I)


# "হট উইংস লাগবে না", "ওটা বাদ দিন", "cancel the wings" — a dish waiting for its options is dropped
_DROP_HELD = re.compile(r"লাগবে না|চাই না|নেব না|নিব না|বাদ (দিন|দেন|দাও|দিয়ে)|বাতিল|\b(cancel|remove|skip|don'?t want|no need|forget)\b", re.I)
# "হ্যাঁ, দুইটা দেন" / "জি দেন" / "yes, two please" — a yes that goes on (is_affirmative wants it bare)
_YES_START = re.compile(r"^\s*(হ্যাঁ|হ্যা|হাঁ|হা|জি|জ্বি|অবশ্যই|ঠিক আছে|দেন|দিন|দাও|yes|yeah|yep|sure|ok|okay|please)(?![ঀ-৿a-z])", re.I)
# "কনফার্ম করুন" / "place the order" — the guest wants it placed (not "that's all": the end-of-meal offer still comes)
_SAYS_CONFIRM = re.compile(r"কনফার্ম|confirm|অর্ডার (দিয়ে|প্লেস|দিন)|place (it|the order|my order)", re.I)


# a pitch in the model's own words: "সাথে ক্লাসিক ফ্রাইজ নিলে দারুণ হবে", "goes great with", "you could also try"
_PAIR_CUE = re.compile(
    r"সাথে\s.*(নিলে|নিতে পারেন|ভালো যাবে|ভালো লাগবে|দারুণ|জমবে|ট্রাই)|(নিলে|নিতে পারেন)\s.*(দারুণ|ভালো|জমবে)|"
    r"goes (really )?(well|great) with|pairs? (well|nicely)|you (could|might|may) (also )?(add|try|get|like)|"
    r"how about (a|an|some|adding)|(would|do) you (like|want) (a|an|some|any) .*(with (it|that|this|your)|to go with)",
    re.I,
)


# the guest is asking for another dish (or one that suits a need) — an alternative is the answer, not a pitch
_WANTS_OTHER = re.compile(
    r"ঝাল|spic|\bhot\b|অ্যালার্জ|এলার্জ|allerg|নিরামিষ|ভেজ|\bveg|হালাল|halal|বাজেট|budget|সস্তা|cheap|দাম|price|"
    r"অন্য|বদলে|instead|other|alternative|মতো|মত\b|similar|like it|আর কী|আর কি|ছাড়া|without|কম\s|less|বেশি|more",
    re.I,
)


def _strip_pitches(reply: str, keep_ids: set, index: MenuIndex) -> str:
    """A: after a cart change the model never pitches — the offer engine (offers.py) is the only one that offers.
    Drops the sentences that name a dish nobody ordered, pair something ("…নিলে দারুণ হবে") or ask about a kind
    ("সাথে কি কোনো ডেজার্ট নিবেন?")."""
    out = []
    for sent in re.findall(r"[^।.!?]+[।.!?]?", reply or ""):
        if not sent.strip():
            continue
        # (dish names in English or Bangla script — "হট উইংস" is Hot Wings)
        other = [it for it in _dishes_named(sent, index, limit=4) if index.item_id(it) not in keep_ids]
        if other or _PAIR_CUE.search(sent) or upsell_engine.asked_upsell(sent):
            continue
        out.append(sent.strip())
    return " ".join(out)


def _ask_anything_else_or_confirm(reply: str, lang: str) -> str:
    """After adding food: "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" — not just "আর কিছু লাগবে?"."""
    r = (reply or "").rstrip()
    if lang == "bn":
        if "কনফার্ম" in r or "দিয়ে দেব" in r:
            return r
        q = "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
        return _END_Q_BN.sub(q, r) if _END_Q_BN.search(r) else (r if r.endswith("?") else f"{r} {q}".strip())
    if re.search(r"confirm|place (it|your order)", r, re.I):
        return r
    q = "Anything else, or shall I confirm your order?"
    return _END_Q_EN.sub(q, r) if _END_Q_EN.search(r) else (r if r.endswith("?") else f"{r} {q}".strip())


def _vat_hint(restaurant: Optional[Dict[str, Any]], lang: str) -> str:
    for note in (restaurant or {}).get("menuNotes") or []:
        m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*(vat|tax)", str(note), re.I)
        if m and re.search(r"exclusive|excluding|not included|\+", str(note), re.I):
            return f" (+{m.group(1)}% VAT)" if lang == "en" else f" (+{m.group(1)}% ভ্যাট)"
    return ""


def _cart_change_reply(
    ops: List[Dict[str, Any]], cleared: bool, index: MenuIndex, final_qty: Dict[str, int], lang: str,
    restaurant: Optional[Dict[str, Any]], prices: Optional[Dict[str, float]] = None, labels: Optional[Dict[str, str]] = None,
    with_summary: bool = True,
    rows: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """What changed, in one line each, then the order now. With the tray `rows` the summary lists every line
    exactly (a Half and a Full Kacchi are two lines)."""
    bits: List[str] = []
    bn = lang == "bn"
    if cleared:
        bits.append("আপনার ট্রে খালি করা হলো।" if bn else "Done — I've cleared your order.")
    for op in ops:
        label = ", ".join([*([op["variant"]] if op.get("variant") else []), *(op.get("choices") or [])])
        n = op["name"] + (f" ({label})" if label else "")
        if op["op"] == "add" and isinstance(op.get("price"), (int, float)):
            if op.get("quantity", 1) == 1:
                n += f" — {_money(op['price'])}"
            else:
                n += f" — প্রতিটা {_money(op['price'])}" if bn else f" — {_money(op['price'])} each"
        if op["op"] == "add":
            bits.append(f"{op['quantity']}টা {n} যোগ করলাম।" if bn else f"Added {op['quantity']} × {n}.")
        elif op["op"] == "set":
            bits.append(f"{n} এখন {op['quantity']}টি।" if bn else f"{n} is now {op['quantity']}.")
        elif op["op"] == "remove":
            bits.append(f"{n} বাদ দেওয়া হলো।" if bn else f"Removed {n}.")
        elif op["op"] == "edit":
            bits.append(f"{op['name']} বদলে {label or 'আগের মতো'} করা হলো।" if bn else f"Changed {op['name']} to {label or 'as before'}.")
        elif op["op"] == "restore":
            line = op.get("line") or {}
            bits.append(f"{_tray.label(line)} ফিরিয়ে আনা হলো।" if bn else f"Brought back {_tray.label(line)}.")
        elif op["op"] == "note" and op.get("removeNote"):
            bits.append(f"{op['name']} এর নোট সরিয়ে দিলাম।" if bn else f"Removed the note on {op['name']}.")
        elif op["op"] == "note":
            extra = ", ".join([*(op.get("choices") or []), *([op["note"]] if op.get("note") else [])])
            bits.append(f"{n} এর জন্য নোট রাখা হলো: {extra}।" if bn else f"Noted for {n}: {extra}.")
    if not with_summary:
        return " ".join(bits)
    # Short, like a waiter: what changed + "anything else?". The tray (lines + total) is on the guest's screen, and
    # the full read-back comes once, when they confirm — reading it after every add was long (and the voice costly).
    if rows is not None:
        summary, total, _ = _tray.summary(rows)
    else:
        summary, total = _summary(index, final_qty, prices, labels)
    if summary:
        bits.append("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn else "Anything else, or shall I confirm your order?")
    elif not cleared:
        bits.append("আপনার ট্রে এখন খালি।" if bn else "Your order is empty now.")
    return " ".join(bits)


def _final_rows(
    cart_rows: List[Dict[str, Any]], final_qty: Dict[str, int], ops: List[Dict[str, Any]], index: MenuIndex,
    prices: Dict[str, float],
) -> List[Dict[str, Any]]:
    """The order as it stands after this turn, line by line (sizes, add-ons, notes) — what the read-back says."""
    if not ops:
        return [r for r in cart_rows if final_qty.get(r["itemId"], 0) > 0]
    touched = list(dict.fromkeys(o["itemId"] for o in ops))
    rows = [dict(r) for r in cart_rows if r["itemId"] not in touched and final_qty.get(r["itemId"], 0) > 0]
    for iid in touched:
        q = final_qty.get(iid, 0)
        if q <= 0:
            continue
        it = index.by_id.get(iid) or {}
        prev = next((r for r in cart_rows if r["itemId"] == iid), None) or {}
        op = next(o for o in reversed(ops) if o["itemId"] == iid)
        rows.append({
            "itemId": iid, "name": it.get("name") or op.get("name") or iid, "quantity": q,
            "price": prices.get(iid, it.get("price") or 0),
            "variation": op.get("variant") or prev.get("variation") or "",
            "modifiers": [{"name": c} for c in op.get("choices") or []] or list(prev.get("modifiers") or []),
            "notes": op.get("note") or prev.get("notes") or "",
        })
    return rows


def _order_draft(rows: List[Dict[str, Any]], table: str, signature: str) -> Dict[str, Any]:
    """What the server sends to POST /public/orders — the server re-prices everything."""
    lines = []
    for r in rows:
        mods = [
            {"groupId": str(m["groupId"]), "optionId": str(m["optionId"])}
            for m in r.get("modifiers") or [] if m.get("groupId") and m.get("optionId")
        ]
        line: Dict[str, Any] = {"itemId": r["itemId"], "qty": int(r["quantity"])}
        if r.get("variation"):
            line["variation"] = r["variation"]
        if mods:
            line["modifiers"] = mods
        if r.get("notes"):
            line["notes"] = str(r["notes"])[:200]
        lines.append(line)
    # expectedTotal is informational (logs / evals) — the server re-prices and its total is what the guest hears
    total = sum(float(r.get("price") or 0) * int(r["quantity"]) for r in rows)
    return {"table": table, "items": lines, "signature": signature, "expectedTotal": total}


def _checkout_turn(
    action: str, *, rows: List[Dict[str, Any]], table: Optional[str], lang: str, restaurant: Optional[Dict[str, Any]],
    prev: Dict[str, Any], transcript: str, ops_line: str = "", eta_hint: str = "", online: bool = False,
) -> Tuple[Optional[str], Dict[str, Any], Dict[str, Any]]:
    """Checkout action → (reply to speak or None to keep the model's, decision flags, new checkout state).
    Online (pickup / delivery) guests have no table and finish on the form (name, phone, address), so
    read-back / ask-table / place all become "here's your order — fill in your details" and nothing is placed by voice."""
    tbl = table or ""
    sig = co.cart_signature(rows)
    lead = (ops_line + " ") if ops_line else ""
    if online and action in ("readback", "ask_table", "place"):
        text = co.online_checkout_text(rows, lang, _vat_hint(restaurant, lang), eta_hint)
        return lead + text, {"showCheckout": True, "askDetails": True, "checkoutStage": "details"}, {"stage": "none", "sig": sig, "table": ""}
    if action == "readback":
        text = co.readback_text(rows, tbl, lang, _vat_hint(restaurant, lang), eta_hint)
        return lead + text, {"showCheckout": True, "checkoutStage": "readback"}, {"stage": "readback", "sig": sig, "table": tbl}
    if action == "ask_table":
        # "send it" with no table yet: once the table is given, it is placed straight away
        direct = co.wants_send_now(transcript) or bool(prev.get("direct"))
        return (lead + co.ask_table_text(lang), {"askTable": True, "checkoutStage": "table"},
                {"stage": "table", "sig": "", "table": "", **({"direct": True} if direct else {})})
    if action == "place":
        text = "ঠিক আছে, অর্ডারটা দিচ্ছি…" if lang == "bn" else "Great — placing your order now…"
        return text, {"placeOrder": True, "checkoutStage": "placing"}, {"stage": "none", "sig": sig, "table": tbl}
    if action == "hold":
        text = None if "?" in transcript else lead + co.held_text(lang)
        return text, {"checkoutStage": "none"}, {"stage": "none", "sig": "", "table": tbl}
    if action == "empty":
        return co.empty_cart_text(lang), {"checkoutStage": "none"}, {"stage": "none", "sig": "", "table": tbl}
    if action == "reset":
        return None, {}, {"stage": "none", "sig": "", "table": tbl}
    return None, {}, {**prev, "table": tbl or prev.get("table") or ""}


_AMOUNT = re.compile(
    r"(?:৳|\btk\.?|\btaka\b|\bbdt\b)\s*([0-9০-৯][0-9০-৯,]*(?:\.\d+)?)|([0-9০-৯][0-9০-৯,]*(?:\.\d+)?)\s*(?:৳|টাকা|\btaka\b|\btk\b)",
    re.I,
)


_UNAVAILABLE_WORDS = re.compile(
    r"sold out|not available|unavailable|isn'?t available|out of stock|not served|served (from|between|only)|closed"
    r"|শেষ|পাওয়া যাচ্ছে না|পাওয়া যায় না|নেই|বন্ধ",
    re.I,
)

# stricter: a claim that a dish can't be ordered (not "has no meat" / "মাংস নেই")
_SAYS_UNAVAILABLE = re.compile(
    r"sold out|not available|unavailable|isn'?t available|out of stock|can'?t be ordered|not (being )?served (now|right now|today)"
    r"|not on (the|our) menu|(isn'?t|is not) on (the|our) menu"
    r"|শেষ হয়ে গেছে|পাওয়া যাচ্ছে না|পাওয়া যাবে না|এখন নেই|আজ নেই|মেনুতে নেই|এখন (মেনুতে )?পাওয়া যায় না|এখন দেওয়া যাচ্ছে না",
    re.I,
)

# any "it isn't there" wording — used only on sentences that name a dish we are ADDING (then it's a contradiction)
_NEG_CLAIM = re.compile(
    r"\b(not|no longer|isn'?t|aren'?t|don'?t have|unavailable|sold out|out of stock)\b"
    r"|নেই|নাই|পাওয়া যা(চ্ছে|বে|য়) না|শেষ হয়ে|দেওয়া যাবে না|দেওয়া যাচ্ছে না",
    re.I,
)


def _contradicts_adds(reply: str, adds: List[str]) -> List[str]:
    """Dishes being added that the reply, in the same sentence, says we don't have ("X এখন উপলব্ধ নেই")."""
    sentences = re.split(r"(?<=[.!?।])\s+|\s+(?:but|however|তবে|কিন্তু)\s+", reply or "", flags=re.I)
    out = []
    for name in adds:
        core = re.sub(r"\s*\(.*?\)\s*", " ", name).strip().lower()
        if any((name.lower() in s.lower() or (core and core in s.lower())) and _NEG_CLAIM.search(s) for s in sentences):
            out.append(name)
    return out


_BUDGET = re.compile(
    r"\bbudget\b|\b(under|below|within|less than|only have|have only|got)\s+(৳\s*)?[0-9০-৯]{2,}|[0-9০-৯]{2,}\s*(৳|taka|tk|টাকা)(র| এর)? (মধ্যে|ভিতরে|ভেতরে)|বাজেট",
    re.I,
)


def _amounts(text: str) -> List[int]:
    out = []
    for m in _AMOUNT.finditer(text or ""):
        raw = (m.group(1) or m.group(2) or "").translate(_BN_DIGITS).replace(",", "")
        try:
            out.append(int(float(raw)))
        except ValueError:
            pass
    return out


def _new_amounts(reply: str, transcript: str) -> List[int]:
    """Amounts in the reply that the guest didn't say themselves (e.g. not just echoing their budget)."""
    said = set(_amounts(transcript)) | {
        int(n) for n in re.findall(r"\d+", (transcript or "").translate(_BN_DIGITS)) if len(n) < 7
    }
    return [a for a in _amounts(reply) if a not in said]


def _price_slips(reply: str, index: MenuIndex, cart_rows: List[Dict[str, Any]], subtotal: float) -> List[int]:
    """Amounts that look like a mis-quoted menu price (e.g. ৳235 for a ৳230 dish).

    Totals and multiples are allowed; only near-misses of a real price are flagged, so a
    legitimate budget sum doesn't trigger a retry."""
    prices = set()
    for it in index.items:
        for p in [it.get("price"), *[v.get("price") for v in it.get("variations") or []]]:
            if isinstance(p, (int, float)) and p > 0:
                prices.add(int(round(p)))
        for g in it.get("modifierGroups") or []:
            for o in g.get("options") or []:
                if isinstance(o.get("price"), (int, float)) and o["price"] > 0:
                    prices.add(int(round(o["price"])))
    allowed = set(prices) | {p * q for p in prices for q in range(2, 11)}
    allowed |= {int(round(subtotal))} | {int(round(float(r["price"] or 0) * r["quantity"])) for r in cart_rows}
    slips = []
    for m in _AMOUNT.finditer(reply or ""):
        raw = (m.group(1) or m.group(2) or "").translate(_BN_DIGITS).replace(",", "")
        try:
            amount = int(float(raw))
        except ValueError:
            continue
        if amount in allowed or amount <= 5:
            continue
        if any(0 < abs(amount - p) <= max(10, p * 0.05) for p in prices):
            slips.append(amount)
    return slips


def _reco_fallback(pool: List[Dict[str, Any]], lang: str, ctx: Dict[str, Any]) -> str:
    """Safe recommendation built only from the time-/availability-checked pool."""
    bn = lang == "bn"
    if not pool:
        reason = next((u.get("reason") for u in ctx.get("unavailableNow") or [] if u.get("reason")), "")
        if bn:
            return reason or "দুঃখিত, এই মুহূর্তে অর্ডার নেওয়া যাচ্ছে না।"
        return reason or "Sorry, we can't take orders right now."
    picks = [str(p.get("name")) for p in pool[:3]]  # prices are on the cards
    listed = ", ".join(picks[:-1]) + (" or " if not bn else " অথবা ") + picks[-1] if len(picks) > 1 else picks[0]
    period = str(ctx.get("mealPeriod") or "").split(" (")[0]
    if bn:
        return f"এখন{(' ' + period + ' এর জন্য') if period and 'between' not in period else ''} আপনার জন্য ভালো হবে {listed}। অর্ডার করতে চান?"
    when = f" for {period.lower()}" if period and "between" not in period else ""
    return f"Right now{when}, I'd suggest {listed}. Would you like to order?"


def _reply_mentions(reply: str, name: str) -> bool:
    r = reply.lower()
    n = name.lower()
    if n in r:
        return True
    core = re.sub(r"\s*\(.*?\)\s*", " ", n).strip()  # "Mineral Water (small)" → "mineral water"
    return bool(core) and core in r


# --------------------------- public API ---------------------------


def _base_meta(**kw: Any) -> Dict[str, Any]:
    meta = {
        "model": OPENAI_CHAT_MODEL,
        "language": "en",
        "intent": "chitchat",
        "topic": "other",
        "items": [],
        "suggestions": [],
        "upsell": [],
        "decision": {"showSuggestionsModal": False, "showUpsellTray": False},
        "cartOps": [],
        "clearCart": False,
        "fallback": False,
    }
    meta.update({k: v for k, v in kw.items() if v is not None})
    return meta


def _items_payload(index: MenuIndex, qty: Dict[str, int]) -> List[Dict[str, Any]]:
    return [
        {"itemId": iid, "name": (index.by_id.get(iid) or {}).get("name") or iid, "quantity": q, "price": (index.by_id.get(iid) or {}).get("price")}
        for iid, q in qty.items()
    ]


def _suggestion_row(it: Dict[str, Any], subtitle: str = "") -> Dict[str, Any]:
    row = {"title": it.get("name"), "itemId": str(it.get("id") or it.get("_id")), "price": it.get("price")}
    if it.get("categoryId"):
        row["categoryId"] = it.get("categoryId")
    if subtitle:
        row["subtitle"] = subtitle
    return row


_PRICE_OR_STOCK = re.compile(
    r"how much|price|cost|\bdo you have\b|\bhave you got\b|available|in stock|দাম|কত|আছে|koto|dam\b|ache\b|ase\b", re.I
)


def _fallback_reply(
    transcript: str,
    lang: str,
    index: MenuIndex,
    orderable: Dict[str, bool],
    picks: Optional[List[Pick]] = None,
    ctx: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """No model available. Still useful, never misleading, never touches the cart:
    recommendations come from the (model-free) engine; prices only when the guest asked about price/stock."""
    from recommender import asks_for_recommendation  # local: keeps the import list short

    if picks is not None and asks_for_recommendation(transcript):
        text = _reco_fallback([p.item for p in picks], lang, ctx or {})
        rows = [_suggestion_row(p.item, ", ".join(p.reasons[:1])) for p in picks[:3]]
        return text, {
            "intent": "suggestions" if rows else "menu", "topic": "recommendation", "suggestions": rows,
            "decision": {"showSuggestionsModal": bool(rows), "showUpsellTray": False},
        }
    # "do you have desserts / pizza?" — answerable from the menu alone
    have = [(k, [i for i in items if orderable.get(index.item_id(i), True)]) for k, items in kind_items(transcript, index)]
    miss = missing_kinds(transcript, index)
    if have or miss:
        bn = lang == "bn"
        parts = []
        for kind, items in have:
            listed = ", ".join(f"{i.get('name')} ({_money(i.get('price'))})" for i in items[:4])
            if listed:
                parts.append(f"{kind}: {listed}।" if bn else f"Yes — for {kind} we have {listed}.")
        for kind in miss:
            parts.append(f"দুঃখিত, আমাদের মেনুতে {kind} নেই।" if bn else f"Sorry, we don't have {kind}.")
        if parts:
            return " ".join(parts), {"intent": "menu", "topic": "availability"}
    hits = find_mentions(transcript, index, limit=3)
    if hits and _PRICE_OR_STOCK.search(transcript):
        it = hits[0]
        name, price = it.get("name"), _money(it.get("price"))
        if not orderable.get(index.item_id(it), True):
            reason = it.get("unavailableReason") or ""
            text = reason or (f"দুঃখিত, {name} এখন পাওয়া যাচ্ছে না।" if lang == "bn" else f"Sorry, {name} isn't available right now.")
        else:
            text = f"{name} আছে, দাম {price}।" if lang == "bn" else f"Yes, we have {name} — it's {price}."
        return text, {"intent": "menu", "topic": "availability", "mentionedItems": [{"itemId": index.item_id(i), "name": i.get("name")} for i in hits]}
    text = "দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?" if lang == "bn" else "Sorry, I'm having a little trouble. Could you say that again?"
    return text, {"intent": "chitchat", "topic": "other"}


# words that may sit around a clean order without changing it ("আমাকে দুইটা ক্রিস্পি রাইস স্যুপ দিন প্লিজ")
_ORDER_FILLER = {
    "দিন", "দেন", "দাও", "দিবেন", "দেবেন", "দিয়েন", "দিয়ে", "দিয়েন", "দেবো", "দিবো", "লাগবে", "চাই", "নেব", "নিব", "নেবো",
    "নিবো", "আমাকে", "আমার", "আমাদের", "আমাদেরকে", "জন্য", "একটু", "প্লিজ", "ভাই", "আপা", "স্যার", "অর্ডার", "করুন", "করেন",
    "করে", "করো", "যোগ", "please", "add", "give", "me", "i'll", "ill", "have", "want", "get", "can", "i", "the", "a",
    "an", "of", "would", "like", "we'd", "i'd", "we", "us", "order", "take", "and", "with", "just", "also", "সাথে",
    "হবে", "করবো", "করব", "দেওয়া", "দেয়া", "যাবে",
}
# anything that changes an order beyond "these dishes, this many" → the model (with its checks)
_NOT_CLEAN = re.compile(
    r"ঝাল|কম(?![ঀ-৿])|বেশি|ছাড়া|ছাড়া|বাদ|(?<![ঀ-৿])না(?![ঀ-৿])|নোট|বদলে|হাফ|ফুল|ছোট|বড়|আরেক|আরও|আরো|সব|প্রতি|করে দুই|"
    r"\b(no|not|without|less|extra|instead|remove|cancel|half|full|small|large|more|another|each|every|spicy|mild|note)\b|\?",
    re.I,
)


def _clean_order(transcript: str, index: MenuIndex, orderable: Dict[str, bool], cart_qty: Dict[str, int]) -> List[Dict[str, Any]]:
    """"দুইটা ক্রিস্পি রাইস স্যুপ আর একটা ফ্রেঞ্চ ফ্রাই দিন" → [add 2 × Crispy Rice Soup, add 1 × French Fry] — when
    it is that simple: an order word, every dish named in full (not already in the tray), a quantity per dish, and no
    other word that could change it. Anything else → [] (the model reads it). A dish with a size / choice to pick goes
    in without one — it's held and asked about (the clear dishes are added and said first), never left to the model,
    which used to just ask and add nothing at all."""
    t = (transcript or "").strip()
    if not t or not _orders_now(t) or _NOT_CLEAN.search(t):
        return []
    rev = _menu_rev(index)
    ops: List[Dict[str, Any]] = []
    for seg in [s.strip() for s in re.split(r"\s*(?:,|।|\s(?:আর|এবং)\s)\s*", t) if s.strip()]:
        dishes = _dishes_named(seg, index, limit=2)
        if len(dishes) != 1:
            return []
        it = dishes[0]
        iid = index.item_id(it)
        if not orderable.get(iid, True) or cart_qty.get(iid) or _ambiguous_pick(it, index, orderable, seg):
            return []
        mine = _name_tokens(it.get("name"))
        for w in re.findall(r"[A-Za-z']+|[ঀ-৿]+|\d+", seg.translate(_BN_DIGITS)):
            lw = w.lower()
            if lw in _ORDER_FILLER or _said_quantity(w) is not None or lw.isdigit():
                continue
            if _guest_tokens(w, rev) and _guest_tokens(w, rev) <= mine:
                continue  # a word of the dish's name
            return []  # a word we can't place ("ভাইস", "ঝোল"…) — let the model read the whole sentence
        ops.append({"op": "add", "item": index.ref(it), "quantity": _said_quantity(seg) or 1})
    if len({o["item"] for o in ops}) != len(ops):
        return []  # the same dish twice → the model
    return ops


# small talk the waiter answers itself (like a friendly person, never "I'm virtual, I don't eat" for "how are you")
_HOW_ARE_YOU = re.compile(
    r"কেমন আছ(েন|ো|িস|ে)?|কেমন চলছে|(কি|কী) খবর|কি অবস্থা|\bhow (are|r) (you|u)\b|\bhow'?s it going\b|"
    r"\bwhat'?s up\b|\bkemon (acho|achen|asen)\b|\bki khobor\b",
    re.I,
)
_SALAM = re.compile(r"আস[্]?সালাম[ুু]?|সালাম|\bas+alam|\bsalam\b|\bassalamu\b", re.I)
_HELLO = re.compile(r"হ্যালো|হেলো|(?<![ঀ-৿])হাই(?![ঀ-৿])|\b(hello|hi|hey)\b", re.I)
_SMALL_FILLER = re.compile(
    r"আলাইকুম|আলায়কুম|ভাই|আপা|স্যার|আপনি|তুমি|আপনার|তোমার|আজ|আজকে|\b(alaikum|bhai|there|you|today|guys|brother|sir)\b|"
    r"[?!.,।\s]+",
    re.I,
)


# "I don't want anything" — the "না" can come LAST in Bangla ("আজকে কিছু খেতে চাই না"), so "খেতে চাই" alone
# must never read as a request for dishes
_NOT_WANT = re.compile(
    # NOTHING at all — "কিছু (খেতে) চাই না", "কিছু লাগবে না", "খেতে চাই না", "খিদে নেই" (not "ঝাল কম লাগবে না",
    # which is about a note, and not a plain "no thanks" to an offer — the model handles those)
    r"কিছু(ই)?\s*(খেতে\s*|খাওয়ার\s*|নিতে\s*)?(চাই|চাচ্ছি|লাগবে|খাব|খাবো|নেব|নেবো|নিব|নিবো|দরকার)\s*না(?![ঀ-৿])|"
    r"খেতে\s*(চাই|চাচ্ছি|ইচ্ছে\s*করছে|ইচ্ছা\s*করছে)\s*না(?![ঀ-৿])|(খিদে|ক্ষুধা|ক্ষিদে)\s*নেই|পেট\s*ভরা|"
    r"\bnot hungry\b|\b(don'?t|do not|dont) want (anything|to eat)\b|\bnothing (for me|today|right now|now)\b",
    re.I,
)
# …but "that's all" with a tray is the end of the order (the checkout reads it back) — not "nothing today"
_THATS_ALL = re.compile(r"আর\s*কিছু|আর\s*লাগবে|এটুকুই|এতটুকুই|এই\s*হবে|\b(anything else|that'?s all|that'?s it)\b", re.I)


def _not_wanting(transcript: str, index: MenuIndex, has_tray: bool) -> bool:
    """"আমি আজকে কিছু খেতে চাই না" / "খিদে নেই" / "no thanks" — nothing wanted right now (no dish named, no tray
    to finish)."""
    t = transcript or ""
    if not _NOT_WANT.search(t):
        return False
    if has_tray:
        return False  # "(আর) কিছু লাগবে না" with food in the tray = that's all → the order read-back
    return not (_dishes_named(t, index) or find_mentions(t, index, limit=1) or _named_kind_ids(t, index))


def _small_talk(transcript: str, lang: str) -> Optional[str]:
    """"কি খবর, কেমন আছো?" / "আসসালামু আলাইকুম" / "হ্যালো" said on its own → the waiter's friendly answer. None when
    anything else is in the sentence ("হ্যালো, একটা স্যুপ দেন" → the model)."""
    t = transcript or ""
    how, salam, hello = bool(_HOW_ARE_YOU.search(t)), bool(_SALAM.search(t)), bool(_HELLO.search(t))
    if not (how or salam or hello):
        return None
    rest = _SMALL_FILLER.sub(" ", _HELLO.sub(" ", _SALAM.sub(" ", _HOW_ARE_YOU.sub(" ", t)))).strip()
    if len(rest.split()) > 1:
        return None  # more than a greeting — the model answers all of it
    bn = lang == "bn"
    lead = ("ওয়ালাইকুম আসসালাম! " if bn else "Wa alaikum assalam! ") if salam else ""
    if how:
        return lead + ("ভালো আছি, ধন্যবাদ! আপনি কেমন আছেন? কী খেতে চান, বলুন।" if bn
                       else "I'm good, thanks! How are you? What would you like to eat?")
    if salam:
        return lead + ("কী খেতে চান, বলুন।" if bn else "What would you like to eat?")
    return "হ্যালো! কী খেতে চান, বলুন।" if bn else "Hello! What would you like to eat?"


# sizes as guests say them → the size word on the menu
_SIZE_WORDS: List[Tuple[str, str]] = [
    ("large", r"বড়টা|বড়োটা|বড়|বড়ো|লার্জ|\blarge\b|\bbig(ger)?\b"),
    ("small", r"ছোটটা|ছোটোটা|ছোট|ছোটো|স্মল|\bsmall(er)?\b"),
    ("full", r"ফুলটা|ফুল|\bfull\b"),
    ("half", r"হাফটা|হাফ|\bhalf\b"),
    ("medium", r"মিডিয়াম|মাঝারি|\bmedium\b"),
    ("regular", r"রেগুলার|নরমাল|\bregular\b|\bnormal\b"),
]
_SIZE_OF_NAME = re.compile(r"\b(small|large|full|half|medium|regular|big)\b", re.I)
_NEGATED_AFTER = re.compile(r"^\s*(টা|টি)?\s*(না|নয়|নয়)(?![ঀ-৿])")
_MAKE_IT = re.compile(r"করে\s*(দিন|দাও|দেন|দিবেন|দেবেন)|\bmake (it|that)\b|\binstead\b|\bchange\b", re.I)
_SWAP_NOT = re.compile(r"কমান|কমাও|কমিয়ে|বাদ\s*(দিন|দাও|দেন)|সরিয়ে|\b(remove|less|fewer|cancel)\b", re.I)


def _size_swap(transcript: str, index: MenuIndex, orderable: Dict[str, bool],
               rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"স্মল না, বড়টা দাও" / "মিনারেল ওয়াটার ছোটটা না দিয়ে বড়টা দাও" → the tray's small line becomes the large one
    (a sibling dish "Mineral Water (large)", or the dish's own size option "Full"), same quantity. [] when it isn't
    exactly one clear line — then the model asks. (It once said "বড় সাইজে বদলে দিলাম" and changed nothing.)"""
    t = transcript or ""
    if not rows or _SWAP_NOT.search(t):
        return []  # "হাফ কাচ্চি একটা কমান" — fewer / removed, not a size change
    # the size they WANT: the last size word that isn't negated ("স্মল না, বড়টা" → large)
    said: List[Tuple[int, str]] = []
    rejected = False
    for size, pat in _SIZE_WORDS:
        for m in re.finditer(pat, t, re.I):
            if _NEGATED_AFTER.search(t[m.end():]) or re.match(r"\s*না\s*দিয়ে", t[m.end():]):
                rejected = True
            else:
                said.append((m.start(), size))
    # a change has to be asked for: one size turned down ("স্মল না…") or a change phrase ("…করে দিন", "বদলে")
    if not said or not (rejected or _SWAP_CUE.search(t) or _MAKE_IT.search(t)):
        return []
    want = max(said)[1]
    # a dish named in the sentence narrows it to that dish ("মিনারেল ওয়াটার ছোটটা না…"); size words don't count
    named_dish = _guest_tokens(t, _menu_rev(index)) - {"small", "large", "full", "half", "medium", "regular", "big"}
    cands: List[List[Dict[str, Any]]] = []
    for r in rows:
        it = index.by_id.get(str(r.get("itemId"))) or {}
        name = str(it.get("name") or "")
        base_toks = _name_tokens(_SIZE_OF_NAME.sub(" ", re.sub(r"[()]", " ", name)))
        if named_dish and not (named_dish & base_toks):
            continue
        # 1) the dish's own size options (Half / Full)
        vars_ = [v for v in it.get("variations") or [] if v.get("name")]
        hit = next((v for v in vars_ if re.search(rf"\b{want}\b", str(v["name"]), re.I)), None)
        if hit and str(r.get("variation") or "").lower() != str(hit["name"]).lower():
            cands.append([{"op": "edit", "item": index.ref(it), "line": r.get("line"), "variant": str(hit["name"])}])
            continue
        # 2) a sibling dish that differs only by its size word ("Mineral Water (small)" → "(large)")
        m = _SIZE_OF_NAME.search(name)
        if not m or m.group(1).lower() == want:
            continue
        target = re.sub(rf"\b{m.group(1)}\b", want, name, flags=re.I)
        sib = next((o for o in index.items if str(o.get("name") or "").lower() == target.lower()), None)
        if sib and orderable.get(index.item_id(sib), True):
            q = int(r.get("quantity") or 1)
            cands.append([{"op": "remove", "item": index.ref(it), "line": r.get("line")},
                          {"op": "add", "item": index.ref(sib), "quantity": q}])
    return cands[0] if len(cands) == 1 else []


# a follow-up about what we just said: "আর কী আছে?", "অন্য কিছু?", "what else?", "ঝাল ছাড়া…"
_FOLLOW_UP = re.compile(r"\b(else|other|another|instead)\b|আর (কী|কি)|অন্য|আরো|আরও|বাদে|ছাড়া|ছাড়া|বদলে", re.I)

# the guest is ASKING for something (not stating an order): "ঝাল কিছু আছে?", "বাচ্চাদের জন্য কী ভালো?"
_ASKING = re.compile(
    r"(কি|কী|কোনটা|কোনগুলো|কিছু|আছে|আছেন|পাওয়া|খাওয়া যায়|হবে|বলেন|বলুন|সাজেস্ট|রেকমেন্ড|ভালো)|\?|"
    r"\b(what|which|any|some|something|suggest|recommend|good|best|have|got)\b",
    re.I,
)


# the reading's kind word → how the waiter says it (when the guest's own word wasn't one we recognise)
_KIND_SAY = {k: {"bn": bn, "en": k} for k, bn in {
    "drinks": "ড্রিংকস", "drink": "ড্রিংকস", "dessert": "ডেজার্ট", "desserts": "ডেজার্ট", "soup": "স্যুপ", "soups": "স্যুপ",
    "rice": "রাইস", "fried rice": "ফ্রাইড রাইস", "noodles": "নুডলস", "chowmein": "চাওমিন", "sizzling": "সিজলিং",
    "salad": "সালাদ", "appetizer": "অ্যাপেটাইজার", "appetizers": "অ্যাপেটাইজার", "starters": "স্টার্টার", "chicken": "চিকেন",
    "beef": "বিফ", "prawn": "প্রন", "fish": "ফিশ", "vegetable": "ভেজিটেবল", "set menu": "সেট মেনু", "burger": "বার্গার",
    "pizza": "পিজ্জা", "biryani": "বিরিয়ানি", "kebab": "কাবাব", "coffee": "কফি", "juice": "জুস",
}.items()}


def _fixed_reco(
    transcript: str, *, index: MenuIndex, orderable: Dict[str, bool], kinds: List[str], profile: GuestProfile,
    stats: OrderStats, rstate: RecoState, kind_scope: set, lang: str, stage: str, mode: str, about_shown: bool,
    cart_ids: List[str], in_tray: Optional[set] = None, understood: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[str, List[Dict[str, Any]], str]]:
    """(reply, cards, note) in the waiter's fixed recommendation shape — or None when the turn needs the model.
    With a reading of the guest (`understood`): only when they want a recommendation, and its kind / taste /
    audience / count fill in what the word patterns missed ("ঝাল খাবারের মধ্যে কি আছে?" → the spicy shape)."""
    t = transcript or ""
    u = understood
    if stage != "none" or mode in ("quiet", "complement", "last_call") or about_shown:
        return None
    if u is not None and u.get("intent") != "recommend":
        return None
    if _ASKED_FOR_ONE.search(t) or _dishes_named(t, index) or missing_kinds(t, index):
        return None
    if u is None and (_orders_now(t) or _ABOUT_MINE.search(t) or not _ASKING.search(t)):
        return None
    if u is not None:
        # what the word patterns didn't catch, from the reading
        if not kind_scope and u.get("kind"):
            kind_scope = {i for i in _kind_ids_in(u["kind"], index) if orderable.get(i, True)}
        taste_u = next(((k, bn, en) for k, _p, bn, en in reco_format.TASTES if k == u.get("taste")), None)
        aud_u = next(((bn, en, sh) for _p, bn, en, sh in reco_format.AUDIENCES
                      if u.get("audience") and en == u["audience"]), None)
    else:
        taste_u = aud_u = None
    if _FOLLOW_UP.search(t):
        return None  # "আর কী আছে?" / "what else?" — other than what we just said → the model, with the conversation
    if _NOT_WANT.search(t):
        return None  # "…খেতে চাই না" — never answered with a list of dishes
    said = extract_prefs(t)
    # ("ঠান্ডা কিছু" is a mood to the patterns, but when the reading says it means drinks, it's just the kind)
    moods = set(said.mood) - {"sharing"} - ({"cold", "refreshing"} if (u or {}).get("kind") else set())
    if (said.avoid or said.party_size or said.budget or said.max_price or said.spice == "mild" or moods):
        return None  # a budget, a head-count, "less spicy", "something light"… → the model plans it
    if profile.allergies or profile.diet or profile.vegetarians_in_party or said.allergies or said.diet:
        return None  # an allergy / diet at this table: the model adds the "staff will confirm" safety note
    aud = reco_format.audience_asked(t) or aud_u
    taste = reco_format.taste_asked(t) or taste_u
    if aud:
        if taste or kind_scope:
            return None  # "বাচ্চাদের জন্য মিষ্টি কিছু" — two asks at once → the model
        shape = "audience"
    elif taste:
        if kind_scope:
            return None  # "ঝাল স্যুপ" → the model
        shape = "taste"
    elif kind_scope:
        shape = "kind"
    elif _WANTS_A_PICK.search(t) or asks_for_recommendation(t) or u is not None:
        shape = "general"
    else:
        return None

    prof = profile
    if aud and aud[2] and "sharing" not in profile.mood:  # a family / friends table: dishes made for sharing first
        prof = GuestProfile.from_dict({**profile.to_dict(), "mood": list(profile.mood) + ["sharing"]})
    ranked, _ = rank(index, orderable, kinds, prof, stats=stats, context_ids=cart_ids, recent=rstate.recent,
                     asked_for=set(kind_scope), limit=60, only=kind_scope or None, exclude=set(in_tray or ()))
    items = [p for p in ranked if orderable.get(index.item_id(p.item), True)]
    if shape != "kind" and not (taste and taste[0] in ("sweet", "sour")):
        items = [p for p in items if not dish_facts(p.item)["drink"]]  # nobody recommends water as "something good"
    if taste:
        items = [p for p in items if reco_format.has_taste(taste[0], p.item, dish_facts(p.item), is_signature)]
    seen_names: set = set()  # "Mineral Water (small)" and "(large)" are one thing to say
    items = [p for p in items if not (lambda k: k in seen_names or seen_names.add(k))(
        re.sub(r"\s*\(.*?\)", "", str(p.item.get("name") or "")).strip().lower())]
    star = [p for p in items if is_signature(p.item)]  # (already only the ones that suit the time of day)
    rest = [p for p in items if not is_signature(p.item)]
    label, when = "", ""
    if shape == "taste" and taste[0] == "special":
        if not star:
            return None  # no special suits right now → the model says so and offers what does
        top, more = star[:3], (star[3:] + rest)[:2]
        label = taste[1] if lang == "bn" else taste[2]
    elif shape == "general":
        if star:
            top, more = star[:3], rest[:2]
            label = "স্পেশাল" if lang == "bn" else "special"
        else:
            top, more = reco_format.split(rest)
            when = (kinds or [""])[0]
    else:
        top, more = reco_format.split(star + rest)
        if shape == "taste":
            label = taste[1] if lang == "bn" else taste[2]
        elif shape == "kind":
            # the reading's word for the kind when it has one ("ঠান্ডা কী আছে" → "ড্রিংকস"), else the guest's own word
            label = _KIND_SAY.get(str((u or {}).get("kind") or ""), {}).get(lang, "") or _kind_word(t, index, kind_scope)
            if not label:
                return None
    if not top:
        return None
    # "টপ থ্রি আইটেম দেখাও" → exactly that many (same order: star-marked first, fitting the time)
    n = _asked_count(t) or int((u or {}).get("count") or 0)
    if n:
        both = (top + more)[:n]
        top, more = both[:3], both[3:]

    def said_name(p: Pick) -> str:
        return re.sub(r"\s*\(.*?\)", "", str(p.item.get("name") or "")).strip()

    top_n, more_n = [said_name(p) for p in top], [said_name(p) for p in more]
    if shape == "kind" and any(is_packaged(p.item) for p in top + more):
        # drinks with water / Coke among them: a plain list (made here first) — "খুবই ভালো" about a bottle is wrong
        both = sorted(top + more, key=lambda p: is_packaged(p.item))[:5]
        names = [said_name(p) for p in both]
        bn = lang == "bn"
        joined = (", ".join(names[:-1]) + (" অথবা " if bn else " or ") + names[-1]) if len(names) > 1 else names[0]
        text = (f"{upsell_engine.of_bn(label)} মধ্যে আছে {joined} — কোনটা দেব?" if bn
                else f"For {label} we have {joined} — which one would you like?")
        return text, [_suggestion_row(p.item) for p in both], "reco_kind_list"
    if shape == "audience":
        text = reco_format.audience_text(aud[0] if lang == "bn" else aud[1], top_n, more_n, lang)
    else:
        # "খুবই জনপ্রিয়" only with real evidence (ordered a lot here, or tagged popular) — same rule as the model's
        popular = any("a guest favourite" in p.reasons or any(
            str(tag).lower() in ("popular", "bestseller", "best seller") for tag in p.item.get("tags") or []) for p in top)
        text = reco_format.kind_text(label, top_n, more_n, lang, when=when, popular=popular)
    rows = [_suggestion_row(p.item, ", ".join(p.reasons[:1])) for p in top + more]
    return text, rows, f"reco_{shape}"


def _pick_options(held: List[Dict[str, Any]], index: MenuIndex) -> List[Dict[str, Any]]:
    """The dishes waiting for a size / choice, as the tray's picker: what's chosen so far, what's still missing,
    and every size and option group (the guest taps or says them — both land in the same held order)."""
    out: List[Dict[str, Any]] = []
    for e in held:
        it = index.by_id.get(str(e.get("itemId")))
        if not it:
            continue
        missing = _fill_options(dict(e), it, "")
        out.append({
            "itemId": str(e["itemId"]), "name": str(e.get("name") or it.get("name")), "quantity": int(e.get("quantity") or 1),
            "variant": e.get("variant") or "", "choices": list(e.get("choices") or []), "missing": missing,
            "sizes": [{"name": str(v["name"]), "price": v.get("price")} for v in it.get("variations") or [] if v.get("name")],
            "groups": [{"name": str(g.get("name") or ""), "min": int(g.get("min") or 0), "max": int(g.get("max") or 0),
                        "options": [{"name": str(o["name"]), "price": float(o.get("price") or 0)}
                                    for o in g.get("options") or [] if o.get("name")]}
                       for g in it.get("modifierGroups") or []],
        })
    return out


async def generate_reply(transcript: str, **kw: Any) -> Dict[str, Any]:
    """_reply, plus what every reply carries whichever path answered:
    · the picker for a dish still waiting for its size / choice (meta.decision.pickOptions, with the size-up hints —
      chooseOptions stays for screens without the tray picker)
    · H: what became of last turn's offer (meta.upsellOutcome: accepted / declined / ignored) and the tray's total
      after this turn (meta.traySubtotal) — the server keeps both for the upsell stats."""
    out = await _reply(transcript, **kw)
    meta = out.get("meta") or {}
    index = MenuIndex((kw.get("menu_snapshot") or {}).get("items") or [])
    pending = (meta.get("tray") or {}).get("pending") if isinstance(meta.get("tray"), dict) else None
    if isinstance(pending, dict) and pending.get("kind") == "options":
        picker = _pick_options(pending.get("items") or [], index)
        if picker:
            meta["intent"] = "order"  # the order is being taken (the tray opens with the picker)
            for p in picker:
                p["sizeHints"] = offers.size_hints(p["sizes"], str(meta.get("language") or kw.get("locale") or "bn"))
            decision = meta.setdefault("decision", {})
            decision["pickOptions"] = picker

    meta["upsellArm"] = offers.arm_for(kw.get("tenant"), kw.get("conversation_id"))
    ops = [o for o in meta.get("cartOps") or [] if isinstance(o, dict)]
    prev = (((kw.get("dialog_state") or {}).get("tray") or {}).get("pending") or {})
    now_pending = (meta.get("tray") or {}).get("pending") if isinstance(meta.get("tray"), dict) else None
    still_open = (isinstance(now_pending, dict) and now_pending.get("kind") == "offer"
                  and (now_pending.get("offer") or {}).get("id") == ((prev or {}).get("offer") or {}).get("id"))
    if isinstance(prev, dict) and prev.get("kind") == "offer" and isinstance(prev.get("offer"), dict) and not still_open:
        po = prev["offer"]
        guards = meta.get("guards") or []
        ids = {str(i) for i in po.get("item_ids") or []}
        took = "offer_accepted" in guards or (po.get("type") in ("side", "drink", "dessert") and any(
            o.get("op") == "add" and str(o.get("itemId")) in ids for o in ops))  # said it by name instead of "yes"
        value = float(po.get("value") or 0)
        if took and "offer_accepted" in guards and po.get("type") in ("side", "drink", "dessert"):
            value = sum(float(o.get("price") or (index.by_id.get(str(o.get("itemId"))) or {}).get("price") or 0)
                        * int(o.get("quantity") or 1) for o in ops if o.get("op") == "add") or value
        meta["upsellOutcome"] = {
            "offerId": po.get("id"), "type": po.get("type"), "moment": po.get("moment"), "arm": po.get("arm") or {},
            "outcome": "accepted" if took else ("declined" if "offer_declined" in guards or (meta.get("decision") or {}).get(
                "showCheckout") or (meta.get("checkout") or {}).get("stage") in ("readback", "table") else "ignored"),
            "value": value if took else 0.0,
        }
    try:
        rows, _sub = cart_lines(index, ((kw.get("context") or {}).get("cartItems")) or [])
        _tray.with_refs(rows)
        after = _tray.simulate(rows, ops, bool(meta.get("clearCart")), index.by_id)
        meta["traySubtotal"] = round(sum(float(r.get("price") or 0) * int(r.get("quantity") or 0) for r in after), 2)
    except Exception as e:  # stats only — never break a reply
        print("[brain] tray subtotal for stats failed:", repr(e))
    return out


async def _reply(
    transcript: str,
    *,
    tenant: Optional[str] = None,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    locale: Optional[str] = None,
    menu_snapshot: Optional[Dict[str, Any]] = None,
    conversation_id: Optional[str] = None,
    user_id: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
    dialog_state: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
    suggestion_candidates: Optional[List[Dict[str, Any]]] = None,
    upsell_candidates: Optional[List[Dict[str, Any]]] = None,
    restaurant: Optional[Dict[str, Any]] = None,
    lock_language: bool = False,
) -> Dict[str, Any]:
    """`lock_language`: reply in `locale` (the restaurant's / guest's chosen language) whatever the guest spoke;
    otherwise mirror the guest's language, with `locale` only breaking ties."""
    transcript = (transcript or "").strip()[:1000]
    # "বললাম যে না থাক" / "I said no" — the guest repeating or correcting themselves: the words after it are the
    # answer (to whatever the waiter is still waiting for)
    heard_raw = transcript
    transcript = _strip_repeat_lead(transcript)
    ctx = dict(context or {})
    restaurant = restaurant or ctx.get("restaurant")
    lang = locale if lock_language and locale in ("bn", "en") else reply_language(transcript, locale)
    ids = {"tenant": tenant, "branch": branch, "channel": channel, "conversationId": conversation_id, "userId": user_id}
    # online guests (pickup / delivery) finish on the checkout form — no table, no placing by voice
    online = str(channel or ctx.get("channel") or "").strip().lower() == "online"

    index = MenuIndex((menu_snapshot or {}).get("items") or [])
    orderable = {index.item_id(it): it.get("available") is not False for it in index.items}
    if OPENAI_API_KEY and MENU_PROFILE_AI:
        menu_profile.warm(index.items, _read_menu)  # once per menu, in the background: "what do you have?"
    cart_rows, subtotal = cart_lines(index, ctx.get("cartItems") or [])
    _tray.with_refs(cart_rows)  # L1, L2 … + the storefront's line keys
    cart_qty: Dict[str, int] = {}
    for r in cart_rows:  # the same dish can be several lines (Half + Full) — count them all
        cart_qty[r["itemId"]] = cart_qty.get(r["itemId"], 0) + r["quantity"]
    # tray memory: the last change (for undo / "one more of that"), a question waiting for a yes, warnings given
    tstate: Dict[str, Any] = dict((dialog_state or {}).get("tray") or {})
    last_change = tstate.get("last_change") if isinstance(tstate.get("last_change"), dict) else None
    pending = tstate.get("pending") if isinstance(tstate.get("pending"), dict) else None
    tstate["pending"] = None  # a pending question only lives for the next turn
    # real unit prices / size labels of the cart lines (a Half and a Full cost different amounts)
    unit_price: Dict[str, float] = {r["itemId"]: float(r["price"] or 0) for r in cart_rows}
    size_label: Dict[str, str] = {r["itemId"]: r["variation"] for r in cart_rows if r.get("variation")}
    asked_confirm = last_assistant_asked_to_confirm(history)
    # what the guest has said recently (sizes/choices said a turn ago still count: "হাফ" … "yes, order it")
    guest_words = " ".join(
        [str(m.get("content") or "") for m in (history or [])[-6:] if m.get("role") == "user"] + [transcript or ""]
    )
    # which DISH: this sentence — plus the guest's previous one only when our last reply asked "which one?" (named
    # two or more dishes: "সিজলিং" → "চিকেন, বিফ না প্রন?" → "চিকেনটা")
    _last_asst = next((str(m.get("content") or "") for m in reversed(history or []) if m.get("role") == "assistant"), "")
    _prev_user = next((str(m.get("content") or "") for m in reversed(history or []) if m.get("role") == "user"), "")
    pick_words = transcript or ""
    if _prev_user and _last_asst.rstrip().endswith("?") and len(find_mentions(_last_asst, index, limit=3)) >= 2:
        pick_words = _prev_user + " " + pick_words

    if not transcript:
        text = "দুঃখিত, শুনতে পাইনি। আবার বলবেন কি?" if lang == "bn" else "Sorry, I didn't catch that. Could you say it again?"
        return {"replyText": text, "meta": _base_meta(language=lang, fallback=True, **ids)}

    # ---------------- checkout: where are we (none → table → readback), which table, what was read back
    ck: Dict[str, Any] = dict((dialog_state or {}).get("checkout") or {})
    stage = ck.get("stage") if ck.get("stage") in co.STAGES else "none"
    table = co.table_from_text(transcript, expecting=stage == "table") or str(ctx.get("table") or ck.get("table") or "").strip() or None
    sig_now = co.cart_signature(cart_rows)

    # ---- UNDERSTAND FIRST: what does the guest mean? (one focused model call; None → the word patterns below decide).
    # Not while we wait for the answer to our own yes/no question (checkout, "sure?") — those are read exactly.
    last_waiter = next((m.get("content") or "" for m in reversed(history or []) if m.get("role") == "assistant"), "")
    understood = (await _understand(transcript, index, last_waiter, cart_rows)
                  if stage == "none" and not pending else None)
    u_intent = (understood or {}).get("intent")

    def means(*intents: str) -> bool:
        """The reading says one of these (no reading → True: the word pattern alone decides, as before)."""
        return understood is None or u_intent in intents

    recent: List[Dict[str, Any]] = []
    for ref in (dialog_state or {}).get("focus") or []:
        it = index.resolve(ref.get("id") if isinstance(ref, dict) else ref, ref.get("name") if isinstance(ref, dict) else None)
        if it and it not in recent:
            recent.append(it)
    # ---------------- recommendation engine: who is this guest, and should we suggest anything now?
    kinds = ctx.get("mealKinds") or [
        {"breakfast": "breakfast", "lunch": "lunch", "evening": "dinner", "late": "late"}.get(str(ctx.get("timeOfDay")), "lunch")
    ]
    rstate = RecoState.from_dict((dialog_state or {}).get("reco"))
    profile = GuestProfile.from_dict(rstate.profile).merge(extract_prefs(transcript))
    if rstate.last_offered and is_decline(transcript) and rstate.turn - rstate.last_offer_turn <= 1:
        profile.declined = list(dict.fromkeys(profile.declined + rstate.last_offered))
        rstate.declined_turn = rstate.turn
    # "something cheaper" → a real ceiling: below the cheapest dish we just suggested
    if _CHEAPER.search(transcript) and rstate.last_offered and rstate.turn - rstate.last_offer_turn <= 1:
        prev = [float(index.by_id[i].get("price") or 0) for i in rstate.last_offered if i in index.by_id]
        prev = [p for p in prev if p > 0]
        if prev:
            profile.max_price = int(min(prev)) - 1
    stats = OrderStats(**(ctx.get("orderStats") or {})) if isinstance(ctx.get("orderStats"), dict) else OrderStats()
    mentioned_now = [index.item_id(it) for it in find_mentions(transcript, index, limit=6)]
    asked_ids = {index.item_id(it) for it in index.items if explicitly_asked(it, transcript)}
    # "স্যুপের মধ্যে কী ভালো?" → the picks are soups only (not one soup + two dinner dishes)
    kind_scope = _named_kind_ids(transcript, index)
    if kind_scope and not any(orderable.get(i, True) for i in kind_scope):
        kind_scope = set()  # none of them can be ordered now → the usual picks, the waiter says so
    # already in the tray → never recommended back to them (they chose it) — unless they name it now
    in_tray = {i for i in cart_qty if cart_qty[i] > 0} - asked_ids
    asked_ids |= kind_scope
    picks, blocked = rank(
        index, orderable, kinds, profile, stats=stats, context_ids=list(cart_qty) + mentioned_now,
        recent=rstate.recent, asked_for=asked_ids, only=kind_scope or None, exclude=in_tray,
        limit=max(8, profile.party_size + 5),  # a table of 6 needs more distinct dishes to plan with
    )
    pool = [p.item for p in picks]
    drinks_exist = any(dish_facts(it)["drink"] for it in index.items if orderable.get(index.item_id(it), True))
    mode, mode_why = decide_mode(
        transcript,
        state=rstate,
        cart_ids=list(cart_qty),
        mentioned_ids=mentioned_now,
        has_drinks=False,  # (no "last call" pitch by the model: the offer engine handles the end — offers.py)
        has_signature=any(is_signature(p.item) for p in picks),
        cart_has_drink=any(dish_facts(index.by_id[i])["drink"] for i in cart_qty if i in index.by_id),
        done_ordering=is_done_ordering(transcript),
        confirming=stage != "none",
    )
    # the reading corrects a word pattern's mistake: "ঠান্ডা কী কী আছে?" (cold = drinks) is not a complaint about cold food
    if understood and mode == "quiet" and mode_why == "service request or complaint" and u_intent != "service":
        mode, mode_why = ("full" if u_intent == "recommend" else "answer"), "the reading: not a service request"
    elif u_intent == "recommend" and mode == "answer":
        mode, mode_why = "full", "the reading: wants a recommendation"
    # ---- the list on the guest's screen (suggestions pop-up / the tray's picks) — "which of these…" means THESE
    shown_ids = [str(x) for x in (ctx.get("shownItems") or []) if str(x) in index.by_id][:12]
    shown_on_screen = bool(shown_ids)
    if not shown_ids and rstate.last_offered and rstate.turn - rstate.last_offer_turn <= 2:
        shown_ids = [i for i in rstate.last_offered if i in index.by_id]  # no screen info: what we last suggested
    # "এগুলার মধ্যে কোনটা ভালো হবে?" right after the waiter recommended dishes = THOSE dishes (the guest just heard them),
    # even when the screen still shows an older list (the drinks from before, while the new picks sat in the tray)
    just_said = ([i for i in rstate.last_offered if i in index.by_id]
                 if rstate.last_offered and rstate.turn == rstate.last_offer_turn else [])
    if len(just_said) >= 2 and _REF_LIST.search(transcript) and set(just_said) != set(shown_ids):
        print(f"[brain] 'these' = what was just recommended {just_said}, not the screen's {shown_ids}")
        shown_ids, shown_on_screen = just_said[:12], False  # (→ they become the cards on screen, the pick first)
    shown = [index.by_id[i] for i in shown_ids]
    named_elsewhere = [it for it in find_mentions(transcript, index, limit=4) if index.item_id(it) not in shown_ids]
    about_shown = len(shown) >= 2 and bool(_REF_LIST.search(transcript)) and not named_elsewhere and stage == "none"
    if about_shown:
        mode, mode_why = "compare", "guest asks about the dishes on their screen"
    plan = build_plan(picks, profile, index, blocked) if mode == "full" else None
    pairings: List[Tuple[Dict[str, Any], str]] = []
    if mode == "last_call":
        pairings = complements(index, picks, list(cart_qty) + mentioned_now, stats, blocked=blocked)
        if mode == "last_call":
            pairings = [(it, why) for it, why in pairings if dish_facts(it)["drink"]][:1]
    just_suggested = (
        [index.by_id[i] for i in rstate.last_offered if i in index.by_id]
        if rstate.last_offered and rstate.turn - rstate.last_offer_turn <= 1
        else []
    )
    # a group question without a head-count: recommend anyway, then ask the one thing that sharpens it
    ask_next = ""
    if mode == "full" and not profile.party_size and _GROUPISH.search(transcript):
        ask_next = "আপনারা কয়জন খাবেন?" if lang == "bn" else "How many of you are eating?"
    print(f"[brain] reco mode={mode} ({mode_why}) profile=[{profile.summary()}] picks={[p.item.get('name') for p in picks[:4]]}")

    # ---------------- the tray: answered by rules, not guessed (no model call) ----------------
    bn = lang == "bn"

    def clash(it: Dict[str, Any]) -> List[str]:
        """Safety only: the guest's allergies and diet (not budget/spice preferences)."""
        return [v for v in violations(it, profile) if v.startswith("allergy") or v in _DIET_CLASH]

    def tray_done(text: str, t_ops: List[Dict[str, Any]], t_clear: bool, after: List[Dict[str, Any]],
                  note: str, topic_: str = "order_change") -> Dict[str, Any]:
        rec = _tray.change_record(cart_rows, after) if (t_ops or t_clear) else None
        if rec:
            tstate["last_change"] = rec
        fq: Dict[str, int] = {}
        for r in after:
            fq[r["itemId"]] = fq.get(r["itemId"], 0) + r["quantity"]
        m = _base_meta(
            language=lang, intent="order", topic=topic_, items=_items_payload(index, fq) if (t_ops or t_clear) else [],
            cartOps=t_ops, clearCart=t_clear, notes=note, **ids,
        )
        m["checkout"] = ck
        m["tray"] = tstate
        m["cartWarnings"] = _tray.warnings(after, index.by_id, orderable, clash)
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, [note]
        attach_offer(m)
        if bn:
            m["voiceReplyText"] = text
        print(f"[brain] tray: {note} → {text[:90]}")
        return {"replyText": text, "meta": m}

    # ---------------- THE offer (offers.py): the one place that decides whether the waiter offers anything extra,
    # what, and how it's said. The model never pitches (its pitches are cut from the reply — _strip_pitches).
    arm = offers.arm_for(tenant, conversation_id)
    offer_pending = pending if isinstance(pending, dict) and pending.get("kind") == "offer" else None
    made_offer: Dict[str, Any] = {}  # this turn's offer → meta.upsellOffer (the server keeps it for the stats)

    def offer_for(moment: str, rows_now: List[Dict[str, Any]], added: List[Dict[str, Any]]) -> Optional[offers.Offer]:
        """The one offer for this moment — never during checkout, never the turn after an offer, within the budget."""
        if stage != "none" or offer_pending or not offers.may_offer(rstate, moment, arm):
            return None
        return offers.plan(moment, offers.Ctx(
            index=index, orderable=orderable, rows=rows_now, added=added, picks=[p.item for p in picks], stats=stats,
            profile=profile, clash=clash, lang=lang, arm=arm, meal_kinds=kinds, done_types=rstate.gaps_offered))

    def hold_offer(o: offers.Offer) -> None:
        """Ask it: the guest's "হ্যাঁ" next turn applies its ops exactly (the offer answer below)."""
        tstate["pending"] = {"kind": "offer", "ops": o.ops, "clear": False, "offer": o.to_dict()}
        rstate.offers_made += 1
        rstate.gaps_offered = list(dict.fromkeys(list(rstate.gaps_offered) + [o.type]))
        rstate.last_upsell_turn = rstate.turn
        made_offer.clear()
        made_offer.update(o.to_dict())

    def attach_offer(m: Dict[str, Any]) -> None:
        """The offer rides on the reply: its id/arm for the stats, and the dish as a card in the tray (tap = yes)."""
        if not made_offer:
            return
        m["upsellOffer"] = {k: v for k, v in made_offer.items() if k != "card"}
        decision_ = m.setdefault("decision", {})
        if made_offer.get("card"):
            m["upsell"] = [made_offer["card"]]
            decision_["showUpsellTray"] = True
        if not decision_.get("chooseOptions"):  # F: a yes/no question — one tap answers it too
            decision_["chooseOptions"] = (
                [{"label": "হ্যাঁ, দিন", "say": "হ্যাঁ"}, {"label": "না, থাক", "say": "না"}] if bn
                else [{"label": "Yes, add it", "say": "yes"}, {"label": "No, thanks", "say": "no"}])

    said_number = _said_quantity(transcript)
    short_no = (len(transcript.split()) <= 3 and said_number is None
                and (co.wants_to_hold(transcript) or is_decline(transcript)))
    # (e1) "অর্ডারগুলো ক্যান্সেল করুন, কিছু লাগবে না" / "সব ফাঁকা করেন" / "start over" → ALWAYS asked first ("সবগুলো
    # বাদ দিয়ে দেব?", with the two answers as buttons); "হ্যাঁ" empties it (the "clear" question, below). Said again
    # while the question is waiting = yes.
    # (a dish named → it's about that dish: "অর্ডার থেকে কোকটা বাদ দিন" / "সব কোক বাদ দিন" never asks "delete everything?")
    if _CLEAR_ALL.search(transcript) and stage in ("none", "readback", "table", "details") and not _names_food(transcript, index):
        if not cart_rows:
            tstate["pending"] = None
            text = "আপনার ট্রে এখন খালিই আছে। নতুন করে কী দেব?" if bn else "Your tray is already empty. What would you like?"
            return tray_done(text, [], False, cart_rows, "clear_already_empty", "other")
        if pending and pending.get("kind") == "clear":
            ck = {**ck, "stage": "none"}
            return tray_done(_cleared_text(lang), [], True, [], "cleared_all")
        text, buttons = _ask_clear(cart_rows, lang, tstate)
        return _with_buttons(tray_done(text, [], False, cart_rows, "clear_asked", "order_change"), buttons)

    # (a00) the waiter is waiting for an answer (an offer, a size / spice, "delete everything?", "4 more or 4 in all?")
    # and this turn can't be read as one ("মাফাক", a cough, a stray word): the question stays OPEN — never dropped by a
    # misheard turn. A garble that sounds like "না থাক" is a no; anything else → the same question again, with its
    # answer buttons (not a vague "what do you mean?").
    if pending and stage == "none" and pending.get("kind") in ("offer", "options", "clear", "confirm_change", "unavailable"):
        unreadable = (len(transcript.split()) <= 3 and "?" not in transcript and said_number is None
                      and not short_no and not _names_food(transcript, index)
                      and not (co.says_yes(transcript) or is_affirmative(transcript) or _YES_START.search(transcript))
                      and not (upsell_engine._NO.search(transcript) or is_decline(transcript) or is_done_ordering(transcript))
                      and not (_CLEAR_ALL.search(transcript) or _DROP_HELD.search(transcript) or _tray.qty_intent(transcript)))
        if unreadable and pending.get("kind") == "options":
            # "দশ" / "স্পাইসী" answer the size / spice even though they're short — only no progress at all is unreadable
            unreadable = not any(_answers_held(dict(e), index, transcript) for e in pending.get("items") or []
                                 if str(e.get("itemId")) in index.by_id)
        # (a guessed "no" only where no = leave things as they are — never for a size / spice question, where it would
        # drop the dish the guest wants)
        if unreadable and pending.get("kind") != "options" and _sounds_like_no(transcript):
            print(f"[brain] open question + {transcript!r} → heard as a no")
            transcript, short_no = ("না থাক" if bn else "no"), True
        elif unreadable:
            q, buttons = _pending_question(pending, index, cart_rows, lang)
            if q:
                tstate["pending"] = pending
                text = ("দুঃখিত, ঠিক বুঝতে পারিনি। " if bn else "Sorry, I didn't quite catch that. ") + q
                res = tray_done(text, [], False, cart_rows, "reasked_open_question", "other")
                return _with_buttons(res, buttons) if buttons else res

    # (a-) the waiter's offer last turn ("…একটা ঠান্ডা Mint Lemonade ভালো যাবে (৳160)। দেব?") → "হ্যাঁ" applies it exactly
    # ("হ্যাঁ, দুইটা" → two), "না" is remembered (two "no"s → no more offers this visit), anything else → the usual flow
    if offer_pending and stage == "none":
        o_info = offer_pending.get("offer") or {}
        o_ops = [dict(x) for x in offer_pending.get("ops") or []]
        o_ids = {str(i) for i in o_info.get("item_ids") or []}
        named_other = [it for it in find_mentions(transcript, index, limit=3) if index.item_id(it) not in o_ids]
        o_close = (("তাহলে অর্ডারটা কনফার্ম করব?" if bn else "Shall I confirm your order then?")
                   if o_info.get("moment") == "wrap_up"
                   else ("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn else "Anything else, or shall I confirm your order?"))
        if (co.says_yes(transcript) or is_affirmative(transcript) or _YES_START.search(transcript)) and not named_other                 and o_ops and not _SAYS_CONFIRM.search(transcript):
            adds = [x for x in o_ops if x["op"] == "add"]
            if said_number and said_number > 0 and len(adds) == 1:
                adds[0]["quantity"] = said_number  # "হ্যাঁ, দুইটা"
            after = _tray.simulate(cart_rows, o_ops, False, index.by_id)
            return tray_done((offers.accepted_text(o_info, o_ops, lang) + " " + o_close).strip(), o_ops, False, after,
                             "offer_accepted")
        if (is_done_ordering(transcript) and not named_other and not _YES_START.search(transcript)
                and not (short_no or upsell_engine._NO.search(transcript) or is_decline(transcript))):
            # "কিছু লাগবে না" — no to the offer AND to anything more: counted as a no, then on to confirming (below)
            rstate.offer_declines += 1
            profile.declined = list(dict.fromkeys(profile.declined + [i for i in o_ids if i not in cart_qty]))
            rstate.profile = profile.to_dict()
        adds = [x for x in o_ops if x["op"] == "add"]
        if (said_number and said_number > 0 and len(adds) == 1 and len(o_ops) == 1 and not named_other
                and len(transcript.split()) <= 4 and not _SAYS_CONFIRM.search(transcript)):
            # "না, দুইটা" / "দুইটা দেন" → the number is how many (like "হ্যাঁ, দুইটা")
            adds[0]["quantity"] = said_number
            after = _tray.simulate(cart_rows, o_ops, False, index.by_id)
            return tray_done((offers.accepted_text(o_info, o_ops, lang) + " " + o_close).strip(), o_ops, False, after,
                             "offer_accepted")
        if short_no or upsell_engine._NO.search(transcript) or (is_decline(transcript) and not named_other):
            rstate.offer_declines += 1
            profile.declined = list(dict.fromkeys(profile.declined + [i for i in o_ids if i not in cart_qty]))
            rstate.profile = profile.to_dict()
            if not _SAYS_CONFIRM.search(transcript):  # "না, কনফার্ম করুন" → straight on to the read-back
                return tray_done(("ঠিক আছে! " if bn else "No problem! ") + o_close, [], False, cart_rows,
                                 "offer_declined", "other")

    # (a0) the waiter asked for a size / choice last turn ("Hot Wings — 6 pcs or 10 pcs, and Regular, Spicy or
    # Extra hot?") → "স্পাইসি" / "দশ পিস" / "ছয় পিস, এক্সট্রা হট" fills it in and adds it, with the quantity they ordered
    carry_options: Optional[Dict[str, Any]] = None  # the question still open (unanswered this turn) → asked again later
    options_now: List[Dict[str, Any]] = []  # held dishes completed while another dish is ordered too (added below)
    if pending and stage == "none" and pending.get("kind") == "options":
        held = [dict(e) for e in pending.get("items") or [] if isinstance(e, dict) and str(e.get("itemId")) in index.by_id]
        held_ids = {str(e["itemId"]) for e in held}
        named_now = {index.item_id(it) for it in find_mentions(transcript, index, limit=6) + _dishes_named(transcript, index, limit=6)}
        others = named_now - held_ids
        held_names = " ".join(str(e.get("name") or "") for e in held)
        # "হট উইংস লাগবে না" / "না, থাক" → that dish (or all of them, when none is named) is left out
        if held and not others and (short_no or _DROP_HELD.search(transcript)):
            gone = [e for e in held if str(e["itemId"]) in named_now] or held
            keep = [e for e in held if e not in gone]
            names = ", ".join(str(e["name"]) for e in gone)
            if keep:
                tstate["pending"] = {"kind": "options", "items": keep}
            text = ((f"ঠিক আছে, {names} বাদ দিলাম।" if bn else f"Okay, I've left out the {names}.") + " "
                    + (_options_question(keep, index, lang) if keep else ("আর কিছু লাগবে?" if bn else "Anything else?")))
            return tray_done(text.strip(), [], False, cart_rows, "declined_options", "other")
        progress = False
        if held and not _is_question_not_order(transcript):
            # the parts that name ANOTHER dish are a new order (read below, as usual) — the rest answers the held ones
            heard = transcript
            if others:
                segs = [x for x in re.split(r"\s*(?:,|।|;|\s(?:আর|এবং|and|plus)\s)\s*", transcript) if x.strip()]
                heard = " ".join(x for x in segs if not ({index.item_id(d) for d in find_mentions(x, index, limit=4)
                                                          + _dishes_named(x, index, limit=4)} & others))
            per_dish = _answers_by_dish(heard, held, index)
            for e in held:
                before = (e.get("variant"), tuple(e.get("choices") or []))
                _fill_options(e, index.by_id[str(e["itemId"])], per_dish.get(str(e["itemId"]), ""), held_names, answering=True)
                progress |= before != (e.get("variant"), tuple(e.get("choices") or []))
        done = [e for e in held if progress and not _fill_options(dict(e), index.by_id[str(e["itemId"])], "")]
        rest = [e for e in held if e not in done]
        if progress and not others:
            p_ops = [_held_op(e, index) for e in done]
            if rest:
                tstate["pending"] = {"kind": "options", "items": rest}
            after = _tray.simulate(cart_rows, p_ops, False, index.by_id)
            text = " ".join(x for x in [
                _cart_change_reply(p_ops, False, index, {}, lang, restaurant, rows=after, with_summary=not rest) if p_ops else "",
                _options_question(rest, index, lang),
            ] if x)
            o = offer_for("first_add", after, p_ops) if p_ops and not rest else None
            if o and upsell_engine.ends_with_closing(text):
                text = offers.swap_closing(text, o.text)  # "…Hot Wings যোগ করলাম। উইংস বেশ ঝাল — …দেব?"
                hold_offer(o)
            return tray_done(text, p_ops, False, after, "options_answered" if not rest else "options_partly_answered")
        if held and not others and not progress and (is_affirmative(transcript) or _YES_START.search(transcript)) \
                and len(transcript.split()) <= 3:
            tstate["pending"] = {"kind": "options", "items": held}
            return tray_done(_options_question(held, index, lang), [], False, cart_rows, "options_asked_again")
        if held:
            # "দশ পিস স্পাইসি, আর একটা কোক দেন" → the wings are added with the Coke (options_now, below); a question
            # about them ("এক্সট্রা হট কি খুব ঝাল?") or another order → answered as usual, the rest keeps waiting
            options_now = [_held_op(e, index) for e in done]
            if rest:
                carry_options = {"kind": "options", "items": rest}
                tstate["pending"] = carry_options
    # (a) the waiter asked "sure?" last turn (clear everything / 20 of something / a possible duplicate)
    elif pending and stage == "none" and pending.get("kind") != "offer":
        p_ops = list(pending.get("ops") or [])
        # "না, ২টা" / "শুধু একটা" → a correction of the number, not a no: do it with the number they said
        if (said_number is not None and len(p_ops) == 1 and p_ops[0].get("op") in ("add", "set")
                and len(transcript.split()) <= 5 and not find_mentions(transcript, index, limit=1)):
            fixed_op = {**p_ops[0], "quantity": said_number}
            it_p = index.by_id.get(str(fixed_op.get("itemId"))) or {}
            key_p = _tray.line_key(str(fixed_op.get("itemId")), fixed_op.get("variant"),
                                   fixed_op.get("modifiers") or _tray.resolve_choices(it_p, fixed_op.get("choices") or []))
            existing = next((r for r in cart_rows if r["key"] == key_p), None)
            if existing and fixed_op["op"] == "add" and _tray.qty_intent(transcript) != "more":
                # it was already in the tray ("আগে থেকেই 1টা আছে… মোট 2টা করব?" → "না, ৩টা") → that's the total
                # ("আরও ২টা" → two on top: stays an add)
                fixed_op = {"op": "set", "itemId": fixed_op["itemId"], "name": fixed_op["name"], "lineKey": key_p,
                            "quantity": said_number}
            if said_number > 0:
                after = _tray.simulate(cart_rows, [fixed_op], False, index.by_id)
                return tray_done(_cart_change_reply([fixed_op], False, index, {}, lang, restaurant, rows=after),
                                 [fixed_op], False, after, "corrected_quantity")
        if co.says_yes(transcript) or is_affirmative(transcript) or (
                pending.get("kind") == "clear" and _YES_START.search(transcript)) or (
                pending.get("kind") == "confirm_change" and said_number is None and _tray.qty_intent(transcript) == "more"):
            p_ops, p_clear = list(pending.get("ops") or []), bool(pending.get("clear"))
            after = _tray.simulate(cart_rows, p_ops, p_clear, index.by_id)
            if pending.get("kind") == "clear" and not p_ops:
                ck = {**ck, "stage": "none"}
                return tray_done(_cleared_text(lang), [], True, after, "cleared_all")
            return tray_done(_cart_change_reply(p_ops, p_clear, index, {}, lang, restaurant, rows=after), p_ops, p_clear,
                             after, f"confirmed_{pending.get('kind')}")
        if short_no:
            text = "ঠিক আছে, যেমন ছিল তেমনই রাখলাম। আর কিছু লাগবে?" if bn else "Okay, I've left it as it was. Anything else?"
            return tray_done(text, [], False, cart_rows, f"declined_{pending.get('kind')}", "other")
        # anything else ("না, দুইটাই", a new request) → the question lapses; the words are handled normally below

    # (b) undo — "আগের মতো করে দিন", "undo that"
    if _tray.UNDO.search(transcript) and len(transcript.split()) <= 8 and stage == "none":
        if last_change:
            u_ops = _tray.undo_ops(last_change, cart_rows)
            if u_ops:
                after = _tray.simulate(cart_rows, u_ops, False, index.by_id)
                lead = "ঠিক আছে, আগের মতো করে দিলাম। " if bn else "Done — I've put it back the way it was. "
                return tray_done(lead + _cart_change_reply([], False, index, {}, lang, restaurant, rows=after), u_ops, False,
                                 after, "undo")
            text = ("ট্রেতে এর মধ্যে বদল হয়েছে, তাই আগের অবস্থায় ফেরাতে পারলাম না — কী বদলাতে চান বলুন।" if bn
                    else "The tray has changed since, so I can't put it back automatically — tell me what to change.")
            return tray_done(text, [], False, cart_rows, "undo_stale", "other")
        text = ("এখনো এমন কোনো বদল করিনি যেটা ফিরিয়ে দেব। কী করতে চান বলুন।" if bn
                else "There's nothing for me to undo yet — what would you like to change?")
        return tray_done(text, [], False, cart_rows, "undo_nothing", "other")

    # (b2) "আরেকটা দিন" / "one more" / "একটা কমান" right after a change → exactly that line, +1 / −1
    rel = _tray.RELATIVE.match(transcript.strip())
    if rel and stage == "none" and last_change and not find_mentions(transcript, index, limit=1):
        keys = set(last_change.get("after_keys") or [])
        target = [r for r in cart_rows if r["key"] in keys]
        if len(target) == 1:
            r0 = target[0]
            more = bool(rel.group("more"))
            r_op = ({"op": "add", "itemId": r0["itemId"], "name": r0["name"], "quantity": 1,
                     "variant": r0.get("variation") or "", "choices": [m.get("name") for m in r0.get("modifiers") or []],
                     "modifiers": list(r0.get("modifiers") or []), "price": float(r0.get("price") or 0)} if more else
                    ({"op": "remove", "itemId": r0["itemId"], "name": r0["name"], "lineKey": r0["key"]} if r0["quantity"] <= 1 else
                     {"op": "set", "itemId": r0["itemId"], "name": r0["name"], "lineKey": r0["key"], "quantity": r0["quantity"] - 1}))
            if not r_op.get("variant"):
                r_op.pop("variant", None)
            after = _tray.simulate(cart_rows, [r_op], False, index.by_id)
            return tray_done(_cart_change_reply([r_op], False, index, {}, lang, restaurant, rows=after), [r_op], False, after,
                             "one_more" if more else "one_less")

    # (c) "ট্রেতে কী আছে?" / "what's in my tray?" / "কতগুলো আইটেম হলো?"
    if _tray.TRAY_QUESTION.search(transcript) and stage == "none" and not find_mentions(transcript, index, limit=1):
        if cart_rows:
            s_txt, s_total, s_count = _tray.summary(cart_rows)
            vat = _vat_hint(restaurant, lang)
            text = (f"আপনার ট্রেতে এখন {s_count}টা আইটেম: {s_txt} — মোট {_money(s_total)}{vat}। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
                    if bn else f"You have {s_count} items: {s_txt} — {_money(s_total)}{vat}. Anything else, or shall I confirm your order?")
        else:
            text = "আপনার ট্রে এখনো খালি — কী দেব বলুন?" if bn else "Your tray is empty so far — what can I get you?"
        return tray_done(text, [], False, cart_rows, "tray_review", "order_review")

    # (d) wait times — "how long will it take?", "where's my food?", "what's quickest?" — answered from the
    # real numbers (dish prep times, the live kitchen queue, the guest's own orders), never guessed by the model.
    # Only for a plain time question: "add 2 kacchi, how long?" goes to the model with the same numbers.
    kitchen = ctx.get("kitchen") if isinstance(ctx.get("kitchen"), dict) else None
    cart_est = wtalk.cart_estimate(cart_rows, index.by_id, kitchen)
    time_q, quick_q = asks_time(transcript), asks_quickest(transcript)
    if (time_q or quick_q) and stage == "none" and len(transcript.split()) <= 16 and not _orders_now(transcript):
        mentioned = _dishes_named(transcript, index)
        mine = (kitchen or {}).get("myOrders") or []
        about_dish = bool(mentioned) or bool(_ABOUT_A_DISH.search(transcript))
        w_text, w_note, w_rows, w_offer = "", "", [], []
        if mine and not about_dish and (PLACED_Q.search(transcript) or not cart_rows):
            w_text, w_note = wtalk.placed_order_reply(kitchen, lang) or "", "wait_placed_order"
        elif quick_q and not mentioned:
            foods = [it for it in index.items if orderable.get(index.item_id(it), True)
                     and index.item_id(it) not in blocked and not dish_facts(it)["drink"]]
            fast = wtalk.quickest(foods, kitchen)
            if fast:
                w_text, w_note = wtalk.quickest_reply(fast, kitchen, lang), "wait_quickest"
                w_rows = [_suggestion_row(it, wtalk.say_minutes(m, lang)) for it, m in fast]
                w_offer = [index.item_id(it) for it, _m in fast]
        elif mentioned and not (cart_rows and ORDER_WORDS.search(transcript)):
            if all(orderable.get(index.item_id(it), True) for it in mentioned):
                qty = _said_quantity(transcript) or 1
                offer = [it for it in mentioned if index.item_id(it) not in cart_qty]
                w_text = wtalk.dishes_reply([(it, qty, None) for it in mentioned], kitchen, lang, offer=bool(offer))
                w_note, w_offer = "wait_dish", [index.item_id(it) for it in offer[:1]] if len(offer) == 1 else []
        elif cart_est and time_q:
            w_text, w_note = wtalk.cart_reply(cart_est, kitchen, lang), "wait_cart"
        elif time_q and not about_dish:
            foods = [it for it in index.items if orderable.get(index.item_id(it), True) and not dish_facts(it)["drink"]]
            w_text, w_note = wtalk.general_reply(foods, kitchen, lang), "wait_general"
        if w_text:
            m = _base_meta(
                language=lang, intent="suggestions" if w_rows else "menu", topic="wait_time", suggestions=w_rows,
                decision={"showSuggestionsModal": bool(w_rows), "showUpsellTray": False},
                mentionedItems=[{"itemId": index.item_id(it), "name": it.get("name")} for it in mentioned], notes=w_note, **ids,
            )
            rstate.turn += 1
            if w_offer:
                rstate.last_offered, rstate.last_offer_turn = w_offer, rstate.turn
                rstate.recent = list(dict.fromkeys(w_offer + rstate.recent))[:12]
            rstate.profile = profile.to_dict()
            m["checkout"], m["tray"] = ck, tstate
            m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, [w_note]
            if bn:
                m["voiceReplyText"] = w_text
            print(f"[brain] wait time: {w_note} → {w_text[:90]}")
            return {"replyText": w_text, "meta": m}

    # (e) ANY general "what do you have?" — "কি আছে তোমাদের মেনুতে?", "তোমাদের কি কি আছে?", "show me the menu",
    # "what can I get?" → open the menu itself: "এই যে আমাদের মেনু — দেখে বলুন… নাকি আমি কিছু সাজেস্ট করব?" — never
    # read the menu out. Something more specific still goes to the model: a kind ("কি কি স্যুপ আছে?"), a pick ("ভালো
    # কী আছে?"), a dish named, what's new, a taste / diet / budget.
    if (
        stage == "none"
        and (_SEE_MENU.search(transcript) or asks_overview(transcript)
             or (understood is not None and u_intent in ("see_menu", "menu_overview")))
        and not _WANTS_A_PICK.search(transcript)
        and not kind_scope and not kind_items(transcript, index) and not missing_kinds(transcript, index)
        and not find_mentions(transcript, index, limit=1) and not _orders_now(transcript)
        and not _ABOUT_MINE.search(transcript)
        and not re.search(r"নতুন|\bnew\b|\bnotun\b", transcript, re.I)
        and not reco_format.taste_asked(transcript)
        and extract_prefs(transcript).summary() == "nothing specific yet"
    ):
        text = ("এই যে আমাদের মেনু — দেখে বলুন, কোনটা অর্ডার করতে চান? নাকি আমি কিছু সাজেস্ট করব?" if bn
                else "Here's our menu — have a look and tell me what you'd like to order. Or shall I suggest something?")
        m = _base_meta(language=lang, intent="menu", topic="restaurant_info",
                       decision={"showSuggestionsModal": False, "showUpsellTray": False, "openMenu": True},
                       notes="open_menu", **ids)
        rstate.turn += 1
        rstate.profile = profile.to_dict()
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, ["open_menu"]
        if bn:
            m["voiceReplyText"] = text
        print(f"[brain] open menu → {text}")
        return {"replyText": text, "meta": m}

    # (e2) small talk on its own — "কি খবর, কেমন আছো?", "আসসালামু আলাইকুম", "হ্যালো" → a friendly answer (no model,
    # no dish pitch). The model once answered "how are you?" with "I'm virtual, I don't eat" — never again.
    small = _small_talk(transcript, lang) if stage == "none" and not tstate.get("pending") and means("small_talk") else None
    # "আমি আজকে কিছু খেতে চাই না" → no problem, no dishes pushed (it once got a list of four "popular" dishes)
    if (not small and stage == "none" and not tstate.get("pending") and means("not_wanting")
            and _not_wanting(transcript, index, bool(cart_rows))):
        small = ("ঠিক আছে, কোনো সমস্যা নেই! কিছু লাগলে যেকোনো সময় বলবেন।" if bn
                 else "No problem at all! Just tell me whenever you'd like something.")
    if small:
        m = _base_meta(language=lang, intent="chitchat", topic="greeting",
                       decision={"showSuggestionsModal": False, "showUpsellTray": False}, notes="small_talk", **ids)
        rstate.turn += 1
        rstate.profile = profile.to_dict()
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, ["small_talk"]
        if bn:
            m["voiceReplyText"] = small
        print(f"[brain] small talk → {small}")
        return {"replyText": small, "meta": m}

    # (g) a plain recommendation request gets the waiter's fixed shape (reco_format), filled with the ranked picks:
    #   a KIND  — "ঝাল কিছু আছে?", "স্যুপের মধ্যে ভালো কোনটা?", "স্পেশাল কী আছে?", "ভালো কি আছে?"
    #             → "{ঝাল} আইটেমের মধ্যে A, B অথবা C খুবই জনপ্রিয়, এছাড়াও আপনি D কিংবা E-ও নিতে পারেন।"
    #   WHO     — "বাচ্চাদের জন্য কী ভালো?" → "আপনার বাচ্চাদের জন্য A, B অথবা C নিতে পারেন, এছাড়াও D কিংবা E-ও…"
    # The dishes respect the time of day, availability and the guest (the ranking); star-marked ones lead only when
    # they are among them. Anything more (a budget, a head-count, an allergy, a dish named, "which of these") → model.
    fixed = _fixed_reco(
        transcript, index=index, orderable=orderable, kinds=kinds, profile=profile, stats=stats, rstate=rstate,
        kind_scope=kind_scope, lang=lang, stage=stage, mode=mode, about_shown=about_shown,
        cart_ids=list(cart_qty) + mentioned_now, in_tray=in_tray, understood=understood,
    )
    if fixed:
        text, rows, note = fixed
        m = _base_meta(language=lang, intent="suggestions", topic="recommendation", suggestions=rows,
                       decision={"showSuggestionsModal": True, "showUpsellTray": False}, notes=note, **ids)
        rstate.turn += 1
        rstate.last_offered, rstate.last_offer_turn = [r["itemId"] for r in rows], rstate.turn
        rstate.recent = list(dict.fromkeys(rstate.last_offered + rstate.recent))[:12]
        rstate.profile = profile.to_dict()
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), "full", [note]
        if bn:
            names = sorted({r["title"] for r in rows} | {re.sub(r"\s*\(.*?\)", "", r["title"]).strip() for r in rows},
                           key=len, reverse=True)
            m["voiceReplyText"] = re.sub("|".join(re.escape(n) for n in names), lambda mm: to_bangla_script(mm.group(0)), text)
        print(f"[brain] {note} → {text}")
        return {"replyText": text, "meta": m}

    last_waiter = next((m.get("content") or "" for m in reversed(history or []) if m.get("role") == "assistant"), "")

    # ---- "that's all" → THE offer at the end (one, only if the meal is missing something), before the read-back
    if (stage == "none" and cart_rows and is_done_ordering(transcript) and not is_explicit_confirm(transcript)
            and not _SAYS_CONFIRM.search(transcript) and "?" not in transcript
            and not upsell_engine.ends_with_closing(last_waiter)):
        # ("আর কিছু না" is no question: _QUESTION's "কি\b" matches inside "কিছু" — a vowel sign ends a \w run)
        o = offer_for("wrap_up", cart_rows, [])
        if o:
            hold_offer(o)
            return tray_done(o.text, [], False, cart_rows, f"offer_{o.type}", "order_review")

    # "Peri Peri Fries অথবা Parmesan Garlic Fries — কোনটা দেব?" → a bare "হ্যাঁ" names neither: ask which, as buttons
    # (the model used to pick one of them for the guest)
    either = [it for it in find_mentions(last_waiter.split("।")[-1] if "।" in last_waiter else last_waiter, index, limit=4)
              if index.item_id(it) not in cart_qty]
    if (stage == "none" and not carry_options and len(either) >= 2 and last_waiter.rstrip().endswith("?")
            and re.search(r"অথবা|নাকি|\bor\b", last_waiter.split("।")[-1], re.I)
            and (is_affirmative(transcript) or _YES_START.search(transcript)) and len(transcript.split()) <= 4
            and not find_mentions(transcript, index, limit=1) and said_number is None):
        names = [str(it.get("name")) for it in either[:4]]
        text = (f"কোনটা দেব — {' নাকি '.join(names)}?" if bn else f"Which one would you like — {' or '.join(names)}?")
        res = tray_done(text, [], False, cart_rows, "which_one_of_the_offer", "order_change")
        res["meta"].setdefault("decision", {})["chooseOptions"] = [
            {"label": n, "say": f"{n} দিন" if bn else f"{n}, please", "itemId": index.item_id(it), "price": it.get("price")}
            for n, it in zip(names, either)]
        return res

    # "…Chicken Corn Soup দারুণ হবে, নেবেন?" → "না" declines THAT dish — it is not "I'm done, read my order back"
    offered_now = [it for it in find_mentions(last_waiter, index, limit=3) if index.item_id(it) not in cart_qty]
    if (stage == "none" and cart_rows and offered_now and last_waiter.rstrip().endswith("?")
            and _OFFER_Q.search(last_waiter.split("।")[-1]) and not asked_confirm
            and upsell_engine._NO.search(transcript)):
        profile.declined = list(dict.fromkeys(profile.declined + [index.item_id(it) for it in offered_now]))
        rstate.declined_turn = rstate.turn
        rstate.turn += 1
        rstate.last_offered = []
        rstate.profile = profile.to_dict()
        text = ("ঠিক আছে! আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn
                else "No problem! Anything else, or shall I confirm your order?")
        return tray_done(text, [], False, cart_rows, "declined_offer", "other")

    # the reading couldn't make sense of it (garbled speech) and no dish is recognisable → "please say it again" —
    # no guessing, and no big model call for it
    # (not right after the waiter asked something: "ছোটোটা।" answers "ছোটটা নাকি বড়টা?" — the model reads it in context)
    if (u_intent == "unclear" and not (understood or {}).get("confident") and stage == "none"
            and not last_waiter.rstrip().endswith("?") and not _dishes_named(transcript, index, limit=1)):
        rstate.turn += 1
        text = _NOT_CLEAR["bn" if bn else "en"]
        return tray_done(text, [], False, cart_rows, "understood_unclear", "other")

    # Fast, deterministic checkout moves (no model): "yes" to the read-back, "wait", a table number,
    # "place my order" / "that's all" with nothing else in the sentence.
    # A "না" to "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" is "nothing more" — on to confirming (not "don't place it")
    closing_no = (stage == "none" and bool(cart_rows) and upsell_engine.ends_with_closing(last_waiter)
                  and (bool(upsell_engine._NO.search(transcript)) or is_done_ordering(transcript)))
    action, why = co.decide(
        text="আর কিছু লাগবে না" if closing_no else transcript, stage=stage, stored_signature=str(ck.get("sig") or ""),
        signature_now=sig_now, cart_nonempty=bool(cart_rows), table=table, llm_checkout="none",
        asked_to_confirm=asked_confirm and not closing_no,
        cart_changed_this_turn=False, cleared=False, defer_done=mode == "last_call",
        list_on_screen=bool(shown_ids), direct_pending=bool(ck.get("direct")),
    )
    words = len(transcript.split())
    # we asked "which table?" and heard no number ("মারুক") → ask again, keep waiting — never let the model make
    # a table out of it ("টেবিল মারুক…"). A real question at this point ("what's the wifi?") is still answered.
    if (stage == "table" and action == "stay" and not table and words <= 4 and "?" not in transcript
            and not find_mentions(transcript, index, limit=1) and not co.wants_to_hold(transcript)):
        text = co.table_again_text(lang)
        m = _base_meta(language=lang, intent="order", topic="confirm_order",
                       decision={"showSuggestionsModal": False, "showUpsellTray": False, "askTable": True,
                                 "checkoutStage": "table"}, notes="table_again", **ids)
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, ["table_again"]
        if lang == "bn":
            m["voiceReplyText"] = text
        return {"replyText": text, "meta": m}
    # (a dish named in Bangla too — "একটা ক্লাসিক স্ম্যাশ বার্গার অর্ডার করেন" is ordering a burger, not "place it")
    plain = ("?" not in transcript and not find_mentions(transcript, index, limit=1)
             and not _dishes_named(transcript, index, limit=1))
    # before reading back / placing: a line that can't be ordered right now (sold out, out of hours) is sorted first
    if action in ("readback", "place") and cart_rows:
        gone = [w for w in _tray.warnings(cart_rows, index.by_id, orderable, lambda _it: []) if w["kind"] == "unavailable"]
        if gone:
            names = ", ".join(w["name"] for w in gone)
            tstate["pending"] = {"kind": "unavailable", "clear": False,
                                 "ops": [{"op": "remove", "itemId": w["itemId"], "name": w["name"], "lineKey": w["lineKey"]} for w in gone]}
            ck = {**ck, "stage": "none"}
            text = (f"অর্ডার দেওয়ার আগে একটা কথা: {names} এখন পাওয়া যাচ্ছে না ({gone[0]['reason']})। ওটা বাদ দিয়ে দেব?"
                    if bn else f"Before I place it: {names} can't be ordered right now ({gone[0]['reason']}). Shall I remove it?")
            tstate["pending"]["question"] = text
            return tray_done(text, [], False, cart_rows, "unavailable_before_checkout", "other")
    if action == "empty" and not cart_rows and stage == "none":
        about = [i for i in rstate.last_offered if i in index.by_id][:2] if rstate.turn - rstate.last_offer_turn <= 2 else []
        if len(about) != 1 and recent:
            about = [index.item_id(recent[0])]
        if len(about) == 1:
            it = index.by_id[about[0]]
            text = (f"আপনার ট্রে এখনো খালি — {it.get('name')} দেব?" if bn
                    else f"Your tray is still empty — shall I add the {it.get('name')}?")
            rstate.turn += 1
            rstate.last_offered, rstate.last_offer_turn = [about[0]], rstate.turn
            m = _base_meta(language=lang, intent="order", topic="confirm_order",
                           mentionedItems=[{"itemId": about[0], "name": it.get("name")}], notes="empty_offer_recent", **ids)
            m["checkout"], m["tray"] = {**ck, "stage": "none"}, tstate
            m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, ["empty_offer_recent"]
            if bn:
                m["voiceReplyText"] = text
            return {"replyText": text, "meta": m}
    if plain and (
        action in ("place", "hold") and words <= 8
        or action in ("readback", "ask_table") and (stage != "none" or words <= 8)
        or action == "empty" and words <= 8
    ):
        text, flags, new_ck = _checkout_turn(action, rows=cart_rows, table=table, lang=lang, restaurant=restaurant,
                                             prev=ck, transcript=transcript,
                                             eta_hint=wtalk.eta_hint(cart_est, lang) if kitchen else "", online=online)
        print(f"[brain] checkout fast path: {action} ({why}) table={table}")
        text = text or co.held_text(lang)
        if action in ("readback", "ask_table") and is_done_ordering(transcript) and last_waiter.rstrip().endswith("?"):
            # "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" / "…দেব?" → "কিছু লাগবে না" → it follows on from that question
            text = (("ঠিক আছে, তাহলে " + text.replace("অর্ডারটা দিয়ে দেব?", "অর্ডারটা কনফার্ম করব?")) if bn
                    else "Alright — " + text)
        meta = _base_meta(
            language=lang, intent="order", topic="confirm_order" if action != "hold" else "order_review",
            items=_items_payload(index, cart_qty) if action == "place" else [],
            decision={"showSuggestionsModal": False, "showUpsellTray": False, **flags},
            notes=f"checkout_{action}", **ids,
        )
        meta["checkout"] = new_ck
        meta["tray"] = tstate
        if action == "place":
            meta["orderDraft"] = _order_draft(cart_rows, table or "", sig_now)
        meta["reco"], meta["recoMode"], meta["guards"] = rstate.to_dict(), mode, []
        if lang == "bn":
            meta["voiceReplyText"] = text
        return {"replyText": text, "meta": meta}

    # "আপনার জন্য এটা দেব?" → "দেন" / "yes": add the ONE dish we just offered (deterministic, no model).
    # Several offered → the model asks which; a dish needing a size or choice → the model asks first.
    offered_one = (
        len(rstate.last_offered) == 1 and rstate.turn - rstate.last_offer_turn <= 1 and rstate.last_offered[0] in index.by_id
    )
    if offered_one:
        # "yes" only accepts a dish the waiter actually ASKED about out loud — a pairing card shown silently
        # isn't a question the guest is answering ("সব বাতিল" … "হ্যাঁ" must not add a Beef Sizzling)
        last_asst = next((m.get("content") or "" for m in reversed(history or []) if m.get("role") == "assistant"), "")
        offered_name = str(index.by_id[rstate.last_offered[0]].get("name") or "")
        offered_one = "?" in last_asst and (
            _reply_mentions(last_asst, offered_name) or _reply_mentions(last_asst, to_bangla_script(offered_name))
        )
    if (
        offered_one and stage == "none" and not asked_confirm and is_affirmative(transcript)
        and not find_mentions(transcript, index, limit=1)
    ):
        it = index.by_id[rstate.last_offered[0]]
        yes_ops, yes_problems = _validate_ops(
            [{"op": "add", "item": index.item_id(it), "quantity": 1}], index, dict(cart_qty), orderable, None, guest_words,
            context_ids={index.item_id(it)},  # we offered exactly this dish
        )
        if yes_ops and not yes_problems:
            after = _tray.simulate(cart_rows, yes_ops, False, index.by_id)
            text = _cart_change_reply(yes_ops, False, index, {}, lang, restaurant, rows=after)
            print(f"[brain] yes to the offered dish → add {it.get('name')}")
            rstate.turn += 1
            rstate.last_offered = []
            profile.liked = list(dict.fromkeys(profile.liked + [index.item_id(it)]))
            rstate.profile = profile.to_dict()
            out = tray_done(text, yes_ops, False, after, "accepted_offer")
            out["meta"]["mentionedItems"] = [{"itemId": index.item_id(it), "name": it.get("name")}]
            return out

    def may_recommend(it: Dict[str, Any]) -> bool:
        # (water / Coke / 7Up are never "recommended" — only when the guest asks for them)
        iid = index.item_id(it)
        return iid not in blocked and (not is_packaged(it) or iid in asked_ids or iid in mentioned_now)

    def false_unavailable(text: str) -> List[str]:
        """Orderable dishes the reply claims are sold out / unavailable."""
        # clause-level, so "X is sold out, but try Y" doesn't implicate Y
        clauses = re.split(r"(?<=[.!?।;,—])\s+|\s+(?:but|however|instead|or|তবে|কিন্তু|অথবা)\s+", text or "", flags=re.I)
        out = []
        for it in find_mentions(text, index, limit=8):
            name = str(it.get("name"))
            if orderable.get(index.item_id(it), True) and any(
                name.lower() in c.lower() and _SAYS_UNAVAILABLE.search(c) for c in clauses
            ):
                out.append(name)
        return out

    missing_now = missing_kinds(transcript, index)

    closest_now = _closest_to(missing_now, index, orderable) if missing_now else []

    def odd_substitutes(o: Dict[str, Any]) -> List[str]:
        """Asked for something we don't have and the reply pushes something unrelated — a soup for dessert, a DRINK
        for a burger. Only what's genuinely close (_CLOSEST) may be offered."""
        if not missing_now or o.get("cartOps"):
            return []
        text = str(o.get("replyText") or "")
        ok = {index.item_id(c) for c in closest_now}
        named = {index.item_id(it): it for it in find_mentions(text, index, limit=6) + _dishes_named(text, index, limit=6)}
        odd = [str(it.get("name")) for iid, it in named.items() if iid not in ok and iid not in cart_qty]
        # a missing FOOD answered with any drink ("…সফট ড্রিংকস বা মিনারেল ওয়াটার") — even when the drink's name
        # was written in Bangla script and not recognised as a dish
        drink_kinds = {"desserts", "coffee", "tea", "juice", "drinks", "alcohol"}
        if (not odd and set(missing_now) - drink_kinds
                and re.search(r"ড্রিংক|পানীয়|পানি|ওয়াটার|কোক|জুস|\b(drink|water|juice|coke|soda)", text, re.I)):
            odd = ["a drink"]
        return odd

    def reco_problems(o: Dict[str, Any]) -> List[str]:
        """Recommendation replies must name real dishes that are orderable and suit this time."""
        is_reco = o.get("topic") == "recommendation" or o.get("intent") == "suggestions"
        text = str(o.get("replyText") or "")
        if not is_reco or not text:
            return []
        sentences = re.split(r"(?<=[.!?।])\s+", text)
        out = []
        for it in find_mentions(text, index, limit=8):
            if may_recommend(it):
                continue
            name = str(it.get("name"))
            flagged = any(name.lower() in s.lower() and _UNAVAILABLE_WORDS.search(s) for s in sentences)
            if not orderable.get(index.item_id(it), True) and flagged:
                continue  # "X is sold out, but try Y" is fine
            if is_packaged(it) and index.item_id(it) not in blocked:
                continue  # water / Coke mentioned: any praise is taken out below (_no_praise_for_packaged) — no redo
            out.append(f"{name} isn't right for this guest now ({', '.join(blocked.get(index.item_id(it), ['blocked']))})")
        # no dish named: fine for a clarifying question, otherwise names were translated/transliterated
        if pool and "?" not in text and not find_mentions(text, index, limit=1):
            out.append("name the recommended dishes exactly as on the MENU (English names)")
        return out

    # what the last turn changed, as the model sees the tray now ("L3 1 × Spring Roll")
    last_change_txt = ""
    if last_change:
        keys = set(last_change.get("after_keys") or [])
        now_lines = [r for r in cart_rows if r["key"] in keys]
        if now_lines:
            last_change_txt = "; ".join(f"{r['line']} {_tray.label(r)}" for r in now_lines)
        elif last_change.get("before"):
            last_change_txt = "removed " + "; ".join(_tray.label(r) for r in last_change["before"])

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": PLAYBOOK},
        {"role": "system", "content": _knowledge_block(index, restaurant)},
    ]
    for m in (history or [])[-HISTORY_MESSAGES:]:
        if m.get("role") in ("user", "assistant") and (m.get("content") or "").strip():
            messages.append({"role": m["role"], "content": m["content"].strip()[:600]})
    messages.append(
        {
            "role": "user",
            "content": _turn_block(
                transcript=transcript, lang=lang, index=index, cart_rows=cart_rows, subtotal=subtotal,
                context=ctx, recent=recent[:4], asked_to_confirm=asked_confirm, understood=understood,
                picks=picks, profile=profile, mode=mode, plan=plan, pairings=pairings,
                any_orderable=any(orderable.values()), just_suggested=just_suggested, ask_next=ask_next,
                orderable_items=[it for it in index.items if orderable.get(index.item_id(it), True)],
                missing=missing_kinds(transcript, index), asked_kinds=kind_items(transcript, index),
                allergy_guides=[allergy_guide(index, a, orderable) for a in profile.allergies],
                checkout_stage=stage,
                last_change=last_change_txt,
                tray_facts=_tray.facts(
                    cart_rows, index.by_id, party=profile.party_size, budget=profile.budget, dish_facts=dish_facts,
                    drinks_on_menu=drinks_exist,
                ),
                on_screen=shown if about_shown else None,
                wait_facts=wtalk.facts(
                    kitchen,
                    cart=cart_est,
                    mentioned=_dishes_named(transcript, index) if (time_q or quick_q) else None,
                    fastest=wtalk.quickest(
                        [it for it in index.items if orderable.get(index.item_id(it), True)
                         and index.item_id(it) not in blocked and not dish_facts(it)["drink"]], kitchen,
                    ) if (quick_q or "quick" in profile.mood) else None,
                ) if kitchen else "",
            ),
        }
    )

    guards: List[str] = []  # what the safety net caught this turn — logged for reviewing real conversations
    # dishes the conversation already pointed at (just suggested / recently discussed) — "চিকেনটা দেন" after one
    # chicken dish was suggested is not ambiguous
    talked_about = {index.item_id(i) for i in recent} | {index.item_id(i) for i in just_suggested}
    # prices are spoken only when the guest is talking money (the cards show prices)
    price_talk = bool(_BUDGET.search(transcript) or _PRICE_ASK.search(transcript))
    # a clean order ("দুইটা ক্রিস্পি রাইস স্যুপ দিন") needs no model: the same checks and confirmation run on it,
    # it just doesn't wait for (or pay for) a model call
    clean_ops = (_clean_order(transcript, index, orderable, dict(cart_qty))
                 if stage == "none" and not tstate.get("pending") and not about_shown and means("order") else [])
    # "স্মল না, বড়টা দাও" — a size swap on one tray line, done exactly (the model once claimed it and did nothing)
    if not clean_ops and stage == "none" and not tstate.get("pending") and means("change_order", "order"):
        clean_ops = _size_swap(transcript, index, orderable, cart_rows)
    # "ফ্রেঞ্চ ফ্রাই ডাবল করে দিন" — twice as many of that tray line, done exactly
    if not clean_ops and stage == "none" and not tstate.get("pending") and means("change_order", "order"):
        clean_ops = _double_it(transcript, index, cart_rows)
    try:
        if clean_ops:
            print(f"[brain] clean order → no model: {[(o['op'], o['item'], o.get('quantity')) for o in clean_ops]}")
            guards.append("clean_order")
            raw = json.dumps({"topic": "order_change", "intent": "order", "language": lang, "replyText": "",
                              "cartOps": clean_ops, "clearCart": False, "confirmOrder": False, "checkout": "none",
                              "understood": True, "suggestions": [], "mentionedItems": [], "answerItems": [],
                              "serviceRequest": None})
        else:
            raw = await _call_openai(messages)
        obj = _parse_model_json(raw)
        first_reply = str(obj.get("replyText") or "")
        issues: List[str] = []
        slips = _price_slips(first_reply, index, cart_rows, subtotal)
        if slips:
            issues.append(
                ", ".join(f"৳{s}" for s in slips) + " doesn't match any MENU price — re-read the MENU and use exact prices."
            )
        # "very popular" / "bestseller" needs evidence: real order data or the owner's own tag
        popular_ok = any("a guest favourite" in p.reasons for p in picks) or any(
            str(t).lower() in ("popular", "bestseller", "best seller") for it in find_mentions(first_reply, index, 6) for t in it.get("tags") or []
        )
        if _NO_INFO_TALK.search(first_reply):
            issues.append(
                "Don't tell the guest the menu has no information / doesn't mention it (\"তথ্য নেই\", \"উল্লেখ নেই\"). "
                "Judge heat/taste from the kind of dish like an experienced waiter, using \"usually\" / \"সাধারণত\"."
            )
        if _POPULARITY_CLAIM.search(first_reply) and not popular_ok:
            issues.append("Don't call dishes popular, bestsellers or guest favourites — there is no data for that; use the listed reasons.")
        vat = re.search(r"(\d+(?:\.\d+)?)\s*%", " ".join((restaurant or {}).get("menuNotes") or []))
        slip_total = _total_slip(first_reply, index, float(vat.group(1)) if vat else 0.0)
        if slip_total and not obj.get("cartOps"):
            issues.append(
                f"The total you stated (৳{slip_total[0]}) is wrong — the dishes you named add up to ৳{slip_total[1]}. "
                "Recompute (or use the MEAL PLAN total)."
            )
        bad_reco = reco_problems(obj)
        if bad_reco:
            issues.append("; ".join(bad_reco) + " — recommend from RANKED PICKS instead.")
        wrongly_out = false_unavailable(first_reply)
        if wrongly_out:
            issues.append(
                ", ".join(wrongly_out) + " IS available and can be ordered right now — don't say otherwise; "
                "if the guest ordered it, add it."
            )
        # a table plan must come with its total (and the total must match the dishes — checked above)
        if plan and price_talk and (not obj.get("cartOps") or _is_question_not_order(transcript)):
            plan_ids = {l["itemId"] for l in plan["lines"]}
            named_plan = [it for it in find_mentions(first_reply, index, limit=10) if index.item_id(it) in plan_ids]
            # must SAY a total ("total / altogether / মোট …"); whether it's right is _total_slip's job above
            if len(named_plan) >= 2 and not (_TOTAL_CUE.search(first_reply) and _amounts(first_reply)):
                sizes = [f"{l['name']} ({l['variant']})" for l in plan["lines"] if l.get("variant")]
                issues.append(
                    f"You presented a meal for the table without its total: give each dish's quantity and say the total "
                    f"(the MEAL PLAN total is ৳{plan['total']})."
                    + (f" Use the plan's sizes ({', '.join(sizes)}) — don't ask which size; they can change it later." if sizes else "")
                )
        if _BUDGET.search(transcript) and not obj.get("cartOps") and not _new_amounts(first_reply, transcript):
            issues.append("The guest gave a budget: propose one concrete combination and state its total in ৳.")
        # voice: an allergy/diet answer that reads out a long list is useless — group it
        if obj.get("topic") == "dietary" and len({index.item_id(i) for i in find_mentions(first_reply, index, limit=30)}) > 8:
            issues.append(
                "Too long to say out loud: group the dishes to avoid (e.g. 'all the prawn dishes, the Special dishes') — "
                "follow the ALLERGY GUIDE, at most ~6 dish names — then suggest 2–3 dishes they can have."
            )
        if _CLAIMS_CONFIRMED.search(first_reply) and not (obj.get("clearCart") and _CLAIMS_CANCELLED.search(first_reply)):
            issues.append(
                "You have NOT placed, taken, sent, confirmed or cancelled any order — only the system does that, "
                "never say it did. Remove that claim and answer what the guest actually asked; if their words are "
                "unclear, say briefly what you understood or ask them to say it again."
            )
        if _KITCHEN_CLAIM.search(first_reply):
            issues.append(
                "Don't say you sent/told/informed the kitchen — you added a note to the order. Say 'I've added a note' "
                "('নোট যোগ করেছি')."
            )
        if about_shown and not obj.get("cartOps"):
            outside = [
                str(it.get("name")) for it in find_mentions(first_reply, index, limit=8)
                if index.item_id(it) not in shown_ids and index.item_id(it) not in cart_qty
            ]
            if outside:
                issues.append(
                    "The guest asked about the dishes ON SCREEN (" + ", ".join(str(it.get("name")) for it in shown)
                    + ") — answer only about those, by name; don't bring in " + ", ".join(outside) + "."
                )
        subs = odd_substitutes(obj)
        if subs:
            issues.append(
                f"The guest asked for {', '.join(missing_now)}, which this menu doesn't have — don't offer "
                f"{', '.join(subs)} as a substitute. Say we don't have it; "
                + (f"offer only what's genuinely close ({', '.join(str(c.get('name')) for c in closest_now)}), "
                   "or ask what else they'd like." if closest_now else "then just ask what else they'd like.")
            )
        # cart changes the guest didn't actually ask for (a question, a guessed size or choice) → ask instead
        pre_ops, pre_problems = _validate_ops(
            obj.get("cartOps"), index, dict(cart_qty), orderable, transcript, guest_words, context_ids=talked_about, rows=cart_rows,
            pick_said=pick_words,
        )
        said_missing = [n for n in _contradicts_adds(first_reply, [o["name"] for o in pre_ops if o["op"] == "add"])
                        if n not in wrongly_out]
        if said_missing:
            issues.append(
                ", ".join(said_missing) + " IS available and you are adding it — don't say it isn't available or "
                "isn't on the menu. Just confirm what you added."
            )
        # (a missing size / choice isn't sent back: the clear dishes are added and that one is held and asked about
        # below — a re-ask made the model drop the whole order: "2 Hot Wings + 3 Onion Rings" → nothing added)
        must_ask = [p for p in pre_problems if any(k in p for k in _ASK_INSTEAD) and not _OPTION_GAP.search(p)]
        if must_ask:
            issues.append(
                "Don't change the cart yet — " + "; ".join(must_ask) + ". Answer the question, or ask which size / "
                "which choice (list the options with prices). Don't say anything was added."
            )
        guards += [tag for needle, tag in _GUARD_TAGS if any(needle in i for i in issues)]
        if issues and not clean_ops:
            # one self-correction pass: a wrong or missing number is worse than a slightly slower answer
            print("[brain] self-check:", issues)
            messages += [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": "Check your reply: " + " ".join(issues) + " Answer again (same JSON)."},
            ]
            try:
                obj = _parse_model_json(await _call_openai(messages))
            except Exception as e:
                print("[brain] re-check failed, keeping first answer:", repr(e))
    except Exception as e:
        print("[brain] model call failed:", repr(e))
        text, extra = _fallback_reply(transcript, lang, index, orderable, picks, ctx)
        meta = _base_meta(language=lang, fallback=True, error=str(e), **extra, **ids)
        # even without the model, remember what the guest told us (the rule-based reading) and what we offered
        rstate.turn += 1
        offered = [s["itemId"] for s in extra.get("suggestions") or []]
        if offered:
            rstate.last_offered, rstate.last_offer_turn = offered, rstate.turn
            rstate.recent = list(dict.fromkeys(offered + rstate.recent))[:12]
        rstate.profile = profile.to_dict()
        meta["reco"], meta["recoMode"] = rstate.to_dict(), mode
        meta["guards"] = ["model_unavailable"]
        if lang == "bn":
            meta["voiceReplyText"] = text
        return {"replyText": text, "meta": meta}

    print("[brain] model:", _safe_snip(obj, 900))

    reply = str(obj.get("replyText") or "").strip()
    # the model no longer writes a spoken copy: the server builds the Bangla voice from replyText (to_bangla_script)
    voice = ""
    topic = obj.get("topic") if obj.get("topic") in TOPICS else "other"
    intent = obj.get("intent") if obj.get("intent") in INTENTS else "chitchat"

    # Still recommending something unavailable / out of time after the re-check → say it ourselves.
    named_in_reply = [index.item_id(it) for it in find_mentions(str(obj.get("replyText") or ""), index, limit=8)]
    off_list = (about_shown and bool(named_in_reply) and not any(i in shown_ids for i in named_in_reply)
                and any(i not in shown_ids and i not in cart_qty for i in named_in_reply))
    if (reco_problems(obj) or off_list) and not obj.get("cartOps") and about_shown and shown:
        # "which of these?" — the answer is always ONE of these (never a fresh, generic recommendation): the one the
        # ranking likes best for this guest and the time, else the first
        print("[brain] 'which of these' answer still invalid → the best of the list")
        guards.append("compare_answer_replaced")
        rank_of = {index.item_id(p.item): n for n, p in enumerate(picks)}
        best = min(shown, key=lambda it: rank_of.get(index.item_id(it), 99))
        why = next((", ".join(p.reasons[:1]) for p in picks if p.item is best), "")
        name = re.sub(r"\s*\(.*?\)", "", str(best.get("name") or "")).strip()
        reply = (f"এগুলোর মধ্যে {name} সবচেয়ে ভালো হবে। দেব?" if lang == "bn"
                 else f"Of these, I'd go for the {name}" + (f" — {why}" if why else "") + ". Shall I add it?")
        voice = reply if lang == "bn" else ""
        obj["answerItems"], obj["suggestions"] = [index.ref(best)], []
        topic, intent = "menu_question", "menu"
    elif reco_problems(obj) and not obj.get("cartOps"):
        print("[brain] recommendation still invalid → deterministic recommendation")
        guards.append("reco_replaced")
        reply = _reco_fallback(pool, lang, ctx)
        voice = reply if lang == "bn" else ""
        obj["suggestions"] = [{"item": index.ref(it), "reason": ""} for it in pool[:3]]
        topic = "recommendation"
    elif odd_substitutes(obj):
        # still offering soup for dessert after the re-check → a plain, honest answer (+ at most a drink)
        guards.append("odd_substitute_replaced")
        # "we don't have it" + only what's genuinely close (burgers → the fried chicken / sandwich), else just ask
        close = [re.sub(r"\s*\(.*?\)", "", str(c.get("name") or "")).strip() for c in closest_now[:2]]
        kinds = (", ".join(_KIND_BN.get(k, k) for k in missing_now) if lang == "bn" else ", ".join(missing_now))
        if lang == "bn":
            reply = f"দুঃখিত, আমাদের মেনুতে {kinds} নেই।" + (
                f" কাছাকাছি হিসেবে {' অথবা '.join(close)} ট্রাই করতে পারেন — অর্ডার করবেন?" if close else " আর কী খেতে চান, বলুন?")
        else:
            reply = f"Sorry, we don't have {kinds}." + (
                f" The closest we have is {' or '.join(close)} — would you like one?" if close else " What else would you like?")
        voice = reply if lang == "bn" else ""
        # the close dishes (if any) as cards to tap
        obj["suggestions"] = [{"item": index.ref(c), "reason": "closest we have"} for c in closest_now[:2]]
        topic, intent = "availability", ("suggestions" if closest_now else "menu")

    ops, problems = _validate_ops(
        obj.get("cartOps"), index, dict(cart_qty), orderable, transcript, guest_words, context_ids=talked_about, rows=cart_rows,
        pick_said=pick_words,
    )
    # (a line-targeted change is already exact — only item-level ops can be retargeted)
    retargetable = [o for o in ops if o["op"] == "add" or (o["itemId"] in cart_qty and not o.get("lineKey"))]
    fixed = _reconcile_ops_with_words(retargetable, transcript, index)
    fixed += _best_fit_dish(retargetable, transcript, index, orderable)
    counted = _fix_quantities(ops, transcript, index)
    if counted:
        print("[brain] quantities as the guest said them:", counted)
        guards.append("quantity_as_said")
        problems.append("quantity adjusted")  # the model's sentence had its own number → say what really happened
    if fixed:
        print("[brain] retargeted ops to what the guest said:", fixed)
        guards.append("wrong_dish_corrected")
        for o in list(ops):
            if not orderable.get(o["itemId"], True) or (o["op"] != "add" and o["itemId"] not in cart_qty):
                ops.remove(o)
                problems.append(f"{o['name']} can't be changed that way")
        problems.append("retargeted")  # forces the deterministic confirmation line (reply named the wrong dish)
    # a bare "হ্যাঁ, দেন" adds only what the waiter actually offered in its last line (or just before) — never a dish
    # nobody mentioned ("আপনার অর্ডার পাঠানো হয়েছে" → "হ্যাঁ, দেন" once added a Masala Chicken)
    if is_affirmative(transcript) and not find_mentions(transcript, index, limit=1):
        spoken_of = {index.item_id(it) for it in find_mentions(last_waiter, index, limit=8)} | set(rstate.last_offered)
        guessed = [o for o in ops if o["op"] == "add" and o["itemId"] not in spoken_of]
        if guessed:
            ops = [o for o in ops if o not in guessed]
            problems.append("yes to nothing offered")
            guards.append("bare_yes_no_dish")
            if not ops:
                reply = "জি, কী দেব বলবেন?" if lang == "bn" else "Sure — what would you like?"
                voice = reply if lang == "bn" else ""
                topic, intent = "order_change", "menu"
    if options_now:
        # "দশ পিস স্পাইসি, আর একটা কোক দেন": the held wings (now complete) go in with whatever else was ordered —
        # never asked again, even if the model re-added them without their size
        now_ids = {o["itemId"] for o in options_now}
        ops = options_now + [o for o in ops if o["itemId"] not in now_ids]
        problems = [p for p in problems if not (_OPTION_GAP.search(p) and any(p.startswith(f"{o['name']} ") for o in options_now))]
        problems.append("held dishes answered")  # → the deterministic confirmation names every dish added
        guards.append("options_with_new_order")
    # a dish ordered without its size / required choice: held with its quantity, asked about in ONE question, and
    # added when the guest answers next turn (see (a0)). Said a turn or two ago already → added now.
    held_opts = _held_for_options(problems, obj.get("cartOps"), index, guest_words)
    if held_opts and _tray.qty_intent(transcript) == "more":
        # "আরও একটা হট উইংস দেন" with one Hot Wings line (10 pcs, Spicy) in the tray → more of THAT line, not
        # "which size, how spicy?" again
        for e in held_opts:
            same = [r for r in cart_rows if r["itemId"] == e["itemId"]]
            if len(same) == 1:
                e["variant"] = e.get("variant") or same[0].get("variation") or ""
                e["choices"] = list(dict.fromkeys(list(e.get("choices") or []) + [m["name"] for m in same[0].get("modifiers") or []]))
    ready = [e for e in held_opts if not _fill_options(dict(e), index.by_id[str(e["itemId"])], "")]
    if ready:
        ops += [_held_op(e, index) for e in ready]
        problems = [p for p in problems if not (_OPTION_GAP.search(p) and any(p.startswith(f"{e['name']} ") for e in ready))]
        problems.append("options from earlier words")  # → the deterministic confirmation line names them
        guards.append("options_from_earlier_words")
    held_opts = [e for e in held_opts if e not in ready]
    clear = obj.get("clearCart") is True and bool(cart_qty)
    if clear and not _CLEAR_CUE.search(transcript):
        # no clear word from the guest: never emptied on the model's say-so. When its reply SAYS it cleared
        # ("খালি করলাম" — a false claim otherwise) it becomes the same yes / no question below; when it was answering
        # something else ("suggest a smaller order instead" → a dish), the flag is just dropped.
        if re.search(r"খালি|সব(গুলো)? বাদ|মুছে|\b(clear(ed)?|empt(y|ied)|removed? (all|everything))\b", obj.get("replyText") or "", re.I):
            guards.append("clear_unsure_asked")
        else:
            clear = False
            guards.append("clear_blocked")

    # ---- changes that deserve a "sure?" first (the guest's yes next turn applies them exactly)
    sure_q = ""
    sure_choose: List[Dict[str, Any]] = []  # the answers to sure_q as buttons
    # removing every line is "clear everything" — same confirmation — but only when the guest named no dish: "বার্গার
    # আর কোক বাদ দিন" (the only two things) is exactly what they asked for, done without a question
    if (not clear and ops and len(cart_rows) > 1 and all(o["op"] == "remove" for o in ops)
            and not _tray.simulate(cart_rows, ops, False, index.by_id) and not _names_food(transcript, index)):
        clear, ops = True, []
    # a swap keeps the quantity: "স্প্রিং রোলের বদলে চিকেন কর্ন স্যুপ" with 2 Spring Rolls → 2 soups
    if ops and _SWAP_CUE.search(transcript) and _said_quantity(transcript) is None:
        gone = [o for o in ops if o["op"] == "remove" and o.get("lineKey")]
        new = [o for o in ops if o["op"] == "add"]
        if len(gone) == 1 and len(new) == 1 and int(new[0].get("quantity") or 1) == 1:
            old = next((r for r in cart_rows if r["key"] == gone[0]["lineKey"]), None)
            if old and old["quantity"] > 1:
                new[0]["quantity"] = old["quantity"]
                guards.append("swap_kept_quantity")
                problems.append("quantity adjusted")  # the model's sentence said 1 → say what really happened
    if clear and cart_rows:
        # clearing the tray always asks first (pills: yes / no); anything else said in the same breath
        # ("সব বাদ দিয়ে একটা কাচ্চি দিন") happens after the yes
        sure_q, sure_choose = _ask_clear(cart_rows, lang, tstate, [o for o in ops if o["op"] != "remove"])
        ops = []
        clear = False
    elif ops:
        keys_now = {r["key"]: r for r in cart_rows}
        asks: List[str] = []
        # "চিকেন কর্ন স্যুপ দুইটা দাও" with 1 already in the tray: 2 MORE, or 2 in all? The guest's own words decide
        # ("আরও / aro / more" → on top, "মোট / ৪টা করেন / make it" → the total) whatever op the model chose; with
        # neither, it's asked the same way every time (the model sometimes silently made it "set 2").
        qi = _tray.qty_intent(transcript)
        said_n = _said_quantity(transcript) if len(ops) == 1 else None

        def as_add(o: Dict[str, Any], row: Dict[str, Any], q: int) -> Dict[str, Any]:
            new = {"op": "add", "itemId": o["itemId"], "name": o["name"], "quantity": q,
                   **({"variant": o["variant"]} if o.get("variant") else {}), **({"price": o["price"]} if "price" in o else {})}
            if row.get("variation") and not new.get("variant"):
                new["variant"] = row["variation"]
            if row.get("modifiers") and not o.get("choices"):
                new["choices"] = [m["name"] for m in row["modifiers"]]  # the same line (same options), more of it
            return new

        for n, o in enumerate(ops):
            q = int(o.get("quantity") or 0)
            if o["op"] == "set" and o.get("lineKey") in keys_now:
                row = keys_now[o["lineKey"]]
                if qi == "more":
                    # "আরও ৪টা" read as "set 4" (or set to the right total) → 4 on top
                    more = said_n if said_n else (q - row["quantity"] if q > row["quantity"] else q)
                    if more > 0:
                        ops[n] = as_add(o, row, more)
                elif qi is None and q > row["quantity"] and not row.get("modifiers"):
                    ops[n] = as_add(o, row, q)  # unclear → an add, asked below
            elif o["op"] == "add" and qi == "total":
                it_o = index.by_id.get(o["itemId"]) or {}
                key = _tray.line_key(o["itemId"], o.get("variant"), _tray.resolve_choices(it_o, o.get("choices") or []))
                row = keys_now.get(key) or next((r for r in cart_rows if r["itemId"] == o["itemId"] and not o.get("variant")
                                                 and not o.get("choices")
                                                 and sum(1 for x in cart_rows if x["itemId"] == o["itemId"]) == 1), None)
                if row and q > 0:
                    # "মোট ৪টা করেন" read as "add 4" → the tray holds 4
                    ops[n] = {"op": "set", "itemId": o["itemId"], "name": o["name"], "lineKey": row["key"], "quantity": q}
        held: List[Dict[str, Any]] = []  # the ops we ask about (the rest is done now)
        for o in ops:
            q = int(o.get("quantity") or 0)
            if o["op"] in ("add", "set") and q >= _tray.BIG_QTY:
                # "২০টা" can be a mishearing of "২টা" — check before adding a big number
                held.append(o)
                asks.append(f"{q}টা {o['name']} — ঠিক শুনেছি?" if lang == "bn" else f"{q} × {o['name']} — did I hear that right?")
            elif o["op"] == "add" and qi is None:
                it_o = index.by_id.get(o["itemId"]) or {}
                key = _tray.line_key(o["itemId"], o.get("variant"), _tray.resolve_choices(it_o, o.get("choices") or []))
                if key in keys_now:
                    have = keys_now[key]["quantity"]
                    held.append(o)
                    if not sure_choose:  # the two answers as buttons: "হ্যাঁ" adds more, "না, 2টা" makes it the total
                        sure_choose = [
                            {"label": f"হ্যাঁ, মোট {have + q}টা" if lang == "bn" else f"Yes, {have + q} in all",
                             "say": "হ্যাঁ" if lang == "bn" else "yes", "itemId": o["itemId"]},
                            {"label": f"না, মোট {q}টা" if lang == "bn" else f"No, {q} in all",
                             "say": f"না, {q}টা" if lang == "bn" else f"no, {q}", "itemId": o["itemId"]},
                        ]
                    asks.append(
                        f"আপনার ট্রেতে আগে থেকেই {have}টা {o['name']} আছে — আরও {q}টা যোগ করে মোট {have + q}টা করব?"
                        if lang == "bn" else
                        f"You already have {have} × {o['name']} — add {q} more, making {have + q}?"
                    )
        if asks:
            # what's clear is done now ("3টা French Fry যোগ করলাম।"), only the unsure part waits for the answer
            tstate["pending"] = {"kind": "confirm_change", "ops": held, "clear": False}
            ops = [o for o in ops if o not in held]
            if len(held) > 1:
                sure_choose = []  # (two questions at once → answered in words)
            done_now = _cart_change_reply(ops, False, index, {}, lang, restaurant, with_summary=False) if ops else ""
            sure_q = (done_now + " " + " ".join(asks)).strip()
            tstate["pending"]["question"], tstate["pending"]["buttons"] = " ".join(asks), list(sure_choose)
    if sure_q:
        reply = sure_q
        voice = reply if lang == "bn" else ""
        topic, intent = "order_change", "order"
        obj["suggestions"] = []
        problems = [p for p in problems if "retarget" not in p]
        guards.append("asked_sure")

    rows_after = _tray.simulate(cart_rows, ops, clear, index.by_id)
    final_qty: Dict[str, int] = {}
    for r in rows_after:
        final_qty[r["itemId"]] = final_qty.get(r["itemId"], 0) + r["quantity"]
    if ops or clear:
        rec = _tray.change_record(cart_rows, rows_after)
        if rec:
            tstate["last_change"] = rec
    for o in ops:
        label = ", ".join([*([o["variant"]] if o.get("variant") else []), *(o.get("choices") or [])])
        if label and o["op"] in ("add", "set", "note"):
            size_label[o["itemId"]] = label
        if isinstance(o.get("price"), (int, float)):
            unit_price[o["itemId"]] = float(o["price"])
    clar = ""
    choose: List[Dict[str, Any]] = list(sure_choose) if sure_q else []
    if problems:
        print("[brain] dropped ops:", problems)
        guards.append("cart_change_blocked")
        # the model still claims it added something we refused → never let that reach the guest
        asked = [p for p in problems if any(k in p for k in _ASK_INSTEAD)]
        clar = _clarify_reply(problems, index, lang) if asked else ""
        if held_opts and not sure_q:
            # everything the held dishes still need, in one question — and remember them for the answer
            others_q = _clarify_reply([p for p in problems if not _OPTION_GAP.search(p)], index, lang)
            clar = " ".join(x for x in [others_q, _options_question(held_opts, index, lang)] if x)
            tstate["pending"] = {"kind": "options", "items": held_opts}
            guards.append("options_held")
        # …and the answers as buttons: one tap sends the full dish name (never misheard)
        choose = _choice_options(problems, index, lang, obj.get("cartOps")) if clar and not sure_q else choose
        # asked for something sold out → say so, and the two closest dishes we CAN make now, as buttons
        gone = [index.resolve(None, p.split(" is not orderable now")[0]) for p in problems if "is not orderable now" in p]
        gone = [g for g in gone if g]
        if gone and not clar and not sure_q:
            clar, choose = _sold_out_reply(gone, index, orderable, blocked, lang, set(cart_qty))
            asked = asked or ["sold out"]
        elif gone and clar and not sure_q:
            # asking about a size / choice too: say what can't be made first, then the one question
            clar = _sold_out_head(gone, lang) + " " + clar
        claims = _CLAIMS_ADDED.search(reply) or _CLAIMS_CHANGED.search(reply)
        if not ops and not clear and clar and (claims or "?" not in reply or held_opts):
            # we need to ask (which line / which dish / which size) — say exactly that, never "done"
            reply, voice = clar, (clar if lang == "bn" else "")
            topic, intent = "order_change", "menu"
            guards.append("clarify_instead_of_change")
        elif not ops and not clear and claims:
            asked_q = [p for p in problems if "asked a question, not for an order" in p]
            if asked_q and not clar:
                # "চিকেন সিজলিং কি ঝাল?" + the model "added" it → keep its ANSWER, drop the false "added", and offer it
                keep = [s for s in re.findall(r"[^।.!?]+[।.!?]?", reply or "")
                        if s.strip() and not (_CLAIMS_ADDED.search(s) or _CLAIMS_CHANGED.search(s))]
                dish = asked_q[0].split(":")[0].strip()
                offer = f"{dish} অর্ডার করবেন?" if lang == "bn" else f"Would you like to order the {dish}?"
                reply = (" ".join(x.strip() for x in keep) + " " + offer).strip()
                topic, intent = "menu_question", "menu"
            else:
                reply = clar or _reco_fallback(pool, lang, ctx)
                topic, intent = ("order_change", "menu") if clar else ("recommendation", "suggestions")
            voice = reply if lang == "bn" else ""
            guards.append("false_added_claim_replaced")
    # the reply says it added / changed something, but NOTHING changed in the tray (no op at all) — e.g.
    # "মিনারেল ওয়াটার বড় সাইজে বদলে দিলাম" with no cart change. Never tell the guest it's done when it isn't.
    # (a sentence ending in "?" is an offer — "…৳300 — added?" / "যোগ করব?" — not a claim)
    claim_said = any((_CLAIMS_ADDED.search(s) or _CLAIMS_CHANGED.search(s)) and not s.rstrip().endswith("?")
                     for s in re.findall(r"[^।.!?]+[।.!?]?", reply or ""))
    # "স্প্রিং রোলটা বাদ দেন" — take out something that ISN'T in the tray → say so, and what is there (as buttons)
    tray_words = set().union(*[_name_tokens(str(r.get("name") or "")) for r in cart_rows]) if cart_rows else set()
    take_out = bool(_TAKE_OUT.search(transcript)) or (
        bool(_DONT_NEED.search(transcript)) and bool(_dishes_named(transcript, index, limit=1)))
    if (not ops and not clear and not sure_q and cart_rows is not None and take_out and not is_done_ordering(transcript)
            and "?" not in transcript and not (_guest_tokens(transcript, _menu_rev(index)) & tray_words)
            and not _tray.ALL_WORDS.search(transcript) and not _CLEAR_CUE.search(transcript)):
        reply, choose = _not_in_tray_reply(transcript, index, cart_rows, lang)
        voice = reply if lang == "bn" else ""
        topic, intent = "order_change", "order"
        obj["suggestions"] = []
        guards.append("not_in_tray")
    elif not ops and not clear and not problems and not sure_q and claim_said and cart_rows is not None:
        reply = ("দুঃখিত, ঠিক কী বদলাবো বুঝতে পারিনি — আরেকবার বলবেন? যেমন: \"ছোটটা বাদ দিয়ে বড়টা দিন\"।" if lang == "bn"
                 else "Sorry, I didn't catch what to change — could you say it again? For example: \"make it the large one\".")
        voice = reply if lang == "bn" else ""
        topic, intent = "order_change", "menu"
        guards.append("false_change_claim_replaced")

    decision: Dict[str, Any] = {"showSuggestionsModal": False, "showUpsellTray": False}

    # garbled speech the model couldn't make sense of → a polite "please say it again", nothing else
    if obj.get("understood") is False and not ops and not clear:
        reply = _SORRY_REPEAT["bn" if lang == "bn" else "en"]
        voice = reply if lang == "bn" else ""
        obj["suggestions"], topic, intent = [], "other", "chitchat"
        guards.append("not_understood")

    # ---- checkout: the model's reading of the guest + the phrase rules + the stage → one action
    llm_ck = obj.get("checkout") if obj.get("checkout") in ("none", "start", "confirm", "cancel") else (
        "confirm" if obj.get("confirmOrder") is True else "none"
    )
    rows_now = rows_after
    action, why = co.decide(
        text=transcript, stage=stage, stored_signature=str(ck.get("sig") or ""),
        signature_now=co.cart_signature(rows_now), cart_nonempty=bool(rows_now), table=table, llm_checkout=llm_ck,
        asked_to_confirm=asked_confirm, cart_changed_this_turn=bool(ops) or clear, cleared=clear,
        defer_done=mode == "last_call", list_on_screen=bool(shown_ids), direct_pending=bool(ck.get("direct")),
    )
    if problems and action in ("place", "readback", "ask_table"):
        # we're asking which dish / size first — the order isn't settled yet
        action, why = ("reset" if stage != "none" else "stay"), "cart change needs a clarification first"
    if sure_q:
        action, why = "stay", "asked the guest to confirm a tray change first"
    if action in ("readback", "place") and rows_now:
        gone = [w for w in _tray.warnings(rows_now, index.by_id, orderable, lambda _it: []) if w["kind"] == "unavailable"]
        if gone:  # sort out what can't be ordered before reading back / placing
            names = ", ".join(w["name"] for w in gone)
            tstate["pending"] = {"kind": "unavailable", "clear": False,
                                 "ops": [{"op": "remove", "itemId": w["itemId"], "name": w["name"], "lineKey": w["lineKey"]} for w in gone]}
            reply = (f"অর্ডার দেওয়ার আগে একটা কথা: {names} এখন পাওয়া যাচ্ছে না ({gone[0]['reason']})। ওটা বাদ দিয়ে দেব?"
                     if lang == "bn" else f"Before I place it: {names} can't be ordered right now ({gone[0]['reason']}). Shall I remove it?")
            tstate["pending"]["question"] = reply
            voice = reply if lang == "bn" else ""
            action, why = ("reset" if stage != "none" else "stay"), "a line can't be ordered now"
            sure_q = reply
    if llm_ck in ("start", "confirm") and action == "stay" and stage == "none":
        guards.append("confirm_blocked")
    ops_line = (
        _cart_change_reply(ops, clear, index, final_qty, lang, restaurant, unit_price, size_label, with_summary=False)
        if ops else ""
    )
    ck_text, ck_flags, new_ck = _checkout_turn(
        action, rows=rows_now, table=table, lang=lang, restaurant=restaurant, prev=ck, transcript=transcript,
        ops_line=ops_line,
        eta_hint=wtalk.eta_hint(wtalk.cart_estimate(rows_now, index.by_id, kitchen), lang) if kitchen else "",
        online=online,
    )
    if action != "stay":
        print(f"[brain] checkout: {action} ({why}) table={table}")
    checkout_spoke = ck_text is not None
    decision.update(ck_flags)
    if choose and not checkout_spoke:
        decision["chooseOptions"] = choose  # the "which one?" answers as buttons (the app sends the tapped `say`)
    if checkout_spoke:
        reply = ck_text
        voice = reply if lang == "bn" else ""
        intent, topic = "order", "confirm_order"
    elif _CLAIMS_CONFIRMED.search(reply) and not (clear and _CLAIMS_CANCELLED.search(reply)):
        # the model says the order was placed / taken / cancelled, but nothing like that happened → never say it
        summary, total, _n = _tray.summary(rows_after)
        vat = _vat_hint(restaurant, lang)
        if stage == "table" and summary and not table:
            # still waiting for the table number — ask for it again instead of pretending
            reply = co.ask_table_text(lang)
        elif summary:
            reply = (f"এখন আপনার অর্ডারে: {summary} — মোট {_money(total)}{vat}। অর্ডারটা দিয়ে দেব?" if lang == "bn"
                     else f"Your order: {summary} — {_money(total)}{vat}. Shall I confirm it?")
        else:
            reply = "আপনার ট্রে এখনো খালি — কী নেবেন?" if lang == "bn" else "Your order is still empty — what would you like?"
        voice = reply if lang == "bn" else ""
        guards.append("false_confirm_claim_replaced")

    # Cart changed: the spoken reply must match what actually happened.
    if ops or clear:
        intent = "order"
        if not checkout_spoke:
            cut = _strip_pitches(reply, {o["itemId"] for o in ops} | set(final_qty), index)
            if cut != reply:
                print("[brain] model pitch cut:", reply[:120])
                reply, voice = cut, (cut if lang == "bn" else voice)
                guards.append("model_pitch_removed")
        consistent = bool(reply) and all(_reply_mentions(reply, op["name"]) for op in ops)
        if checkout_spoke:
            consistent = True  # the checkout line already says what changed and reads back the order
        # "Would you like me to add these?" while we ARE adding them → the guest would add them twice
        if any(op["op"] == "add" for op in ops) and _OFFERS_TO_ADD.search(reply):
            consistent = False
            guards.append("offer_while_adding_fixed")
        # a size or paid add-on changes the price — the guest must hear the right one
        for op in ops:
            if op["op"] == "add" and isinstance(op.get("price"), (int, float)):
                amounts = {int(round(op["price"])), int(round(op["price"] * op.get("quantity", 1)))}
                if not (set(_amounts(reply)) & amounts):
                    consistent = False
        # "X isn't on the menu" while we ARE adding X → the guest hears the opposite of what happened
        if not checkout_spoke and _contradicts_adds(reply, [op["name"] for op in ops if op["op"] == "add"]):
            consistent = False
            guards.append("added_but_said_unavailable")
        if clar and ops and not checkout_spoke:
            # some of it was clear, one thing wasn't: add what was clear, then ask only about the rest
            # ("২টা Chicken Cashew Nut Salad যোগ করলাম। মিনারেল ওয়াটার — ছোট নাকি বড়?")
            reply = _cart_change_reply(ops, clear, index, final_qty, lang, restaurant, unit_price, size_label,
                                       with_summary=False) + " " + clar
            voice = reply if lang == "bn" else ""
            guards.append("added_clear_asked_rest")
        elif problems or not consistent:
            reply = _cart_change_reply(ops, clear, index, final_qty, lang, restaurant, unit_price, size_label, rows=rows_after)
            voice = reply if lang == "bn" else ""
        elif ops and rows_after and not checkout_spoke:
            # the tray changed → always end with "anything else, or shall I confirm the order?"
            reply = _ask_anything_else_or_confirm(reply, lang)
            voice = reply if lang == "bn" else voice
    elif intent == "order" and not checkout_spoke:
        # Order talk without changes: reviews and "that's all" keep the tray open; anything else
        # (e.g. asking which curries) is just conversation. items[] stays empty either way.
        if topic != "order_review" and not is_done_ordering(transcript):
            intent = "menu"

    if problems and not ops and not reply:
        reply = "Sorry — which one did you mean?" if lang == "en" else "দুঃখিত, কোনটা বোঝালেন?"

    # Suggestions (validated, orderable only)
    suggestions: List[Dict[str, Any]] = []
    for s in obj.get("suggestions") or []:
        if not isinstance(s, dict):
            continue
        it = index.resolve(s.get("item") or s.get("itemId"), s.get("name") or s.get("title"))
        if it and may_recommend(it) and all(x["itemId"] != index.item_id(it) for x in suggestions):
            suggestions.append(_suggestion_row(it, str(s.get("reason") or "")[:60]))
    suggestions = suggestions[:5]
    if ops or clear:
        suggestions = []  # A: a cart change brings no cards — only the offer engine's one offer (meta.upsell)
    if not (ops or clear) and (short_no or upsell_engine._NO.search(transcript) or is_decline(transcript)
                               or _CLARIFY_ASK.search(last_waiter or "")):
        # a "no" (or the turn after a misunderstanding) is never answered with a new dish to try: no cards, no pitch
        # (it once got "…না হলে হট উইংস-ও নিতে পারেন" + three cards after "বললাম যে না থাক")
        suggestions = []
        cut = _strip_pitches(reply, set(cart_qty), index)
        if cut != reply:
            reply = cut or (("ঠিক আছে! আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if cart_rows else "ঠিক আছে।") if lang == "bn"
                            else ("No problem! Anything else, or shall I confirm your order?" if cart_rows else "Okay."))
            voice = reply if lang == "bn" else ""
            guards.append("no_pitch_after_no")
    # "ট্রিপ্ল চিজ টাওআরটা কেমন হবে?" — a question about ONE dish is answered about that dish and ends on it ("…এটা
    # দেব?"); another dish is pitched only when it helps (this one is off, too spicy, over budget, clashes with a diet).
    # It once ended "…হট উইংস ট্রাই করতে চান?" — Hot Wings cards, and a "হ্যাঁ" would have added Hot Wings, not the Tower.
    asked_dish = _dishes_named(transcript, index, limit=2) if not (ops or clear or checkout_spoke or about_shown) else []
    if (len(asked_dish) == 1 and mode != "overview" and not _WANTS_OTHER.search(transcript)
            and orderable.get(index.item_id(asked_dish[0]), True)
            and not [v for v in violations(asked_dish[0], profile) if v.startswith("allergy") or v in _DIET_CLASH]):
        keep = set(cart_qty) | {index.item_id(asked_dish[0])}
        cut = _strip_pitches(reply, keep, index)
        if cut != reply and cut:
            in_tray = index.item_id(asked_dish[0]) in cart_qty
            ask = ((" আর কিছু লাগবে?" if in_tray else " এটা দেব?") if lang == "bn"
                   else (" Anything else?" if in_tray else " Shall I add it?"))
            reply = cut if cut.rstrip().endswith("?") else cut.rstrip() + ask
            if voice:
                v_cut = _strip_pitches(voice, keep, index)
                voice = (v_cut if v_cut.rstrip().endswith("?") else v_cut.rstrip() + ask) if v_cut else reply
            suggestions = []  # the dish they asked about is the answer — no other dishes as cards
            guards.append("stayed_on_asked_dish")
    if mode in ("quiet", "complement", "last_call"):
        suggestions = []  # the policy said: no recommendation cards this turn
    if checkout_spoke or (about_shown and shown_on_screen):
        suggestions = []  # comparing the list on screen: that list stays — the answer is highlighted in it
    if about_shown and not shown_on_screen and not ops and not checkout_spoke:
        # "ভালো কোনটা হবে?" about dishes we only SAID (nothing on screen) → show them as cards, the pick first
        picked = [i for i in _answer_items(obj, reply, index, shown_ids) if i in index.by_id]
        order = picked + [i for i in shown_ids if i not in picked]
        suggestions = [_suggestion_row(index.by_id[i]) for i in order if may_recommend(index.by_id[i])][:6]
        intent = "suggestions" if suggestions else intent
    if mode == "overview" and not ops and not checkout_spoke and len(suggestions) < 3:
        # the tour's highlights as cards: what the reply named, topped up from the ranked picks
        seen = {s["itemId"] for s in suggestions}
        for it in find_mentions(reply, index, limit=6) + [p.item for p in picks]:
            if index.item_id(it) not in seen and orderable.get(index.item_id(it), True) and may_recommend(it):
                suggestions.append(_suggestion_row(it, ", ".join(next((p.reasons for p in picks if p.item is it), [])[:1])))
                seen.add(index.item_id(it))
            if len(suggestions) >= 4:
                break
        intent = "suggestions" if suggestions else intent
    if not (ops or clear or checkout_spoke or about_shown or mode == "overview"):
        if topic == "recommendation" and not suggestions:
            # the model recommended in words only → show those dishes as cards too
            suggestions = [_suggestion_row(it) for it in find_mentions(reply, index, limit=5) if may_recommend(it)]
        # "what drinks / curries do you have?" — the answer is a list to pick from → show it as cards
        if len(suggestions) < 2 and topic != "recommendation":
            kind_ids = {index.item_id(i) for _, items in kind_items(transcript, index) for i in items}
            named = [it for it in find_mentions(reply, index, limit=8) if orderable.get(index.item_id(it), True)]
            listed = [it for it in named if index.item_id(it) in kind_ids] if kind_ids else (
                named if topic in ("availability", "item_question", "price") and len(named) >= 3 else []
            )
            if len(listed) >= 2:
                suggestions = [_suggestion_row(it) for it in listed[:6]]
                intent = "suggestions"
        # the waiter recommended something → it appears as a card to tap (one dish is still a suggestion)
        if topic == "recommendation" and suggestions:
            intent = "suggestions"
        elif intent == "chitchat" and topic in ("item_question", "dietary", "price", "availability", "restaurant_info", "recommendation"):
            intent = "menu"
    if not (ops or clear or checkout_spoke) and not (about_shown and shown_on_screen):
        named = [it for it in find_mentions(reply, index, limit=8)
                 if index.item_id(it) not in final_qty and orderable.get(index.item_id(it), True) and may_recommend(it)]
        if len(named) >= 2 and len(named) + len(suggestions) >= 3:
            seen = {s["itemId"] for s in suggestions}
            suggestions = (suggestions + [_suggestion_row(it) for it in named if index.item_id(it) not in seen])[:6]
            intent = "suggestions"
            guards.append("list_as_cards")
    # a recommendation is at least 3 cards to choose from (one only when they asked for exactly one): the model
    # sometimes names a single dish — top up from the ranked picks (already fitted to this guest), same kind first
    # …whatever kind of turn it is (a greeting or an answer that suggests a dish counts too). A dish the reply
    # merely talks about because the guest asked about it is not a suggestion.
    if (not suggestions and mode not in ("quiet", "complement", "last_call") and not (ops or clear or checkout_spoke)
            and not (about_shown and shown_on_screen)):
        asked_about = set(mentioned_now) | {index.item_id(it) for it in _dishes_named(transcript, index)}
        pitched = [it for it in find_mentions(reply, index, limit=3)
                   if index.item_id(it) not in asked_about and index.item_id(it) not in final_qty
                   and orderable.get(index.item_id(it), True) and may_recommend(it)]
        if pitched:
            suggestions = [_suggestion_row(it) for it in pitched]
    recommending = mode not in ("quiet", "complement", "last_call")
    # "সিজলিং এর মধ্যে কোনটা ভালো?" → sizzling cards only, even if the model slipped in a soup
    scoped_out = False
    if kind_scope and suggestions and not ops:
        inside = [s for s in suggestions if s.get("itemId") in kind_scope]
        scoped_out = not inside
        suggestions = inside
    if (recommending and (suggestions or scoped_out) and len(suggestions) < 3
            and "odd_substitute_replaced" not in guards  # "we don't have it — the closest is…": only what's close and not (ops or clear or checkout_spoke)
            and not (about_shown and shown_on_screen) and not _ASKED_FOR_ONE.search(transcript)):
        seen = {s["itemId"] for s in suggestions} | set(final_qty)
        cats = {(index.by_id.get(s["itemId"]) or {}).get("category") for s in suggestions}
        pool_items = [p.item for p in picks if index.item_id(p.item) not in seen and may_recommend(p.item)
                      and orderable.get(index.item_id(p.item), True)]
        pool_items.sort(key=lambda it: it.get("category") not in cats)  # same kind of dish first
        reasons = {index.item_id(p.item): ", ".join(p.reasons[:1]) for p in picks}
        for it in pool_items[: 3 - len(suggestions)]:
            suggestions.append(_suggestion_row(it, reasons.get(index.item_id(it), "")))
        intent = "suggestions"
        guards.append("topped_up_to_three")
    # "বাকিগুলো স্ক্রিনে দিলাম" / "I've put the others on your screen" — the guest can see the cards
    reply = _SCREEN_TALK.sub("", reply).strip()
    # "ভাত" is plain rice — on a menu that has none, the model meant the fried rice ("ভাত আর সবজি" → Fried Rice & Vegetable)
    if lang == "bn" and not _HAS_PLAIN_RICE(index):
        reply = _no_bhat(reply)
        if voice:
            voice = _no_bhat(voice)
    # menu-category filler read out as a word ("বিফ সেলেক্টিওন, চিকেন সেলেক্টিওন…") → just "বিফ, চিকেন…"
    reply = _no_filler(reply)
    if voice:
        voice = _no_filler(voice)
    # a recommendation's question is about ORDERING (the waiter's own words; only "নিতে চান / নেবেন / দেব" swapped)
    if intent == "suggestions" and suggestions and not (ops or clear or checkout_spoke):
        reply = _order_wording(reply, lang)
        if voice and lang == "bn":
            voice = _order_wording(voice, lang)
    if voice:
        voice = _SCREEN_TALK.sub("", voice).strip()
    if intent == "suggestions" and not suggestions:
        intent = "menu"
    if intent == "suggestions":
        decision["showSuggestionsModal"] = True
    # only an explicit "show me the menu" opens the menu page ("menu" intent = a question about dishes)
    if _SEE_MENU.search(transcript):
        decision["openMenu"] = True

    # ready-made things (water, Coke, 7Up) are never praised — "অনেকেই পছন্দ করেন", "দারুণ" about a bottle of water
    # is not what a waiter says. Such a sentence becomes a plain offer (or goes, if the offer is already there).
    reply, praised = _no_praise_for_packaged(reply, index, lang)
    if praised:
        voice = _no_praise_for_packaged(voice, index, lang)[0] if voice else voice
        guards.append("packaged_praise_removed")
    # ---- THE offer after food is added (offers.py): the one biggest gap of THIS meal — a combo that saves money, more
    # for a group, a side, a cold drink with spicy food, an extra for the dish — in place of "আর কিছু লাগবে…?".
    # Never on a correction (anything but adds), a question we asked, a clarification or during checkout.
    upsell: List[Dict[str, Any]] = []
    if (ops and not clear and not checkout_spoke and not clar and not sure_q and mode != "quiet"
            and all(op["op"] == "add" for op in ops) and upsell_engine.ends_with_closing(reply)):
        o = offer_for("first_add", rows_after, ops)
        if o:
            reply = offers.swap_closing(reply, o.text)
            if voice:
                voice = offers.swap_closing(voice, o.text)
            hold_offer(o)
            if o.card:
                upsell = [o.card]
                decision["showUpsellTray"] = True
            guards.append(f"offer_{o.type}")

    # ---- remember what we learned and what we pitched (next turn's policy depends on it)
    learned = _prefs_from_model(obj.get("guestPrefs"), index)
    profile = profile.merge(learned, replace_mood=False)
    offered: List[str] = [s["itemId"] for s in suggestions] + [u["itemId"] for u in upsell]
    if mode in ("full", "greet", "answer", "overview") and not ops:
        offered += [
            index.item_id(it) for it in find_mentions(reply, index, limit=4)
            if index.item_id(it) not in final_qty and index.item_id(it) not in mentioned_now and may_recommend(it)
        ]
    if not ops and reply.rstrip().endswith("?"):
        asked_about = find_mentions(reply, index, limit=2)
        if len(asked_about) == 1 and index.item_id(asked_about[0]) not in final_qty:
            offered = [index.item_id(asked_about[0])] + offered  # "X দেব?" → "হ্যাঁ" adds X
    offered = list(dict.fromkeys(offered))
    # the dishes of the on-screen list the answer points to — highlighted on the guest's screen
    highlight = _answer_items(obj, reply, index, shown_ids) if about_shown else []
    if about_shown and not ops:
        offered = highlight or shown_ids  # "দিন" next → the one it pointed at (or asks which, if several)
    rstate.turn += 1
    if offered:
        rstate.last_offered, rstate.last_offer_turn = offered, rstate.turn
        rstate.recent = list(dict.fromkeys(offered + rstate.recent))[:12]
    rstate.profile = profile.to_dict()

    service = obj.get("serviceRequest") if isinstance(obj.get("serviceRequest"), dict) else None
    if service and service.get("type") not in SERVICE_TYPES:
        service = None

    mentioned = []
    for ref in obj.get("mentionedItems") or []:
        it = index.resolve(ref)
        if it:
            mentioned.append({"itemId": index.item_id(it), "name": it.get("name")})
    for op in ops:
        if all(m["itemId"] != op["itemId"] for m in mentioned):
            mentioned.append({"itemId": op["itemId"], "name": op["name"]})

    if not reply:
        text, _ = _fallback_reply(transcript, lang, index, orderable)
        reply = text
    reply = _with_plan_total(reply, plan, index, lang, restaurant) if (plan and price_talk and not ops and not clear) else reply
    if _KITCHEN_CLAIM.search(reply):
        reply = _fix_kitchen_claim(reply, ops, lang)
        voice = reply if lang == "bn" else voice
        guards.append("kitchen_claim_fixed")
    reply = _western_prices(reply)

    # the tray as a whole: a line that clashes with the guest's allergy/diet, or can't be ordered now, is said
    # once (also for things added by tapping) and flagged on the tray screen
    cart_warnings = _tray.warnings(rows_after, index.by_id, orderable, clash)
    warned = set(tstate.get("warned") or [])
    fresh = [w for w in cart_warnings if w["lineKey"] not in warned]
    if fresh and not checkout_spoke and not sure_q:
        w = fresh[0]
        if w["kind"] == "unavailable":
            tip = (f" খেয়াল করবেন: {w['name']} এখন পাওয়া যাচ্ছে না — বদলে অন্য কিছু দেব?" if lang == "bn"
                   else f" Heads up: {w['name']} can't be ordered right now — shall I swap it for something else?")
        else:
            tip = (f" খেয়াল করবেন: আপনি যা বলেছেন, সেই হিসেবে {w['name']} আপনার জন্য ঠিক না-ও হতে পারে ({w['reason']}) — বদলে দেব?"
                   if lang == "bn" else f" Heads up: {w['name']} may not suit you ({w['reason']}) — want me to swap it?")
        reply = reply.rstrip() + tip
        voice = (voice.rstrip() + tip) if (voice and lang == "bn") else voice
        guards.append("tray_warning")
    tstate["warned"] = list((warned | {w["lineKey"] for w in cart_warnings}))[-50:]

    if (pending and stage == "none" and not tstate.get("pending") and not ops and not clear and not checkout_spoke
            and (obj.get("understood") is False or _CLARIFY_ASK.search(reply or ""))):
        q_open, q_buttons = _pending_question(pending, index, cart_rows, lang)
        if q_open:
            tstate["pending"] = pending
            reply = ("দুঃখিত, ঠিক বুঝতে পারিনি। " if lang == "bn" else "Sorry, I didn't quite catch that. ") + q_open
            voice = reply if lang == "bn" else ""
            suggestions, intent, topic = [], "chitchat", "other"
            decision["showSuggestionsModal"] = False
            if q_buttons:
                decision["chooseOptions"] = q_buttons
            guards.append("reasked_open_question")

    if lang == "bn" and not voice:
        voice = reply

    meta = _base_meta(
        language=lang,
        intent=intent,
        topic=topic,
        # full cart only when the UI has ops to apply (the order-intent fallback re-adds items[])
        items=_items_payload(index, final_qty) if (ops or clear or decision.get("placeOrder")) else [],
        suggestions=suggestions,
        upsell=upsell,
        decision=decision,
        cartOps=ops,
        clearCart=clear,
        serviceRequest=service,
        mentionedItems=mentioned[:6],
        **ids,
    )
    meta["reco"] = rstate.to_dict()
    meta["checkout"] = new_ck
    if carry_options and tstate.get("pending") is carry_options and (
            clear or any(o.get("itemId") in {e["itemId"] for e in carry_options["items"]} for o in ops)):
        tstate["pending"] = None  # the model added the held dish itself this turn — nothing left to wait for
    meta["tray"] = tstate
    attach_offer(meta)
    meta["cartWarnings"] = cart_warnings
    if about_shown:
        meta["highlight"] = highlight
        if shown_on_screen:  # the list stays on screen; otherwise the cards above are a new list
            meta["onScreen"] = shown_ids
    if decision.get("placeOrder"):
        meta["orderDraft"] = _order_draft(rows_now, table or "", co.cart_signature(rows_now))
    meta["guards"] = list(dict.fromkeys(guards))
    meta["recoMode"] = mode
    meta["guestProfile"] = profile.summary()
    if voice and lang == "bn":
        meta["voiceReplyText"] = voice
    print("[brain] reply:", reply, "| intent:", intent, "| mode:", mode, "| ops:", ops, "| clear:", clear)
    return {"replyText": reply, "meta": meta}


_COMPARATIVE = re.compile(
    r"সবচেয়ে|সব থেকে|সবথেকে|সবার চেয়ে|সবার থেকে|"
    r"\b(most|least|best|cheapest|mildest|spiciest|lightest|lowest|highest)\b",
    re.I,
)


def _answer_items(obj: Dict[str, Any], reply: str, index: MenuIndex, shown_ids: List[str]) -> List[str]:
    """The dish(es) the answer PICKS (highlighted on screen) — not every dish the reply mentions.
    The model names them in answerItems; otherwise the dish in the sentence that makes the comparison."""
    picked = []
    for ref in obj.get("answerItems") or []:
        it = index.resolve(ref)
        if it and index.item_id(it) in shown_ids and index.item_id(it) not in picked:
            picked.append(index.item_id(it))
    if picked:
        return picked[:2]
    for sentence in re.split(r"(?<=[.!?।])\s+", reply or ""):
        if _COMPARATIVE.search(sentence):
            hits = [index.item_id(it) for it in find_mentions(sentence, index, limit=4) if index.item_id(it) in shown_ids]
            if hits:
                return hits[:1]
    return []


def _prefs_from_model(raw: Any, index: MenuIndex) -> GuestProfile:
    """The model's reading of the guest (validated: known enums only, dish refs → ids)."""
    if not isinstance(raw, dict):
        return GuestProfile()

    def ints(v: Any, lo: int, hi: int) -> int:
        try:
            n = int(v)
        except (TypeError, ValueError):
            return 0
        return n if lo <= n <= hi else 0

    def refs(v: Any) -> List[str]:
        out = []
        for r in v if isinstance(v, list) else []:
            it = index.resolve(r)
            if it:
                out.append(index.item_id(it))
        return out

    return GuestProfile(
        diet=[d for d in raw.get("diet") or [] if d in DIETS],
        allergies=[a for a in raw.get("allergies") or [] if a in ALLERGENS],
        avoid=[str(a).strip().lower()[:30] for a in raw.get("avoid") or [] if str(a).strip()][:6],
        spice=raw.get("spice") if raw.get("spice") in SPICE else "",
        budget=ints(raw.get("budget"), 50, 1_000_000),
        party_size=ints(raw.get("partySize"), 2, 30),  # "I'll take one" isn't a party of one
        vegetarians_in_party=ints(raw.get("vegetariansInParty"), 1, 30),
        kids=raw.get("kids") is True,
        mood=[m for m in raw.get("mood") or [] if m in MOODS],
        declined=refs(raw.get("declined")),
        liked=refs(raw.get("liked")),
    )


__all__ = ["generate_reply"]
