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
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

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
import bangla_meal
import followups
import menu_answers
import bhorta_bhaji
import pairing
import knowledge
import menu_profile
import reco_format
import intent as intent_mod
import upsell as upsell_engine
import offers
from menu_profile import glance_line
from waiter_knowledge import (
    MenuIndex,
    _norm,
    cart_lines,
    explicitly_asked,
    find_mentions,
    is_affirmative,
    is_done_ordering,
    is_explicit_confirm,
    is_side,
    is_signature,
    item_hints,
    kind_items,
    kind_text,
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
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4.1").strip()
# experiment: the model answers menu questions and orders itself — the word-pattern answers before it are skipped
AI_FIRST = os.environ.get("WAITER_AI_FIRST", "").strip() == "1"
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

# AI-first: the model also lists every food / drink it named, and the code checks each one is on the menu (it once
# offered Fanta and Sprite, and described a teriyaki platter the restaurant doesn't have)
RESPONSE_SCHEMA_AI_FIRST: Dict[str, Any] = {
    **RESPONSE_SCHEMA,
    "required": [*RESPONSE_SCHEMA["required"], "foodsNamed"],
    "properties": {**RESPONSE_SCHEMA["properties"], "foodsNamed": {"type": "array", "items": _STR}},
}
FOODS_NAMED_FIELD = ("# Field foodsNamed\nEvery specific dish, drink or brand you name in replyText, exactly as you wrote "
                     "it, and every one the guest asked about (not general words like rice, fish, curry, drinks). [] if "
                     "none. Name MENU dishes by their MENU name.")


def _unknown_foods(names: Any, index: MenuIndex) -> List[str]:
    """The foods / drinks the model named that match nothing on this menu — not a dish, nor part of one's name,
    description or category."""
    from rapidfuzz import fuzz

    names_on_menu = [_norm(re.sub(r"\s*\(.*?\)", " ", str(it.get("name") or ""))) for it in index.items]
    hay = [_norm(x) for it in index.items for x in (
        it.get("name"), to_bangla_script(str(it.get("name") or "")), it.get("description"), it.get("category"),
        *(it.get("aliases") or []), *[v.get("name") for v in it.get("variations") or [] if isinstance(v, dict)]) if x]
    out = []
    for n in names if isinstance(names, list) else []:
        n = str(n or "").strip()
        # (the model may write a Bangla menu's dish in English: "Chicken Jhal Fry" is চিকেন ঝাল ফ্রাই — it once
        # told a guest that dish wasn't on the menu)
        keys = {k for k in (_norm(re.sub(r"\s*\(.*?\)", " ", x)) for x in (n, to_bangla_script(n))) if len(k) >= 2}
        if not keys or any(index.resolve(None, x) or find_mentions(x, index, 1) for x in (n, to_bangla_script(n))):
            continue
        if any(k in h for k in keys for h in hay):
            continue
        if any(fuzz.ratio(k, h) >= 80 for k in keys if len(k) >= 5 for h in names_on_menu):
            continue  # another spelling of a dish's name ("চিকেন ঝালফ্রাই", "Chicken Jhal-Fry")
        out.append(n)
    return out


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
# a meal named in the question ("বিকেলের মেনুতে…", "দুপুরে কী খাওয়া যায়", "for breakfast") → that meal's kind
_MEAL_WORDS = (
    ("afternoon", r"বিকেল|বিকাল|বৈকাল|\bafternoon\b|\bbikel\b|evening snacks?|\bteatime\b"),
    ("breakfast", r"সকাল|ভোর|নাশতা করতে|\bbreakfast\b|\bmorning\b|\bsokal\b"),
    ("lunch", r"দুপুর|\blunch\b|\bdupur\b"),
    ("dinner", r"রাতের খাবার|রাতে|রাত্রে|ডিনার|সন্ধ্যা|\bdinner\b|\bsupper\b|\bevening\b"),
    ("late", r"মাঝরাত|গভীর রাত|\blate night\b|\bmidnight\b"),
)


def _meal_period(text: str) -> str:
    """The meal the guest names ("বিকেলের নাস্তা" → afternoon; "রাতে" → dinner); "" when none. Late night before dinner.
    A greeting isn't a meal ("good morning", "শুভ সকাল")."""
    t = re.sub(r"good (morning|afternoon|evening|night)|শুভ (সকাল|বিকেল|সন্ধ্যা|রাত্রি)", " ", (text or "").lower())
    for kind in ("late", "afternoon", "breakfast", "lunch", "dinner"):
        if re.search(dict(_MEAL_WORDS)[kind], t):
            return kind
    return ""


# "আপনারা কি কিছু সার্ভিস করবেন?", "কেউ আছেন?", "is anyone there?" — wants service, but which isn't clear (a clear
# "bill please" / "call a waiter" is a service request as before)
_VAGUE_SERVICE = re.compile(
    r"সার্ভিস (কি )?(করবেন|করবে|দিবেন|দেবেন|দিবে|পাবো|পাব|পাওয়া যাবে|আছে|হবে)|কিছু সার্ভিস|সার্ভিস (দিচ্ছেন|দিচ্ছে) না|"
    r"কেউ (কি )?(আছেন|আছে|আসবেন|আসবে)|কাউকে (কি )?(পাঠাবেন|পাঠান|পাওয়া যাবে)|"
    r"\b(any(one|body) (there|here|around)|is there any service|do you (have|do) (table )?service|can someone come)\b",
    re.I,
)
# a clear call for staff — a waiter, the bill, the table cleaned ("ওয়েটার ডাকেন", "বিলটা দিন", "call the waiter")
_CALL_STAFF = re.compile(
    r"(ওয়েটার|ওয়েটার|ওয়েটার|স্টাফ|বেয়ারা|বেয়ারা|ম্যানেজার)(কে|দের)?\s*(একটু\s*)?(ডাক|ডেকে|পাঠা|আসতে বল|লাগবে|দরকার|চাই)|"
    r"(ডাক|ডেকে দিন|ডেকে দেন)\w*\s+(ওয়েটার|ওয়েটার|স্টাফ)|"
    r"(?<![ঀ-৿])বিল(টা|টি)?\s*(একটু\s*)?(দিন|দেন|দাও|দিবেন|দেবেন|আনুন|আনেন|আনো|নিয়ে আসুন|নিয়ে আসেন|লাগবে|চাই|দিয়ে যান|করে দিন)(?![ঀ-৿])|"
    r"টেবিল(টা|টি)?\s*(একটু\s*)?(পরিষ্কার|পরিস্কার|মুছে|মুছ)|"
    r"\b(call|get|send)( me)? (a|the|some) (waiter|staff|server|manager)\b|\b(bill|check) please\b|"
    r"\b(bring|get) (me |us )?the (bill|check)\b|\bclean (the|our) table\b|\bwaiter (please|daken|deken)\b",
    re.I,
)
# soft-drink brands a guest asks for by name
_BRANDS = re.compile(
    r"\b(coke|coca[- ]?cola|pepsi|sprite|fanta|7 ?up|seven ?up|mojo|mountain dew|clemon|speed|red ?bull|mirinda)\b|"
    r"কোক|কোকাকোলা|পেপসি|স্প্রাইট|ফান্টা|সেভেন ?আপ|মোজো|মাউন্টেন ডিউ|ক্লেমন|স্পিড|রেড ?বুল|মিরিন্ডা",
    re.I,
)
# "সরা দইয়ের দাম কত?", "how much is…" — a price question
_PRICE_Q = re.compile(r"দাম কত|দামটা কত|কত দাম|কত টাকা|দাম কেমন|প্রাইস কত|\bprice\b|\bhow much\b|\bcost\b|\bdam koto\b", re.I)
# "…তাহলে তুমি সেট মেনু-২টা কেনো বললে?" / "why did you suggest that?" — the guest is unhappy with a suggestion
_WHY_THAT = re.compile(
    r"(কেনো|কেন|কিসের জন্য)[^?।]{0,40}(বললে|বললেন|বলছো|বলছেন|বলেছ|বলেছেন|সাজেস্ট|দিলে|দিলেন|দেখালে|দেখালেন)|"
    r"(বললে|বললেন|সাজেস্ট (করলে|করলেন))[^?।]{0,20}(কেনো|কেন)|"
    r"\bwhy (did|would) you (suggest|recommend|say|offer|show)\b",
    re.I,
)
# "…খাবো না / চাই না / ছাড়া / বাদে", "no…, not…, without…" — what follows is a kind (or dish) the guest won't have
_DONT_WANT = re.compile(
    r"(খাবো|খাব|খাবনা|খাবোনা|খেতে চাই|চাই|লাগবে|নিবো|নিব|নেবো|নেব|দিও|দিবেন|দেবেন) ?না(?![ঀ-৿])|ছাড়া|বাদে|বাদ দিয়ে|বাদ দাও|"
    r"\b(no more|don'?t want|do not want|not in the mood for|without|except|anything but|no)\b",
    re.I,
)
# the guest turns the suggested dishes down and wants others — never "which of these" (they want none of these)
_REJECTS_THESE = re.compile(
    r"(ভালো|ভাল) (লাগছে|লাগতেছে|লাগে|লাগলো|লাগল) ?না|ভাল্লাগছে না|পছন্দ (হচ্ছে|হয়|হলো|হল|হয়নি|হয় নি) ?না|পছন্দ হচ্ছে না|"
    r"অন্য কিছু|অন্যকিছু|অন্য কোন|অন্য আইটেম|অন্য খাবার|এগুলো? (চাই|লাগবে|খাবো|খাব) ?না|এগুলা (চাই|লাগবে|খাবো|খাব) ?না|"
    r"\b(something else|other (options?|dishes|ones|suggestions)|don'?t (like|want) (these|those|them|any)|none of (these|them|those)|"
    r"not (these|those)|onno kichu)\b",
    re.I,
)
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
- Heat and taste the menu doesn't state: answer like an experienced waiter from the kind of dish — soups, fries, fried rice, noodles, lemon / sweet-and-sour / cashew / oyster-sauce dishes are usually mild; chilli, hot sauce, red curry, Szechuan, masala, "flaming" dishes usually hot. Say it naturally with "usually" ("স্যুপটা সাধারণত হালকা হয়"). NEVER tell the guest that the menu has no information, isn't listed, isn't mentioned, or that you don't know ("ঝালের তথ্য নেই", "মেনুতে উল্লেখ নেই", "the menu doesn't list its heat") — that means nothing to a guest. If it helps, offer a "less spicy" note on their order.
- Countable facts are different — how many pieces, how big a portion, how many people a dish feeds, what exactly is in it beyond its name and description: never guess a number or a size (a guest who hears "এক পিস" and gets two feels misled). Say briefly that you're not sure of that and the staff will tell them ("কয় পিস থাকে সেটা আমি নিশ্চিত নই — স্টাফকে জিজ্ঞেস করলে বলে দেবে"), then help with what you do know (its price, its description, what it goes with).
- Allergies / exact ingredients are different (safety): if you're not sure, say staff can confirm — never guess an allergen is absent.
- Something not on the menu: say so plainly, then offer the closest real dish.
- "Something light" / "হালকা কিছু" is a soup, a salad, a snack, tea / coffee, doi, a dessert or a drink — never a biryani, polao, khichuri, kacchi or a curry with rice (those are full meals: filling, never "light").
- "Healthy" / "হেলদি" / "diet" means grilled, steamed, soup, salad, fruit, plain dal, vegetables — never fries, fried chicken, a burger, a shake or a dessert. If the menu has nothing like that, say so honestly and offer the lightest real option.
- Delivery / pickup time for an online order: you don't know the restaurant's delivery times unless WAIT TIMES or RESTAURANT says them — never invent "৩০–৪৫ মিনিট"; say the restaurant will confirm the time after they get the order.
- No stock filler: never "গরম গরম প্লেটে আসে" (only a sizzling comes on a hot plate), "দারুণ একটা অপশন", "স্বাদে ভরপুর" — say one real thing about the dish or nothing.
- Polao, biryani, kacchi, tehari, khichuri and fried rice ARE rice dishes — never suggest rice "with" them (nobody eats ভাত with a পোলাও). Rice / bread goes with a curry, a bhuna, a fish or meat dish, a kebab.
- Local words: "ঠান্ডা" / "thanda" / "কোল্ড ড্রিংকস" = a cold soft drink (Coke, Sprite…), never a dish; "পানীয়" = drinks.
- NOT ORDERABLE NOW items exist but can't be ordered at the moment: say why (the reason given) and suggest an available alternative. Never add them to the cart. Never list them on your own in an answer about what there is ("ডাল, মুগ ডাল আজ পাওয়া যাচ্ছে না") — name only what CAN be ordered; mention one only when the guest asks for it by name, and then offer the one of its kind that is on.
- Never suggest or list again what is already in the CART ("সকালে কি আছে?" with বুটের ডাল in the cart: the paratha, the nehari… — not the dal they already took).
- If a fact isn't available, say you don't have that information and that a staff member can help. Guessing is worse than saying you don't know.
- Wait times: how long a dish takes to make is in MENU as "prep ~N min"; live numbers (how busy the kitchen is, the CART if ordered now, the quickest dishes, the guest's PLACED orders) are in WAIT TIMES in THIS TURN. Quote only those, rounded and approximate ("about 15 minutes", "১৫ মিনিটের মতো") — never an exact promise, never a number you made up, never "I've told the kitchen to hurry". A dish without a prep time takes the default given in WAIT TIMES. "Where's my food?" after ordering → answer from GUEST'S PLACED ORDER (its status and minutes left; running late → a short apology and "it's coming soon"). A guest in a hurry → lead with the quickest dishes. Ordering and asking "how long?" in the same breath → do both (topic wait_time only when time is all they asked).

# Allergies & diets (safety first)
- Menu tags (e.g. spicy, vegetarian) are facts. "has:" / "likely spicy" / "likely mild" / "likely vegetarian" are hints derived from dish names — treat them as likely, not guaranteed, and never read these labels out; say it naturally ("the name suggests it's on the spicier side", "it's usually mild").
- Common knowledge for this kind of menu: "Special" fried rice / chowmein / soup / salad usually mixes chicken, prawn and/or beef; wontons usually have a meat or prawn filling; spring rolls may contain chicken; set menus and fried rice usually include egg; "Thai" dishes often use fish sauce; Chinese vegetable dishes often use oyster sauce.
- Allergy question: say which dishes to avoid GROUPED, the way a waiter would say it out loud ("all the prawn dishes, the 'Special' dishes, and the Prawn Cashew Nut Salad") — use the ALLERGY GUIDE when given; never read out a long list (max ~6 names). Then suggest 2–3 dishes they CAN have. Always add that the guest should tell the staff so the kitchen can confirm, because cross-contact can't be ruled out. Never call a dish safe, free-of or guaranteed.
- Vegetarian/vegan: lead with dishes tagged vegetarian. Then up to 4 dishes marked likely vegetarian, as "should be vegetarian — please confirm with staff, as sauces can contain oyster or fish sauce". Never list "Special" dishes, wontons, set menus or anything with meat, seafood, oyster or fish sauce as vegetarian. "What's vegetarian?" asks for FOOD — dishes to eat (a vegetable curry, fries, a dal), never the drinks or desserts unless they ask for those.
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

# AI-first: the playbook without what belongs elsewhere — cuisine and language knowledge (now in knowledge/, read
# only by the restaurants it fits: oyster sauce and "fried rice is never ভাত" reached every burger shop), one
# restaurant's facts ("Mineral Water is on the menu"), and the fill-in sentence shapes behind the stiff
# "…আইটেমের মধ্যে A, B অথবা C খুবই ভালো" replies. Lines (with their indented sub-lines) starting with these go:
_NOT_IN_AI_FIRST = (
    '- "Something light"', '- "Healthy"', "- Polao, biryani, kacchi", "- Local words:",
    "- Common knowledge for this kind of menu", "  Example (for a Chinese menu", "- THE WAITER'S SHAPES",
    "- Water: bottled Mineral Water", "- Food words in Bangla",
)


def _without_lines(text: str, starts: Tuple[str, ...]) -> str:
    out, dropping = [], False
    for line in text.split("\n"):
        if line.startswith(starts):
            dropping = True
            continue
        if dropping and line.startswith("  "):
            continue  # (an indented line under the one dropped)
        dropping = False
        out.append(line)
    return "\n".join(out)


PLAYBOOK_AI_FIRST = _without_lines(PLAYBOOK, _NOT_IN_AI_FIRST)

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
    # a count said AS a count wins over a bare digit, which may be the dish's own ("সেট মেনু ১ দশটা দেন" is ten)
    m = re.search(r"(?<!\d)(\d{1,3})\s*(টা|টি|টো|খানা|পিস|প্লেট|জন|pcs|x)(?![ঀ-৿a-z])", t)
    if m:
        return int(m.group(1))
    for w in re.findall(r"[a-z]+|[ঀ-৿]+", t):
        for k, v in sorted(_BN_QTY.items(), key=lambda kv: -len(kv[0])):
            if w.startswith(k) and w[len(k):] in ("টা", "টি", "টো", "খানা", "জন", "প্লেট"):
                return v
    t = re.sub(r"(menu|মেনু|নম্বর|নাম্বার|number|no\.?|#|table|টেবিল)\s*\d+", r"\1", t)  # ("Set Menu 2", "table 5")
    m = re.search(r"(?<!\d)(\d{1,3})(?!\d)", t)
    if m:
        return int(m.group(1))
    for w in re.findall(r"[a-z]+|[ঀ-৿]+", t):
        if w in _EN_NUM:
            return _EN_NUM[w]
        for k, v in sorted(_BN_QTY.items(), key=lambda kv: -len(kv[0])):
            if w == k:
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
                {"type": "json_schema", "json_schema": {"name": "waiter_turn", "strict": True,
                                                        "schema": RESPONSE_SCHEMA_AI_FIRST if AI_FIRST else RESPONSE_SCHEMA}}
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
    meal_kinds: Optional[List[str]] = None,
    understood: Optional[Dict[str, Any]] = None,
    knowledge_now: str = "",
    checked_facts: Optional[List[str]] = None,
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
    brands = sorted({m.group(0) for m in _BRANDS.finditer(transcript or "")})
    if brands:
        drinks = [it for it in index.items if dish_facts(it)["drink"] or is_packaged(it)]
        listed = [str(it.get("name")) for it in drinks if _BRANDS.search(str(it.get("name") or ""))]
        lines.append(
            f"DRINK BRANDS ASKED: {', '.join(brands)}. "
            + (f"Listed by brand on this MENU: {', '.join(listed)}. " if listed else "No drink is listed by brand on this MENU. ")
            + "Its drinks: " + ", ".join(f"{it.get('name')} {_money(it.get('price'))}" for it in drinks[:12]) + ". "
            "Answer exactly that: which of the asked brands we list, and for the rest say plainly they aren't on the menu "
            "by name — offer the generic one (e.g. Soft Drinks) and that the staff can tell which flavours are in today. "
            "Never call a juice or shake a kind of Coke."
        )
    if _WHY_THAT.search(transcript or ""):
        # "আমি বলছি প্লেটার খাবো না, তাহলে তুমি সেট মেনু-২টা কেনো বললে?" got a defence of the dish
        lines.append(
            "THE GUEST IS UNHAPPY WITH YOUR LAST SUGGESTION (they ask why you suggested it): start with a short, sincere "
            "apology and own the mistake plainly in ONE sentence — e.g. \"দুঃখিত, সেট মেনুও আসলে প্লেটারের মতোই — ওটা বলা "
            "আমার ভুল হয়েছে।\" Never defend or justify that dish. Then offer 2–3 dishes that really fit what they said "
            "(none of the kind they refused)."
        )
    lines.append("GUEST PROFILE (what we know about this table): " + (profile.summary() if profile else "nothing specific yet"))
    lines.append(
        f"RECOMMENDATION MODE: {mode.upper()} — {MODE_INSTRUCTIONS.get(mode, '')}"
        + (f' End your reply with exactly this question (in the reply language): "{ask_next}"' if ask_next else "")
    )
    if mode != "quiet":
        house = bangla_meal.house_note(index.items, orderable_items if orderable_items is not None else index.items,
                                       meal_kinds or ())
        if house:
            lines.append(house)
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
    if knowledge_now:
        lines.append("# WAITER KNOWLEDGE FOR THIS TURN (general, per cuisine/language)\n" + knowledge_now)
    if checked_facts:
        lines.append(
            "# CHECKED FACTS (worked out from this restaurant's menu, hours and availability — rely on them; answer in "
            "your own words; they came from matching the guest's words, so if the guest named several dishes or meant "
            "something else, follow what the guest actually said. What they say about times, hours and what is or "
            "isn't on the menu is TRUE: never say the opposite. When a fact lists the dishes the guest asked about, "
            "name them — don't answer only with hours)\n" + "\n".join(f"- {f}" for f in checked_facts))
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
# the waiter's own words about rice / bread (dropped when the offer engine asks for them this turn)
_RICE_BREAD_TALK = re.compile(r"ভাত|রাইস|পরোটা|রুটি|(?<![ঀ-৿])নান(?![ঀ-৿])|\b(rice|naan|nan|paratha|roti|bread)\b", re.I)


def _drop_sentences(text: str, pat: "re.Pattern[str]") -> str:
    """Every sentence after the first that matches `pat` left out ("ডাল যোগ করলাম। এখন ভাত খেতে পারেন।" → the first)."""
    parts = re.split(r"(?<=[।.!?])\s+", (text or "").strip())
    keep = [s for i, s in enumerate(parts) if i == 0 or not pat.search(s)]
    return " ".join(keep)


# "এগুলো বাদাম মুক্ত", "বাদাম ছাড়া", "নিরাপদ", "nut-free", "safe for you", "doesn't contain nuts" — a promise the waiter
# can't make
_FREE_CLAIM = re.compile(
    r"(বাদাম|চিংড়ি|দুধ|ডিম|গ্লুটেন|তিল)\s*(মুক্ত|ফ্রি|ছাড়া|নেই)|সম্পূর্ণ\s*নিরাপদ|নিরাপদ|"
    # ("Butter Chicken-এ বাদাম থাকে না" — the same promise in other words)
    r"(বাদাম|কাজু|চিংড়ি|দুধ|ডিম|গ্লুটেন|তিল)\S*\s*(থাকে না|দেওয়া হয় না|দেয়া হয় না|ব্যবহার (হয়|করা হয়|হয়|করা হয়) না|থাকার কথা না)|"
    r"কোনো\s*(বাদাম|কাজু|চিংড়ি|দুধ|ডিম)\S*\s*(নেই|থাকে না)|"
    r"\b(nut|peanut|gluten|dairy|lactose|allergen|shellfish|egg)[- ]free\b|\bsafe (for|to)\b|"
    r"\b(doesn'?t|does not|don'?t|do not) contain\b|\bfree (of|from) (nuts|shellfish|dairy|gluten)\b",
    re.I,
)
_TELL_STAFF = {"bn": "অ্যালার্জির কথা স্টাফকে অবশ্যই জানিয়ে রাখবেন, রান্নাঘর নিশ্চিত করে দেবে।",
               "en": "Please also let the staff know about the allergy so the kitchen can confirm."}


def _no_free_claims(text: str, lang: str, asked: bool = False) -> str:
    """Sentences promising a dish is free of the allergen left out; the "tell the staff" note always there."""
    parts = re.split(r"(?<=[।.!?])\s+", (text or "").strip())
    keep = [s for s in parts if not _FREE_CLAIM.search(s)]
    if len(keep) < len(parts):
        # what's left must read as a reply: no dangling "তবে, …" (it once began "তবে, আপনার এলার্জির কথা…"), and when
        # the claim WAS the answer ("বাটার চিকেনে বাদাম আছে?"), say it plainly: not known for sure
        if keep:
            keep[0] = re.sub(r"^(তবে|আর|এছাড়া|এছাড়া|কিন্তু|However|But|Also)[,\s]+", "", keep[0], flags=re.I)
            keep[0] = keep[0][:1].upper() + keep[0][1:]
        if asked and not [s for s in keep if not re.search(r"স্টাফ|staff|রান্নাঘর|kitchen", s, re.I)
                          and not (s.rstrip().endswith("?") and len(s.split()) <= 5)]:
            keep.insert(0, "সেটা আমি নিশ্চিত বলতে পারছি না।" if lang == "bn" else "I can't say that for sure.")
    out = " ".join(keep)
    if not re.search(r"স্টাফ|staff", out, re.I):
        out = (out + " " + _TELL_STAFF["bn" if lang == "bn" else "en"]).strip()
    return out


# "আমি জানি কী অর্ডার করব", "জানি কি খাব", "I know what to order / what I want"
_KNOWS_ORDER = re.compile(
    r"(?<![ঀ-৿])জানি\s+(কী|কি)\s+(অর্ডার|খাব|খাবো|নেব|নিব|নেবো|নিবো)|\bi know what (to order|i want|i'?ll (have|order|get))\b|"
    r"\bjani\s+ki\s+(order|khabo|nibo)\b",
    re.I,
)
# "এটা / ওটা / ওইটা…" — the guest points at something
_POINTING = re.compile(r"(?<![ঀ-৿])(এটা|এইটা|এটি|এটার|এইটার|ওটা|ওইটা|ঐটা|ওটার|সেটা|সেইটা)(?![ঀ-৿])|\b(this|that) one\b", re.I)
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
    # (Bangla names too: a "সাদা ভাত" menu once heard every "ভাত" turned into "ফ্রাইড রাইস")
    return any(re.search(r"\b(plain|steamed|white)\s+rice\b|^rice$|\bbhat\b", str(it.get("name") or ""), re.I)
               or bangla_meal.is_plain_rice(it) for it in index.items)


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
    # "মেনু দেখতে চাচ্ছি / চাইছিলাম", "মেনুটা দেখব", "মেনু দেখাতে পারবেন?", "মেনু কোথায়?" — every way of asking to see it
    r"|মেনু(টা|টি|গুলো)?\s*(একটু\s*)?(দেখান|দেখাও|দেখাবেন|দেখাবে|দেখাতে\s*পারবেন|দেখাতে\s*পারেন"
    r"|দেখতে\s*(চাই|চাচ্ছি|চাচ্ছিলাম|চাইছি|চাইছিলাম|চেয়েছিলাম|পারি)|দেখবো?|দেখতাম|দেখা\s*যাবে|দেখি"
    r"|খুলুন|খোলেন|দিন|দেন|দাও|দিও|দে(?![ঀ-৿]))|মেনু কার্ড|মেনু(টা)?\s*কোথায়"
    # "মেনু কার্ডটা দাও" heard as "মেনু কাটটা / কাডটা দাও"
    r"|মেনু\s*(কার্ড|কাড|কাট)(টা|টি)?\s*(দাও|দিন|দেন|দিও|দে(?![ঀ-৿])|দেখাও|দেখান|আনো|আনুন)"
    # "কি আছে আপনার মেনুতে?" with the verb lost: "কিয় আপনার মেনুতে?", "কী তোমাদের মেনুতে?"
    r"|^\W*(কি|কী|কিয়|কিয়|কিইয়)\s+(আপনার|আপনাদের|তোমার|তোমাদের|তোদের)?\s*মেনু(তে|র মধ্যে)\W*$"
    r"|\bmenu\s*(ta\s*)?(dekhan|dekhao|dekhaben|dekhi|dekhbo?|dekhte\s*(chai|chacchi|chachhi|caichi|chaichi)|den|din)\b",
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


# where one dish ends and the next begins in an order ("বিফ শিক দাও আর একটা নান দাও", "চা, পরোটা")
_DISH_JOIN = re.compile(r"\s*(?:,|।|;|\s(?:আর|এবং|and|plus)\s)\s*")


def _several_dishes(text: str, index: MenuIndex) -> bool:
    """Two or more parts of the sentence each name food — several dishes, never one merged name (it answered
    "বিফ শিক নান আমাদের মেনুতে নেই" to "একটা বিফ শিক দাও আর একটা নান দাও")."""
    words = getattr(index, "_dish_words", None)
    if words is None:  # every word of the menu's dish names (not numbers) — "নান", "শিক", "ভাত"
        words = {w for it in index.items for w in _name_tokens(re.sub(r"\(.*?\)", " ", str(it.get("name") or "")))
                 if not w.isdigit()}
        index._dish_words = words  # type: ignore[attr-defined]
    rev = _menu_rev(index)
    return sum(1 for s in _DISH_JOIN.split(text or "") if s.strip() and _guest_tokens(s, rev) & words) >= 2


def _names_food(text: str, index: MenuIndex) -> bool:
    """Does the guest name a dish? ("অর্ডার থেকে কোকটা বাদ দিন", "সব কোক বাদ দিন" — about the Coke, never "everything")"""
    return bool(_dishes_named(text, index, limit=1) or find_mentions(text, index, limit=1))


# words that answer a question without naming anything ("হ্যাঁ, দুইটা দেন", "না থাক", "ঠিক আছে ভাই")
_ANSWER_WORDS = {
    "আর", "আরো", "আরও", "আরেকটা", "আরেকটি", "ও", "এবং", "সাথে", "সঙ্গে", "হ্যাঁ", "হ্যা", "হাঁ", "জি", "জ্বি", "না", "ঠিক",
    "আছে", "দেন", "দিন", "দাও", "দে", "দিবেন", "দেবেন", "দিয়েন", "দিও", "প্লিজ", "ভাই", "আপু", "মামা", "তাহলে", "আচ্ছা",
    "হুম", "ওকে", "লাগবে", "চাই", "নেব", "নিব", "নেবো", "নিবো", "নিচ্ছি", "এটা", "ওটা", "সেটা", "থাক", "একটা", "একটি",
    "এক", "দুই", "দুইটা", "দুটো", "দুটা", "দুটি", "তিন", "তিনটা", "তিনটে", "চার", "চারটা", "পাঁচ", "পাঁচটা", "টা", "টি",
    "করেন", "করুন", "করো", "কর", "করে", "অবশ্যই", "শুধু", "মোট", "সব", "সবগুলো", "বাবা", "জী",
    "and", "also", "more", "one", "two", "three", "four", "yes", "no", "ok", "okay", "please", "give", "me", "add", "just",
    "a", "an", "the", "it", "that", "sure", "yeah", "of", "with", "bhai", "r", "ar", "den", "din", "dao", "ekta", "duita",
}


def _menu_words(index: MenuIndex) -> set:
    """Every word any dish on this menu is called by (its name's words + their glosses) — cached on the index."""
    got = getattr(index, "_menu_words", None)
    if got is None:
        got = set()
        for it in index.items:
            got |= _name_tokens(str(it.get("name") or ""))
        index._menu_words = got  # type: ignore[attr-defined]
    return got


def _new_words(text: str, index: MenuIndex, ids: Iterable[str] = ()) -> List[str]:
    """The guest's words that name food on this menu and aren't the dishes in `ids` (what the waiter just asked about):
    "আর ভাত" after "পরোটা নেবেন, নাকি নান?" → ["ভাত"] — a new request, not an answer to the question."""
    own = set()
    for i in ids:
        if i in index.by_id:
            own |= _name_tokens(str(index.by_id[i].get("name") or ""))
    menu = _menu_words(index)
    words = [w for w in re.findall(r"[ঀ-৿]+|[a-z]+", str(text or "").lower()) if w not in _ANSWER_WORDS]
    out = []
    for w in words:
        toks = _guest_tokens(w, _menu_rev(index))
        if toks & menu and not toks & own:
            out.append(w)
    return out


# food and drink a guest may ask for whether or not this menu has it ("আর একটা বোরহানি" where there's none)
_FOOD_LEX = re.compile(
    r"^(বোরহানি|লাচ্ছি|লাস্সি|ফিরনি|পায়েস|পায়েস|জর্দা|বিরিয়ানি|বিরিয়ানি|কাচ্চি|তেহারি|খিচুড়ি|খিচুড়ি|পোলাও|পোলাউ|পরোটা|"
    r"রুটি|নান|ভাত|ডাল|ভর্তা|ভাজি|মাছ|মাংস|মুরগি|মুরগী|চিকেন|বিফ|গরু|খাসি|মাটন|ডিম|সবজি|চা|কফি|কোক|পেপসি|স্প্রাইট|পানি|"
    r"জুস|স্যুপ|সুপ|সালাদ|কাবাব|শর্মা|বার্গার|পিজ্জা|পিজা|ফ্রাই|ফ্রাইজ|নুডুলস|নুডলস|চাওমিন|চাউমিন|দই|মিষ্টি|আইসক্রিম|কেক|"
    r"borhani|lassi|firni|biryani|kacchi|tehari|khichuri|polao|paratha|porota|roti|naan|rice|bhat|dal|fish|beef|chicken|"
    r"mutton|egg|tea|cha|coffee|coke|pepsi|water|juice|soup|salad|kebab|kabab|burger|pizza|fries|noodles?|chowmein|dessert)"
    r"(?:ের|এর|টা|টি|গুলো|ও|s)?$",
    re.I,
)


def _food_word_said(text: str, own_names: str = "") -> bool:
    """A food or drink word in the guest's words that isn't one of `own_names` (the dishes just asked about)."""
    own = {w for w in re.findall(r"[ঀ-৿]+|[a-z]+", own_names.lower())}
    for w in re.findall(r"[ঀ-৿]+|[a-z]+", str(text or "").lower()):
        if w in _ANSWER_WORDS or w in own:
            continue
        m = _FOOD_LEX.match(w)
        if m and not any(o.startswith(w[:3]) for o in own):
            return True
    return False


# a dish named for its day: "মাটন কাচ্চি (শুক্রবার)", "বিফ কাচ্চি (শনিবার)", "Friday Special Kacchi", "Beef Tehari (Sun)"
_BN_DAYS = {"সোম": 0, "মঙ্গল": 1, "বুধ": 2, "বৃহস্পতি": 3, "বিষ্যুদ": 3, "শুক্র": 4, "শনি": 5, "রবি": 6}
_EN_DAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
_BN_DAY_WORD = re.compile(r"(সোম|মঙ্গল|বুধ|বৃহস্পতি|বিষ্যুদ|শুক্র|শনি|রবি)বার")
_EN_DAY_WORD = re.compile(r"\b(mon|tues|wednes|thurs|fri|satur|sun)day\b", re.I)
_EN_DAY_SHORT = re.compile(r"\b(mon|tue|wed|thu|fri|sat|sun)\b", re.I)
_BN_DAY_STEM = re.compile(r"(?<![ঀ-৿])(সোম|মঙ্গল|বুধ|বৃহস্পতি|শুক্র|শনি|রবি)(?![ঀ-৿])")


def _named_days(name: str) -> set:
    """The weekdays (0 = Monday) a dish's name says it's made on — empty for an every-day dish."""
    name = str(name or "")
    days = {_BN_DAYS[m] for m in _BN_DAY_WORD.findall(name)} | {_EN_DAYS[m[:3].lower()] for m in _EN_DAY_WORD.findall(name)}
    for inside in re.findall(r"\((.*?)\)", name):  # "(শুক্র ও শনি)", "(Fri & Sat)" — short forms only in brackets
        days |= {_BN_DAYS[m] for m in _BN_DAY_STEM.findall(inside)} | {_EN_DAYS[m.lower()] for m in _EN_DAY_SHORT.findall(inside)}
    return days


_BN_DAY_NAME = ["সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার", "রবিবার"]
_EN_DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _day_dishes(items: List[Dict[str, Any]], local_time: Optional[str]) -> List[Dict[str, Any]]:
    """A dish made on its day only can't be ordered on the others — never recommended on a Tuesday, and asked for, it's
    "শুধু শুক্রবারে হয়". (Copies: the menu snapshot itself is shared between turns.)"""
    m = re.match(r"\s*(mon|tue|wed|thu|fri|sat|sun)", str(local_time or ""), re.I)
    if not m:
        return items
    today = _EN_DAYS[m.group(1).lower()]
    out = []
    for it in items:
        days = _named_days(it.get("name")) if isinstance(it, dict) else set()
        if days and today not in days and it.get("available") is not False:
            bn = bool(re.search(r"[ঀ-৿]", str(it.get("name") or "")))
            said = sorted(days)
            when = (" ও ".join(_BN_DAY_NAME[d] for d in said) + "ে") if bn else ("/".join(_EN_DAY_NAME[d] + "s" for d in said))
            it = {**it, "available": False,
                  "unavailableReason": (f"শুধু {when} হয়, আজ নয়" if bn else f"{when} only — not today")}
        out.append(it)
    return out


_POPULAR_Q = re.compile(
    r"জনপ্রিয়|জনপ্রিয়|পপুলার|সবচেয়ে বেশি (চলে|বিক্রি|অর্ডার)|বেশি চলে|সবাই (কি|কী) (খায়|খায়|নেয়|নেয়)|"
    r"\b(popular|best ?sell(er|ing)?|most ordered|what do (people|most people) (get|order))\b",
    re.I,
)
_SAY_AGAIN = re.compile(
    r"(আবার|আরেকবার|আর একবার|আরেক বার)\s*(বলেন|বলুন|বলো|বল|বলবেন|বলেন তো|বলুন তো)|(কি|কী) বললেন|(কি|কী) বললা|"
    r"বুঝি নাই|বুঝিনি|বুঝলাম না|বুঝতে পারিনি|শুনি নাই|শুনিনি|শুনতে পাইনি|শুনতে পারিনি|"
    r"\b(say (that|it) again|repeat (that|it|please)|come again|pardon|what did you say|sorry\?|abar bolen|abar bolo)\b",
    re.I,
)
_ORDINAL = re.compile(
    r"(?<![ঀ-৿])(প্রথম|দ্বিতীয়|দ্বিতীয়|তৃতীয়|তৃতীয়|চতুর্থ|পঞ্চম|শেষের|শেষ)(টা|টি|টার|টির|টাই|টাও|টায়)(?![ঀ-৿])|"
    r"\b(the )?(first|second|third|fourth|fifth|last) one\b",
    re.I,
)
_ORDINAL_AT = {"প্রথম": 0, "দ্বিতীয়": 1, "দ্বিতীয়": 1, "তৃতীয়": 2, "তৃতীয়": 2, "চতুর্থ": 3, "পঞ্চম": 4, "শেষের": -1,
               "শেষ": -1, "first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4, "last": -1}
_TRAY_VERB = re.compile(r"বাদ|কমা|বাড়া|বাড়া|বদল|সরা|ক্যান্সেল|remove|cancel|change|swap|delete|মুছ", re.I)


def _ordinal_to_dish(transcript: str, rstate: Any, index: MenuIndex) -> str:
    """"দ্বিতীয়টার দাম কত?" → "ছোট মাছ দাম কত?" — the place in the list the waiter JUST said (its cards, in order)."""
    m = _ORDINAL.search(transcript or "")
    offered = [i for i in (getattr(rstate, "last_offered", None) or []) if i in index.by_id]
    said_at = getattr(rstate, "last_offer_turn", 0)
    if len(offered) < 2:  # ("প্রথমটা কেমন?" in between answered about one dish — the list is still the one before)
        offered = [i for i in (getattr(rstate, "last_list", None) or []) if i in index.by_id]
        said_at = getattr(rstate, "last_list_turn", 0)
    if not m or len(offered) < 2 or _TRAY_VERB.search(transcript) or getattr(rstate, "turn", 0) - said_at > 3:
        return transcript
    word = (m.group(1) or m.group(4) or "").lower()
    at = _ORDINAL_AT.get(word)
    if at is None or at >= len(offered):
        return transcript
    name = bangla_meal.said_name(index.by_id[offered[at]])
    return transcript[:m.start()] + name + transcript[m.end():]


# "X আছে?" / "X পাওয়া যাবে?" / "do you have X?" — asked whether there is (not how it is)
_HAVE_Q = re.compile(
    r"(আছে|আচে|আছেন|নেই|নাই|আছে না|পাওয়া যাবে না|পাওয়া যাবে|পাওয়া যাবে|পাওয়া যায়|পাওয়া যায়|মিলবে)\s*\??\s*$|\b(do you have|have you got|is there|"
    r"any)\b|\b(ache|pawa jabe)\s*\??\s*$",
    re.I,
)
_NOT_FOOD_WORDS = {"আছে", "আচে", "আছেন", "নেই", "নাই", "হবে", "পাওয়া", "পাওয়া", "যাবে", "যায়", "যায়", "মিলবে", "দাম", "কত", "কতো", "টাকা",
                   "দেন", "দিন", "দাও", "দে", "দিবেন", "দেবেন", "একটা", "একটি", "দুইটা", "দুটো", "আর", "কি", "কী", "ভাই",
                   "আপনাদের", "আপনাদে", "তোমাদের", "এখানে", "মেনুতে", "এর", "do", "you", "have", "any", "is", "there",
                   "price", "of", "the", "a", "how", "much", "cost", "please", "give", "me", "want", "i", "an", "got",
                   "চাই", "লাগবে", "নেব", "নিব", "প্লিজ", "please",
                   # a size is not part of the dish ("একটা বড় কাচ্চি দিন")
                   "বড়", "বড়", "ছোট", "ফুল", "হাফ", "প্লেট", "মিডিয়াম", "full", "half", "small", "large", "medium",
                   "regular", "big", "plate",
                   # (no food in them: "আজকে স্পেশাল কি আছে?" asks for the specials, "দাম কোতো" is "দাম কত")
                   "আজকে", "আজ", "স্পেশাল", "special", "today", "কোতো", "কতো", "koto", "dam",
                   # (the words around a change of mind: "না দাঁড়ান, একটা ফ্রাইড রাইস ও দেন")
                   "না", "দাঁড়ান", "দাঁড়ান", "দাঁড়াও", "দাঁড়াও", "ওয়েট", "wait", "ও", "আরো", "আরও", "থাক", "তাহলে",
                   "আচ্ছা", "হ্যাঁ", "হ্যা", "জি", "ঠিক", "আমাকে", "আমার", "আমাদের", "জন্য", "also", "too", "and",
                   "আরেকটা", "আরেকটি", "আরো একটা", "another", "one", "more"}


def _asked_phrase(t: str, index: Optional[MenuIndex] = None) -> Tuple[str, List[str]]:
    """("বিফ তেহারি", [words]) — the food the guest named, without the asking / ordering words around it."""
    # ("পাস্তারদাম কোতো": speech-to-text glues the price word on — never বাদাম, the nut)
    t = re.sub(r"(?<![ঀ-৿])(?!বা)([ঀ-৿]{3,}?)(?:র|এর|ের)?দাম(?![ঀ-৿])", r"\1 দাম", t or "")
    words = re.findall(r"[A-Za-z]+|[ঀ-৿]+", t or "")
    keep = [w for w in words if w.lower() not in _NOT_FOOD_WORDS and w not in _EVERYDAY and _said_quantity(w) is None
            and not PRICE_WORD.search(w)]
    if keep and re.search(r"[ঀ-৿]{3,}(ের|এর|য়ের|র)$", keep[-1]):
        cut = re.sub(r"(ের|এর|য়ের|র)$", "", keep[-1])
        # ("বারগার" is the word itself, not "বারগা"'s — keep it when the whole word is food on this menu)
        whole_is_food = index is not None and bool(_guest_tokens(keep[-1], _menu_rev(index)) & _menu_words(index))
        cut_is_food = index is not None and bool(_guest_tokens(cut, _menu_rev(index)) & _menu_words(index))
        if not (whole_is_food and not cut_is_food):
            keep[-1] = cut
    return " ".join(keep), keep


_HEALTHY_Q = re.compile(r"হেলদি|স্বাস্থ্যকর|ডায়েট|ডায়েট|কম তেল|তেল কম|\b(healthy|healthier|low ?cal|diet food|light food)\b",
                        re.I)
_LIGHT_DISH = re.compile(r"grill|steam|soup|salad|vegetable|\bveg\b|\bdal\b|lentil|tandoori|tikka|kebab|kabab|boiled|"
                         r"গ্রিল|স্যুপ|সুপ|সালাদ|সবজি|ডাল|ভাপা|ভাপে|সেদ্ধ|তন্দুরি|টিক্কা|কাবাব|ঝোল", re.I)
_HEAVY_DISH = re.compile(r"fried|\bfry\b|fries|crispy|cheese|butter|bacon|cream|shake|tempura|ফ্রাই|ভাজা|ক্রিস্পি|চিজ|বাটার|"
                         r"ক্রিম|কালা ভুনা|রেজালা|কোরমা|নেহারি|পায়া|হালিম", re.I)
_SIZE_HINT = re.compile(r"^(বড়|বড়|ছোট|ফুল|হাফ|large|small|full|half|big)$", re.I)  # a size said: the order flow
_DISH_KIND_WORDS = {"rice", "noodle", "noodles", "chowmein", "pizza", "burger", "soup", "salad", "pasta", "biryani",
                    "kacchi", "tehari", "polao", "khichuri", "kebab", "kabab", "naan", "paratha", "sandwich", "roll",
                    "shawarma", "wrap", "curry", "steak", "momo", "dumpling", "sushi", "taco", "dosa", "haleem"}
PRICE_WORD = re.compile(r"^(দাম|দামে|দামটা|টাকা|price|cost)$", re.I)


def _food_phrase(keep: List[str], index: MenuIndex) -> bool:
    """Every word is food we know — a menu word, a kind of dish, a food word ("বিফ তেহারি", "চিকেন টিক্কা মাসালা");
    never a garble ("নিকিটা ডাবল পেটি…") or a sentence."""
    if not keep or len(keep) > 4:
        return False
    menu = _menu_words(index)
    for w in keep:
        toks = _guest_tokens(w, _menu_rev(index))
        if (toks & menu or menu_answers.families_of_text(w) or _FOOD_LEX.match(w.lower())
                or menu_answers.families_of_text(" ".join(toks)) or any(_FOOD_LEX.match(x) for x in toks)
                or (toks and toks <= {"fried", "grilled", "roasted", "spicy", "crispy", "plain", "special"})):
            continue
        return False
    return True


def _heard_closeness(t: str, it: Dict[str, Any], index: Optional[MenuIndex] = None) -> float:
    """How closely the guest's words spelt the dish's own words (0–100, the worst of them; "পিৎজা" and the like, shared
    by many dishes, left out)."""
    from rapidfuzz import fuzz as _fz
    heard = [w for w in re.findall(r"[ঀ-৿]+|[A-Za-z]+", t or "") if len(w) >= 3]
    own = [w for w in to_bangla_script(re.sub(r"\(.*?\)", " ", str(it.get("name") or ""))).split() if len(w) >= 3]
    names, common = getattr(index, "_bn_name_words", None) or ({}, {}) if index is not None else ({}, {})
    own = [w for w in own if common.get(w, 0) <= 1] or own  # its own words, not "পিৎজা" that every pizza has
    if not heard or not own:
        return 100.0
    from rapidfuzz.distance import Levenshtein as _lev
    if all(min(_lev.distance(w, h) for h in heard) <= 1 for w in own):
        return 100.0  # one letter off ("ফান্তা" for ফান্টা) is a spelling, not a different word
    return min(max(_fz.ratio(w, h) for h in heard) for w in own)


def _same_dish_on_now(it: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool]) -> Optional[Dict[str, Any]]:
    """A dish that's off now ("পরোটা", breakfast) → the one dish that's on with its whole name in it ("পাঁচ পরোটা",
    the evening's) — what the guest means by it now. None: none, or several."""
    mine = _name_tokens(re.sub(r"\(.*?\)", " ", str(it.get("name") or "")))
    if not mine:
        return None
    alts = [d for d in index.items if d is not it and orderable.get(index.item_id(d), True) and not d.get("hidden")
            and mine <= _name_tokens(str(d.get("name") or ""))]
    return alts[0] if len(alts) == 1 else None


def _menu_answer(transcript: str, index: MenuIndex, orderable: Dict[str, bool], kind_scope: set, focus: List[Dict[str, Any]],
                 lang: str, ok: Callable[[Dict[str, Any]], bool], shown: Optional[List[str]] = None,
                 ) -> Optional[Tuple[str, List[Dict[str, Any]], str, List[str]]]:
    """Price, "is there X?", a dish we don't have, the sections — answered from the menu itself (text, cards, note,
    the ids "দেব?" offers). None → the usual flow (the model)."""
    t = (transcript or "").strip()
    bn = lang == "bn"
    if not t or len(t.split()) > 9 or _several_dishes(t, index):
        return None  # (several dishes: the order flow takes each — never one merged "বিফ শিক নান")
    named = _dishes_named(t, index, limit=4)
    phrase, keep = _asked_phrase(t, index)
    if len(keep) >= 2 and len(set(keep)) == 1:
        return None  # "প্রাজ প্রাজ প্রাজ প্রাজ" — speech-to-text noise, not a dish
    # a kind said that none of those dishes is: "চিকেন ফ্রাইড রাইস আছে?" is not "জি, Fried Chicken আছে"
    if named and menu_answers.families_of_text(phrase) - set().union(*[menu_answers.families(x) for x in named]):
        named = []
    rows = lambda xs: [_suggestion_row(x) for x in xs]  # noqa: E731

    # ---- "হাফ প্লেট ভাত হবে?" / "হাফ মান্দির দাম কত?" — a size the menu doesn't have for it: said so, with the real
    # price (it once answered "গরুর লাল ভুনার সাথে খেতে আরও কিছু লাগবে?", and invented a half price "about half")
    # (a portion said — হাফ / ফুল — never a word of the dish's own name: "ছোট মাছ" is a fish, and "বড় বার্গার" is a bigger
    # burger, not a size)
    t_sz = t
    for x in named:
        for w in bangla_meal.said_name(x).split():
            t_sz = t_sz.replace(w, " ")
    size_m = re.search(r"(?<![ঀ-৿])(হাফ|অর্ধেক|ফুল)(?![ঀ-৿])|\b(half|full)\b", t_sz, re.I)
    if size_m and (named or kind_scope) and re.search(r"\?|হবে|আছে|পাওয়া|পাওয়া|কত|দাম|\b(is there|do you|how much|price)\b", t, re.I):
        word = size_m.group(0).lower()
        pat = (r"half|small|হাফ|ছোট|অর্ধেক" if word in ("হাফ", "অর্ধেক", "half", "ছোট", "small")
               else r"full|large|ফুল|বড়|বড়")
        pool = named[:1] or [index.by_id[i] for i in kind_scope if i in index.by_id]

        def has_size(it: Dict[str, Any]) -> bool:
            if any(re.search(pat, str(v.get("name") or ""), re.I) for v in it.get("variations") or []):
                return True
            base = bangla_meal.said_name(it)
            return any(bangla_meal.said_name(o) == base and re.search(rf"\(.*({pat}).*\)", str(o.get("name") or ""), re.I)
                       for o in index.items)

        if pool and not any(has_size(it) for it in pool):
            said_size = "হাফ" if re.search(r"half|small|হাফ|ছোট|অর্ধেক", word, re.I) else "ফুল"
            on = [x for x in pool if orderable.get(index.item_id(x), True)] or pool
            if len(on) == 1:
                x = on[0]
                text = (f"{bangla_meal.said_name(x)} {said_size} হয় না — এক প্লেট {menu_answers.price_of(x)}। দেব?" if bn
                        else f"There's no {word} {bangla_meal.said_name(x)} — a regular one is {menu_answers.price_of(x)}. "
                             "Shall I add it?")
                return text, rows([x]), "size_missing", [index.item_id(x)]
            lines = menu_answers.price_lines(on[:4], lang)
            text = (f"{said_size} সাইজ নেই — {', '.join(lines)}। কোনটা দেব?" if bn
                    else f"There's no {word} size — {', '.join(lines)}. Which would you like?")
            return text, rows(on[:4]), "size_missing", []

    # ---- "হেলদি কিছু আছে?" — the lighter dishes by what they are (grilled, steamed, soup, salad, dal, vegetables), never
    # fries or a cheese burger called healthy; none → said honestly (it once offered Classic Fries as the healthy pick)
    if _HEALTHY_Q.search(t) and not named:
        light = [it for it in index.items if orderable.get(index.item_id(it), True) and not it.get("hidden")
                 and menu_answers.course(it) in ("main", "starter")
                 and _LIGHT_DISH.search(f"{it.get('name')} {kind_text(it)}") and not _HEAVY_DISH.search(f"{it.get('name')} {kind_text({'name': it.get('name')})}")
                 and ok(it)]
        light.sort(key=lambda x: index.position.get(index.item_id(x), 1 << 20))
        if light:
            names = list(dict.fromkeys(bangla_meal.said_name(x) for x in light))[:3]
            text = (f"হালকা আর কম তেলের মধ্যে আছে {menu_answers.join(names, 'বা')} — কোনটা দেব?" if bn
                    else f"For something lighter, there's the {menu_answers.join(names, 'or')} — which would you like?")
            return text, rows(light[:3]), "healthy", []
        text = ("সত্যি বলতে আমাদের মেনুতে আলাদা করে হেলদি বা কম তেলের কোনো আইটেম নেই। অন্য কিছু দেখবেন?" if bn
                else "Honestly, there's nothing specially light or healthy on our menu. Shall I suggest something else?")
        return text, [], "healthy_none", []

    # ---- the sections
    if menu_answers.CATEGORY_Q.search(t) and not named:
        got = menu_answers.categories_reply(index, orderable, lang)
        if got:
            return got[0], [], "categories", []

    asks_price = bool(menu_answers.PRICE_Q.search(t)) and not menu_answers.TOTAL_Q.search(t) and not re.search(
        r"কতক্ষণ|কত সময়|কয়জন|কতজন|কয় পিস|কত পিস|কতটুকু|how long|how many", t, re.I)
    if asks_price:
        if menu_answers.SUPERLATIVE_PRICE.search(t):
            # "এগুলোর মধ্যে কোনটা সবচেয়ে কম দাম?" — among the dishes just shown, not the whole menu
            these = re.search(r"এগুলো|এগুলা|এইগুলো|এইগুলা|ওগুলো|এদের|এর মধ্যে|\b(these|those|of them)\b", t, re.I)
            scope_now = set(shown or []) if these and shown else (kind_scope or None)
            got = menu_answers.superlative(t, index, orderable, scope_now, lang)
            if got:
                return got[0], rows(got[1]), "price_superlative", [index.item_id(x) for x in got[1][:1]]
            return None
        if named:
            # one dish listed under two sections ("Borhani" in Sides and in Drinks) is one dish to the guest
            named = [x for n, x in enumerate(named) if all(
                (bangla_meal.said_name(x), menu_answers.price_of(x)) != (bangla_meal.said_name(o), menu_answers.price_of(o))
                for o in named[:n])]
            lines = menu_answers.price_lines(named, lang)
            off = [x for x in named if not orderable.get(index.item_id(x), True)]
            text = ", ".join(lines) + "।" if bn else ", ".join(lines) + "."
            if off and len(named) == 1:
                text = text.rstrip("।.") + (f" — তবে {menu_answers.why_off(off[0], lang)}।" if bn
                                           else f" — but {menu_answers.why_off(off[0], lang)}.")
            elif off:
                text += " " + " ".join((menu_answers.off_line(x, lang) + ("।" if bn else ".")) for x in off[:2])
            on = [x for x in named if orderable.get(index.item_id(x), True)]
            if on:
                text += (" দেব?" if len(on) == 1 else " কোনটা দেব?") if bn else (" Shall I add it?" if len(on) == 1 else " Which one?")
            elif off:
                alts = menu_answers.alternatives(off[0], index, orderable, skip={index.item_id(x) for x in named}, ok=ok)
                # (the line already says "তবে …পাওয়া যাচ্ছে না" — never "তবে … তবে মুরগির রোস্ট আছে")
                instead = re.sub(r"^তবে ", "বদলে ", menu_answers.instead_line(alts, lang, with_price=True)) if alts else ""
                text += " " + instead if instead else ""
                on = alts
            return text.strip(), rows(named[:4] if not off else on), "price_named", [index.item_id(x) for x in on[:1]]
        scope = [index.by_id[i] for i in kind_scope if i in index.by_id] if kind_scope else []
        # (words beyond the kind that the menu doesn't know — "নিউ যোর্ক চিস্কেকের দাম" is not the doi's prices)
        rev, menu_w = _menu_rev(index), _menu_words(index)
        if scope and [w for w in keep if not _kind_ids_in(w, index) and not (_guest_tokens(w, rev) & menu_w)]:
            return None
        if scope:
            scope.sort(key=lambda x: index.position.get(index.item_id(x), 1 << 20))
            on = [x for x in scope if orderable.get(index.item_id(x), True)] or scope
            # "কোকের দাম" — the one dish whose name begins with the word said (কোকা কোলা), not every drink's price
            if len(keep) == 1 and len(keep[0]) >= 3:
                head = [x for x in on if to_bangla_script(bangla_meal.said_name(x)).split()[:1]
                        and to_bangla_script(bangla_meal.said_name(x)).split()[0].startswith(keep[0])]
                if len(head) == 1:
                    x = head[0]
                    text = (f"{bangla_meal.said_name(x)} {menu_answers.price_of(x)}। দেব?" if bn
                            else f"The {bangla_meal.said_name(x)} is {menu_answers.price_of(x)}. Shall I add it?")
                    return text, rows([x]), "price_named", [index.item_id(x)]
            lines = menu_answers.price_lines(on, lang)
            if len(lines) <= 5:
                text = ", ".join(lines) + ("। কোনটা দেব?" if bn else ". Which one would you like?")
            else:
                lo, hi = min(map(menu_answers.lowest_price, on)), max(map(menu_answers.lowest_price, on))
                text = (f"দাম {_money(lo)} থেকে {_money(hi)} — যেমন {', '.join(lines[:4])}। কোনটা দেব?" if bn
                        else f"From {_money(lo)} to {_money(hi)} — e.g. {', '.join(lines[:4])}. Which one would you like?")
            return text, rows(on[:6]), "price_kind", []
        if focus and len(keep) == 0:  # "দাম কত?" about the dish being talked about
            it = focus[0]
            # "হাফ কত?" after the kacchi's prices: that size of it (its twin "(Half)", or its Half variation)
            size = ("half" if re.search(r"হাফ|half|ছোট|small", t, re.I)
                    else "full" if re.search(r"ফুল|full|বড়|বড়|large", t, re.I) else None)
            if size:
                pat = r"half|small|হাফ|ছোট" if size == "half" else r"full|large|ফুল|বড়|বড়"
                twin = next((o for o in index.items if bangla_meal.said_name(o) == bangla_meal.said_name(it)
                             and re.search(rf"\(.*({pat}).*\)", str(o.get("name") or ""), re.I)), None)
                var = next((v for v in it.get("variations") or [] if re.search(pat, str(v.get("name") or ""), re.I)), None)
                if twin or var:
                    it = twin or it
                    p = _money(var.get("price")) if var and not twin else menu_answers.price_of(it)
                    label = (str(var.get("name")) if var and not twin
                             else re.search(r"\((.*?)\)", str(it.get("name"))).group(1))
                    text = (f"{bangla_meal.said_name(it)} {label} {p}।" if bn
                            else f"The {label} {bangla_meal.said_name(it)} is {p}.")
                    if orderable.get(index.item_id(it), True):
                        text += " দেব?" if bn else " Shall I add it?"
                    return text, rows([it]), "price_focus", [index.item_id(it)]
            text = f"{bangla_meal.said_name(it)} {menu_answers.price_of(it)}।" if bn else f"The {bangla_meal.said_name(it)} is {menu_answers.price_of(it)}."
            if orderable.get(index.item_id(it), True):
                text += " দেব?" if bn else " Shall I add it?"
            return text, rows([it]), "price_focus", [index.item_id(it)]

    asks_have = bool(_HAVE_Q.search(t)) and not re.search(r"কেমন|কি দিয়ে|কী দিয়ে|\bhow\b", t, re.I)
    ordering = _orders_now(t) and not _QUESTION.search(t)
    # "মাটন কাচ্চি দুইটা" (a count, no verb) is an order; a dish's name said alone ("চিকেন ফ্রাইড রাইস") asks for it
    words = re.findall(r"[A-Za-z]+|[ঀ-৿]+", t)
    if not ordering and not _QUESTION.search(t) and any(_said_quantity(w) for w in words) and named:
        ordering = True
    # (only a name the menu doesn't have — a dish of ours said alone may be the answer to "কোনটা দেব?")
    bare = (not named and not ordering and not asks_price and not _QUESTION.search(t) and 2 <= len(words) <= 4
            and len(keep) == len(words) and _food_phrase(keep, index))
    asks_have = asks_have or bare
    if not (asks_price or asks_have or ordering):
        return None
    if _LIST_ASK.search(t) and not asks_price:
        return None  # "মিষ্টি কিছু আছে?", "ঠান্ডার মধ্যে কী কী আছে?" — a request for suggestions / a list, not "is there X"

    # ---- an order for a dish heard only nearly ("একটা পেপারনি পিজ্জা দিন" = Pepperoni Pizza): one plain check, then
    # "হ্যাঁ" adds it (the model once asked "Pepperoni Pizza বলতে কি এই পিজ্জাটাই বুঝাচ্ছেন? কোনটা অর্ডার করতে চান?")
    if (ordering and len(named) == 1 and orderable.get(index.item_id(named[0]), True)
            and not _dishes_named(t, index, limit=1, exact_only=True) and not _NOT_CLEAN.search(t)
            and not any((_said_quantity(w) or 0) > 1 for w in words)  # ("দুইটা …": yes would add one — the order flow)
            and _heard_closeness(t, named[0], index) < 88):  # (a near spelling of its own words: one check)
        it = named[0]
        text = (f"{it.get('name')} ({menu_answers.price_of(it)}) — এটাই দেব?" if bn
                else f"The {it.get('name')} ({menu_answers.price_of(it)}) — is that the one?")
        return text, rows([it]), "confirm_heard", [index.item_id(it)]

    # ---- "পরোটা" in the evening IS the পাঁচ পরোটা: a dish that's off now whose whole name is in exactly one dish
    # that's on means that one (it said "পরোটা সকালে পাওয়া যায় — তবে পাঁচ পরোটা আছে, দেব?")
    swapped = {index.item_id(x): alt for x in named if not orderable.get(index.item_id(x), True)
               for alt in [_same_dish_on_now(x, index, orderable)] if alt is not None and alt not in named}
    if swapped:
        named = [swapped.get(index.item_id(x), x) for x in named]
        if ordering:
            return None  # (the order flow adds it — _clean_order reads the name the same way)

    # ---- a dish named that can't be had now (sold out, later today, another day): say which, and what instead
    if named and not ordering or (named and all(not orderable.get(index.item_id(x), True) for x in named)):
        off = [x for x in named if not orderable.get(index.item_id(x), True)]
        on = [x for x in named if orderable.get(index.item_id(x), True)]
        if off and not on:
            alts = menu_answers.alternatives(off[0], index, orderable, skip={index.item_id(x) for x in named}, ok=ok)
            text = ("দুঃখিত, " if bn else "Sorry — ") + "; ".join(menu_answers.off_line(x, lang) for x in off[:2]) + ("।" if bn else ".")
            text += " " + (menu_answers.instead_line(alts, lang, with_price=True) if alts
                           else ("অন্য কিছু দেব?" if bn else "Shall I get you something else?"))
            return text.strip(), rows(alts), "unavailable_named", [index.item_id(alts[0])] if len(alts) == 1 else []
        # ("কি মিষ্টি আছে?" at a sweet shop asks WHICH sweets — never "জি, Mishti Doi আছে" for a dish only nearly named)
        which_q = bool(re.search(r"(?<![ঀ-৿])(কি|কী|কোন|কোনগুলো)\s", t)) and not _dishes_named(t, index, limit=1, exact_only=True)
        if on and asks_have and not off and len(on) == 1 and len(t.split()) <= 6 and not which_q:
            it = on[0]
            text = (f"জি, {bangla_meal.said_name(it)} আছে — {menu_answers.price_of(it)}। দেব?" if bn
                    else f"Yes, we have the {bangla_meal.said_name(it)} ({menu_answers.price_of(it)}) — shall I add one?")
            return text, rows([it]), "have_named", [index.item_id(it)]
        return None

    if named or not _food_phrase(keep, index):
        return None

    # ---- the guest's words are the dish minus a word ("চিকেন ফ্রাই" = চিকেন ঝাল ফ্রাই): that's what they mean
    said = set().union(*[_guest_tokens(w, _menu_rev(index)) for w in keep]) if keep else set()
    # (a taste is not a dish: "জাল কি আছে" — ঝাল — asks for spicy food, not for চিকেন ঝাল ফ্রাই)
    tastes = {"jhal", "spicy", "mishti", "sweet", "tok", "sour", "hot", "mild", "jhal-jhal"}
    # (what its name means counts too: "চা" is tea, and "Dudh Cha" / "Lal Cha" are teas)
    near = [it for it in index.items if said and not said <= tastes and not it.get("hidden")
            and said <= (_name_tokens(str(it.get("name") or "")) | _name_tokens(kind_text({"name": it.get("name")})))]
    near_on = [it for it in near if orderable.get(index.item_id(it), True)]
    if near and ordering:
        # "একটা ফ্রাইড রাইস দেন" with five fried rices: which one — as buttons (it once answered "বলুন, আমি যোগ করে দিই")
        kinds_on = list(dict.fromkeys(bangla_meal.said_name(x) for x in near_on))
        if 2 <= len(kinds_on) <= 6 and not any(_SIZE_HINT.search(w) for w in words):
            first = [next(x for x in near_on if bangla_meal.said_name(x) == k) for k in kinds_on]
            text = (f"কোন {phrase} দেব — {' নাকি '.join(kinds_on[:4])}?" if bn
                    else f"Which {phrase} would you like — {' or '.join(kinds_on[:4])}?")
            return text, rows(first), "which_one", []
        return None  # an order for a dish said a little short ("বড় পানি দেন") — the order flow sorts out which one
    if near and 1 <= len({bangla_meal.said_name(x) for x in near_on}) <= 4 and not kind_scope:
        names = [f"{bangla_meal.said_name(x)} ({menu_answers.price_of(x)})" for x in near_on[:4]]
        if asks_price and len(near_on) == 1:
            x = near_on[0]
            text = (f"{x.get('name')} {menu_answers.price_of(x)}। দেব?" if bn
                    else f"The {x.get('name')} is {menu_answers.price_of(x)}. Shall I add it?")
            return text, rows(near_on), "price_named", [index.item_id(x)]
        if len({bangla_meal.said_name(x) for x in near_on}) == 1:
            text = (f"আমাদের আছে {names[0]} — দেব?" if bn else f"We have the {names[0]} — shall I add it?")
        else:
            text = (f"{phrase} বলতে আমাদের আছে {menu_answers.join(names, 'আর')} — কোনটা দেব?" if bn
                    else f"For {phrase} we have {menu_answers.join(names, 'and')} — which one would you like?")
        return text, rows(near_on[:4]), "near_named", [index.item_id(near_on[0])] if len(near_on) == 1 else []

    # ---- a kind on the menu with none on now ("কাচ্চি আছে?" on a Tuesday)
    kind_all = _kind_ids_in(t, index)
    if kind_all and not kind_scope:
        off = [index.by_id[i] for i in kind_all if i in index.by_id and not index.by_id[i].get("hidden")]
        off.sort(key=lambda x: index.position.get(index.item_id(x), 1 << 20))
        # (every word said is in those dishes: "বিফ তেহারি" is not about the sold-out চিকেন বিরিয়ানি)
        theirs = set().union(*[_name_tokens(str(x.get("name") or "")) | _name_tokens(kind_text(x)) for x in off]) if off else set()
        if off and all(not orderable.get(index.item_id(x), True) for x in off) and said <= theirs:
            alts = menu_answers.alternatives(off[0], index, orderable, skip={index.item_id(x) for x in off}, ok=ok)
            text = ("দুঃখিত, " if bn else "Sorry — ") + "; ".join(menu_answers.off_line(x, lang) for x in off[:2]) + ("।" if bn else ".")
            text += " " + (menu_answers.instead_line(alts, lang, with_price=True) if alts
                           else ("অন্য কিছু দেব?" if bn else "Shall I get you something else?"))
            return text.strip(), rows(alts), "unavailable_kind", [index.item_id(alts[0])] if len(alts) == 1 else []
        extra = said - theirs
        # on to "not on our menu" only when they're all off, or a word names another kind of dish ("চিকেন ফ্রাইড
        # রাইস" is not Fried Chicken); "ক্রিস্পি চিকেন বার্গার" is still about the burgers
        if not (off and (all(not orderable.get(index.item_id(x), True) for x in off)
                         or extra & _DISH_KIND_WORDS or any(menu_answers.families_of_text(w) for w in extra))):
            return None
    if kind_scope and len(keep) < 2:
        return None  # (one word — "কাচ্চি" — is the kind: its list; "বিফ তেহারি" is a dish we don't have)
    if said and said <= tastes:
        return None  # "জাল কি আছে" — a taste: the spicy dishes, never "জাল আমাদের মেনুতে নেই"
    if kind_scope:
        # a kind on the menu said with a word more: "ক্রিস্পি চিকেন বার্গার আছে?" is still about our burgers (their
        # list); only another KIND of dish in the words ("বিফ তেহারি" where the rice dishes are polao) is "not on it"
        mine = set().union(*[_name_tokens(str(x.get("name") or "")) | _name_tokens(kind_text(x))
                             for x in (index.by_id[i] for i in kind_scope if i in index.by_id)])
        extra = said - mine
        # ("ম্যাঙ্গো শেক": mango things and shakes, but no dish is both — that one isn't on the menu)
        per_word = [s for s in (_kind_ids_in(w, index) for w in keep) if s]
        crossed = len(per_word) >= 2 and not set.intersection(*per_word)
        if not (crossed or extra & _DISH_KIND_WORDS or any(menu_answers.families_of_text(w) for w in extra)):
            return None

    # ---- not on the menu at all: say so plainly — and only a dish of the SAME kind instead, else what we do have
    alts = menu_answers.alternatives_for_words(phrase, index, orderable, ok)
    wanted = menu_answers.families_of_text(phrase) | ({"dessert"} if re.search("dessert|sweet|মিষ্টি|ডেজার্ট", phrase, re.I) else set())
    plain_no = not wanted or bool(wanted & {"dessert", "drink", "hot_drink", "yogurt_drink"})
    if bn:
        text = f"দুঃখিত, {phrase} আমাদের মেনুতে নেই।"
        text += " " + (menu_answers.instead_line(alts, lang, with_price=asks_price) if alts
                       else ("আর কিছু দেব?" if plain_no else menu_answers.what_we_have(index, orderable, lang) + " — কোনটা দেখবেন?"))
    else:
        text = f"Sorry, we don't have {phrase}."
        text += " " + (menu_answers.instead_line(alts, lang, with_price=asks_price) if alts
                       else ("Can I get you something else?" if plain_no
                             else menu_answers.what_we_have(index, orderable, lang) + " — which would you like?"))
    return text.strip(), rows(alts), "not_on_menu", [index.item_id(alts[0])] if len(alts) == 1 else []


def _same_kind_on(it: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool], skip: set = frozenset()
                  ) -> List[Dict[str, Any]]:
    """The dishes of its kind that CAN be ordered now — by the last word of its name ("ডাল" → বুটের ডাল)."""
    words = re.findall(r"[A-Za-z]+|[ঀ-৿]+", re.sub(r"\(.*?\)", " ", str(it.get("name") or "")))
    head = _guest_tokens(words[-1], _menu_rev(index)) if words else set()
    if not head:
        return []
    return [o for o in index.items if o is not it and orderable.get(index.item_id(o), True) and index.item_id(o) not in skip
            and not o.get("hidden") and head <= _name_tokens(str(o.get("name") or ""))][:2]


def _gone_from_tray(w: Dict[str, Any], index: MenuIndex, orderable: Dict[str, bool], skip: set, lang: str) -> str:
    """"খেয়াল করবেন: আপনার ট্রের ডাল এখন পাওয়া যাচ্ছে না — বদলে বুটের ডাল দেব?" — which line, and the one of its kind
    that is on (it said "ডাল এখন পাওয়া যাচ্ছে না" while বুটের ডাল was on, and it sounded like no dal at all)."""
    bn = lang == "bn"
    it = index.by_id.get(str(w.get("itemId")))
    alts = _same_kind_on(it, index, orderable, skip) if it else []
    name = bangla_meal.said_name(it) if it else str(w.get("name") or "")
    if bn:
        swap = (f"বদলে {' বা '.join(bangla_meal.said_name(a) for a in alts)} দেব?" if alts else "বদলে অন্য কিছু দেব?")
        return f"খেয়াল করবেন: আপনার ট্রের {name} এখন পাওয়া যাচ্ছে না — {swap}"
    swap = (f"shall I swap it for the {' or the '.join(bangla_meal.said_name(a) for a in alts)}?" if alts
            else "shall I swap it for something else?")
    return f"Heads up: the {name} in your tray can't be ordered right now — {swap}"


def _reason_bn(gone: List[Dict[str, Any]]) -> str:
    """The reason in brackets — only when it's in Bangla (never "(not available right now)" inside a Bangla line)."""
    why = str((gone[0] if gone else {}).get("reason") or "")
    return f" ({why.rstrip('।.')})" if why and re.search(r"[ঀ-৿]", why) else ""


# a short question about a dish's qualities — "ঝাল কেমন?", "কয় পিস থাকে?", "is it spicy?", "how big is it?"
_DISH_QUALITY = re.compile(
    r"ঝাল|দাম|পিস|পিচ|কতটুকু|কতক্ষণ|কত সময়|সাইজ|বড়|বড়|ছোট|দিয়ে (বানা|তৈরি|রান্না)|কেমন|মিষ্টি|টক|ফ্রেশ|গরম|"
    r"\b(spicy|hot|price|cost|pieces?|big|size|how long|fresh|sweet|made (of|with)|good)\b",
    re.I,
)
_LIST_ASK = re.compile(r"কিছু|আইটেম|কোনটা|কোন(?![ঀ-৿])|কি কি|কী কী|কোনগুলো|\b(something|anything|which|what else|items|dishes)\b", re.I)


def _about_the_dish(t: str, index: MenuIndex) -> bool:
    """A short question about a quality, naming no dish and no kind: about the dish being talked about."""
    t = str(t or "")
    return (len(t.split()) <= 5 and bool(_DISH_QUALITY.search(t)) and not _LIST_ASK.search(t)
            and not _dishes_named(t, index, limit=1) and not _kind_ids_in(t, index))


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
    segs = [x for x in _DISH_JOIN.split(text or "") if x.strip()]
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


def _orderable_twin(it: Optional[Dict[str, Any]], index: MenuIndex, orderable: Dict[str, bool]) -> Optional[Dict[str, Any]]:
    """A dish that can't be ordered now, listed again under the same name in a part of the menu that can (a breakfast
    and a lunch "গরুর কালা ভুনা") → that copy, or else the one dish on now whose name holds its name. None when it
    can be ordered, or has no such twin."""
    if not it or orderable.get(index.item_id(it), True):
        return None
    same = next((o for o in index.items if o is not it and orderable.get(index.item_id(o), True)
                 and _norm(o.get("name")) == _norm(it.get("name"))), None)
    if same:
        return same
    # …or the one dish on now that IS that dish by name: "পরোটা" (breakfast) at 8pm is the evening's "প্যাঁচ পরোটা" —
    # it once said "পরোটা এখন পাওয়া যাচ্ছে না, কাছাকাছি প্যাঁচ পরোটা". (The confirmation names the one added.)
    toks = _name_tokens(re.sub(r"\(.*?\)", " ", str(it.get("name") or "")))
    fits = [o for o in index.items if o is not it and orderable.get(index.item_id(o), True) and toks
            and toks <= _name_tokens(re.sub(r"\(.*?\)", " ", str(o.get("name") or "")))]
    return fits[0] if len({_norm(o.get("name")) for o in fits}) == 1 else None


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
    # ("ঠিক আছে ওগুলোই দেন" — all the dishes just suggested)
    "ওগুলো", "ওগুলোই", "এগুলো", "এগুলোই", "ঐগুলো", "ঐগুলোই", "ওগুলা", "এগুলা", "সবগুলো", "সবগুলোই", "সবগুলা", "সবই",
    "তিনটাই", "চারটাই", "সবকটা", "কয়টা",
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
        # a food the guest NAMED that the dish isn't ("আর একটা বোরহানি" on a menu without borhani → the model added
        # এক্সট্রা খিচুড়ি): that word is the odd one
        # (a dish's own choices count as on the menu: "Fish please" answers the thali's Chicken / Fish)
        known = set()
        for it in index.items:
            known |= _name_tokens(str(it.get("name") or ""))
            for g in it.get("modifierGroups") or []:
                for o in g.get("options") or []:
                    known |= _name_tokens(str(o.get("name") or ""))
            for v in it.get("variations") or []:
                known |= _name_tokens(str(v.get("name") or ""))
        odd = [w for w in re.findall(r"[A-Za-z']+|[ঀ-৿]+", transcript) if _FOOD_LEX.match(w.lower())
               and not (_guest_tokens(w, rev) & known)]
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


_CHEAPER = re.compile(
    r"cheaper|less expensive|lower price|more affordable|budget option|too (expensive|pricey|costly)|"
    r"কম দাম|কমদামি|কম দামি|সস্তা|অনেক দাম|দাম (বেশি|অনেক|বেশী)|বেশি দাম|বেশী দাম|দামি (হয়ে|লাগছে)|sasta|kom dam|onek dam",
    re.I,
)
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
# words every guest says that are never a dish — not matched to a menu word by sound
_EVERYDAY = {"খাবার", "খাবা", "খাবারের", "খাওয়া", "খাওয়া", "খাবো", "খাব", "খেতে", "আপনার", "আপনা", "আপনাদের",
             "আপনাদে", "তোমার", "তোমা", "তোমাদের", "তোমাদে", "তোদের", "আমার", "আমাদের", "আমাদে", "মেনু", "মেনুতে",
             "আইটেম", "কিছু", "ভালো", "আছে", "আছো", "এখানে", "আজকে", "দেন", "দিন", "দাও", "নেব", "নিব", "নেবো", "নিবো",
             # (question words: "চিকেনের কি কি আছে?" read "কি" as টিক্কা → "চিকেন টিক্কা" was named)
             "কি", "কী", "কিকি", "কে", "কোন", "কোনটা", "কোনো", "কেমন", "কত",
             # (speech-to-text's "খাওয়া": "এখন কি খাল যেতে পরে?" read "খাল" as গরুর কালা ভুনা)
             "খাল", "খাও", "খাবা"}


# one dish, many spellings — the menu's and the guest's meet on one ("দুইটা পরোটা" was "Porota with Dal", not Paratha)
_SPELLING = {"porota": "paratha", "parota": "paratha", "porotta": "paratha", "parotha": "paratha", "porata": "paratha",
             "kabab": "kebab", "kebap": "kebab", "biriyani": "biryani", "biriani": "biryani", "pulao": "polao",
             "polau": "polao", "pilaf": "polao", "nan": "naan", "rosogolla": "rasgulla", "roshogolla": "rasgulla",
             "rasogolla": "rasgulla", "shawarma": "shawarma", "shwarma": "shawarma", "sharma": "shawarma",
             "seekh": "shik", "sheekh": "shik", "sheek": "shik", "seek": "shik", "tika": "tikka", "chaap": "chap"}


def _sing(w: str) -> str:
    """prawns → prawn, curries → curry, drinks → drink (so 'প্রন' and 'Prawns' meet) — and one spelling of a dish."""
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        w = w[:-1]
    return _SPELLING.get(w, w)


def _name_tokens(name: str) -> set:
    """'Mineral Water (small)' → {mineral, water, small}; 'Set Menu A-01' → {set, menu, a, 1}.
    A Bangla name's words count too, as the guest's words do ('চিকেন চাপ মাসালা' → {chicken, চাপ, masala}) —
    a menu written in Bangla once had no name words at all, so every order on it looked like a guess."""
    toks = set()
    for w in re.findall(r"[a-z]+|\d+", str(name).lower()):
        if w in _STOP:
            continue
        toks.add(str(int(w)) if w.isdigit() else _sing(w))
    for w in re.findall(r"[ঀ-৿]+", str(name).translate(_BN_DIGITS)):
        if w not in _BN_STOP:
            toks |= _bn_word_tokens(w)
    return toks


# Bangla words in a dish name that aren't part of what it's called ("ডাল ও ভাত", "ভাত দিয়ে")
_BN_STOP = {"ও", "এবং", "আর", "দিয়ে", "দিয়ে", "সাথে", "সঙ্গে", "সহ"}
_BN_LOOKUP: List[Any] = []


def _bn_lookup() -> Tuple[Dict[str, str], Dict[str, set]]:
    """Bangla word → English menu word (from bn_translit), and one Bangla word → a two-word name. Built once."""
    if not _BN_LOOKUP:
        from bn_translit import PHRASES, WORDS

        rev: Dict[str, str] = {}
        for en, bn in WORDS.items():  # prefer the shortest English form ("prawn" over "prawns")
            if bn not in rev or len(en) < len(rev[bn]):
                rev[bn] = en
        # one Bangla word for a two-word name: "কাজুবাদাম" = cashew nut, "সেচুয়ান" = szu-chuan, "ওয়ান্টন" = won thon
        multi: Dict[str, set] = {}
        for en, bn in list(PHRASES.items()) + [("cashew nut", "কাজুবাদাম"), ("szu chian", "সেচুয়ান")]:
            if " " not in bn:
                multi.setdefault(bn, set()).update(_name_tokens(en.replace("-", " ")))
        _BN_LOOKUP[:] = [rev, multi]
    return _BN_LOOKUP[0], _BN_LOOKUP[1]


def _bn_word_tokens(w: str) -> set:
    """One Bangla word as menu tokens: its English menu word when we know one ('চিকেন' → chicken, 'হাফ' → half),
    else the word itself without its ending ('মাছের' → মাছ). The guest's words and a dish's name go through this
    same mapping, so they meet."""
    rev, multi = _bn_lookup()
    stem = _BN_SUFFIX.sub("", w) or w
    for cand in (w, stem):
        if cand in multi:
            return set(multi[cand])
        hit = _NUM_TOKENS.get(cand) or _SIZE_TOKENS.get(cand) or _BN_WORDS.get(cand) or rev.get(cand)
        if hit:
            return {hit if hit.isdigit() else _sing(hit)}
    return {stem}


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
        # a menu written in Bangla: its own words are menu words too ('চাপ' in 'চিকেন চাপ মাসালা'), mapped as in
        # _name_tokens — so the guest saying them is never "a word that names no dish"
        for it in index.items:
            for w in re.findall(r"[ঀ-৿]+", f"{it.get('name') or ''} {it.get('category') or ''}"):
                if w in _BN_STOP:
                    continue
                toks = _bn_word_tokens(w)
                if len(toks) == 1:
                    tok = next(iter(toks))
                    for key in (w, _BN_SUFFIX.sub("", w) or w):
                        rev.setdefault(key, tok)
        if len(_MENU_REV) > 50 or key in _MENU_REV:
            _MENU_REV.pop(key, None) if len(_MENU_REV) <= 50 else _MENU_REV.clear()
            _NEAR_CACHE.clear()  # keyed by id(rev) — the dropped rev's id can be reused
        _MENU_REV[key] = (index, rev)
    return _MENU_REV[key][1]


def _guest_tokens(text: str, menu_rev: Optional[Dict[str, str]] = None) -> set:
    """The guest's words as menu tokens — English words as they are, Bangla mapped back ('মিনারেল' → mineral)."""
    rev, multi = _bn_lookup()
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
            # (never an everyday word: "খাবার" sounded like "কাবাব", "আপনার" like "আনা" — read as a kind of dish)
            near = None if w in _EVERYDAY or _BN_SUFFIX.sub("", w) in _EVERYDAY else \
                _closest_menu_word(_BN_SUFFIX.sub("", w), menu_rev)
            if near:
                out.add(_sing(near))
    for a in [t for t in out if t in _ALIASES]:
        out |= _ALIASES[a]
    return out


_NEAR_CACHE: Dict[Tuple[str, int], Optional[str]] = {}
_PHON = str.maketrans({"্": "", "ৎ": "", "ী": "ি", "ূ": "ু", "শ": "স", "ষ": "স", "ণ": "ন", "ঞ": "ন", "ঢ": "দ", "ড": "দ", "ঘ": "গ",
                       "ধ": "দ", "ভ": "ব", "ফ": "প", "ঠ": "ত", "ট": "ত", "থ": "ত", "খ": "ক", "ছ": "চ", "ঝ": "জ", "ঃ": "", "ঁ": ""})


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


def _a_dish_not_kind(transcript: str, index: MenuIndex, scope: set) -> bool:
    """A particular dish named — not the kind asked about ("সেট মেনু" matching Set Menu 1 is the set menus)."""
    hits = _dishes_named(transcript, index, limit=3)
    return bool(hits) and not (scope and {index.item_id(h) for h in hits} <= set(scope))


def _named_kind_ids(transcript: str, index: MenuIndex) -> set:
    """"স্যুপের মধ্যে কী নেওয়া যায়?" → every soup. The dishes of the menu CATEGORY (or kind: drinks, desserts)
    the guest named — a recommendation stays inside it. Empty when they named a particular dish."""
    hits = _dishes_named(transcript, index)
    kind = _kind_ids_in(transcript, index)
    # ("সেট মেনু কি কি আছে?" fits Set Menu 1, 2 and 3 alike — that's the kind, not a dish)
    if hits and not (len(hits) >= 2 and {index.item_id(h) for h in hits} <= kind):
        # …and Set Menu 1 / 2 / 3 are one name but the number: "সেট মেনু" with no number said is all of them
        bases = {re.sub(r"[\d০-৯]+|\(.*?\)", "", str(index.by_id[i].get("name") or "")).strip().lower()
                 for i in kind if i in index.by_id}
        if not (len(kind) >= 2 and len(bases) == 1 and {index.item_id(h) for h in hits} <= kind
                and not re.search(r"[\d০-৯]", transcript or "")):
            # "ডাল কি কি আছে?" — a dish called just "ডাল" next to মুগ ডাল and বুটের ডাল: asked as a list, the kind
            if not (len(kind) >= 2 and {index.item_id(h) for h in hits} <= kind and _MANY_Q.search(transcript or "")
                    and all(len(_name_tokens(h.get("name"))) == 1 for h in hits)):
                return set()
    return kind


_MANY_Q = re.compile(r"(কি|কী)\s+(কি|কী)|কোন\s+কোন|\bki\s+ki\b|\bwhat\b.{0,20}\b(kinds?|types?)\b", re.I)


def _kind_ids_in(transcript: str, index: MenuIndex) -> set:
    """The dishes of every menu category / kind these words name (no check for a named dish)."""
    # (a time of day is no kind: "দুপুরে কি পাওয়া যায়?" picked the category "দিন দুপুরে")
    transcript = re.sub("|".join(f"(?:{pat})" for _l, pat, _a in _WHEN_SAID), " ", transcript or "", flags=re.I)
    words = _guest_tokens(transcript, _menu_rev(index))
    cat_words = set()
    for cat in {str(it.get("category") or "") for it in index.items}:
        cat_words |= (_name_tokens(cat) - _CAT_GENERIC) & words
    # a word several dish NAMES share is a kind too ("খিচুড়ি কী কী আছে?" → the 4 khichuris, though no category is
    # called that) — not sizes, numbers or words like "special"
    name_toks = [_name_tokens(it.get("name")) for it in index.items]
    plain = _CAT_GENERIC | set(_SIZE_TOKENS.values()) | set(_BN_WORDS.values())
    shared = {w for w in words - plain if not w.isdigit() and sum(w in t for t in name_toks) >= 2}
    ids = {index.item_id(it) for it, toks in zip(index.items, name_toks)
           if (cat_words & (toks | _name_tokens(it.get("category")))) or (shared & toks)}
    # the wider family ("কাচ্চি" → every biryani, tehari and polao) only when no category or dish name says the word —
    # "কাচ্চি কি কি আছে?" at a house with a "Kacchi" section is that section, not Plain Polao too
    if not ids:
        ids |= {index.item_id(i) for _, items in kind_items(transcript, index) for i in items}
    if not ids:
        # by what the dish IS, when no name or category says it: "মাছের মধ্যে কি কি আছে?" on a menu of "রুই মাছ",
        # "সরষে ইলিশ", "চিংড়ি ষোল আনা" in a category called "মাছে মাতাল বাঙালি" (the guest's "মাছ" reads "fish";
        # the names stay Bangla) — answered "here's our menu"
        # — only for the word on its own: "চিকেন বার্গার আছে?", "ডাইনামাইট শ্রিম্প কেমন?" name a dish this menu
        # doesn't have (the model says so) — never "here are our chicken dishes"
        alone = _kind_alone(transcript, index)
        ids = {index.item_id(it) for it in index.items for w in words & alone if _WHAT_IT_IS[w](it)}
    return ids


def _kind_alone(transcript: str, index: MenuIndex) -> set:
    """The _WHAT_IT_IS kinds the guest says as a kind ("মাছের মধ্যে…", "গরুর কি কি আছে", "চিকেন আইটেমের কিছু"),
    not as part of a dish name ("চিকেন বার্গার", "বার্বিকিউ চিকেন") — the words beside it ask, they don't name."""
    rev = _menu_rev(index)
    raw = re.findall(r"[A-Za-z]+|[ঀ-৿]+", transcript or "")

    def asks(w: Optional[str]) -> bool:
        if w is None:
            return True
        s = _BN_SUFFIX.sub("", w)
        return (w in _KIND_FILLER or s in _KIND_FILLER or w in _EVERYDAY or s in _EVERYDAY or w.startswith("আইটেম")
                or bool(re.search(r"রেস্ট|রেস্তো|মেনু|আপন|তোমা|এখানে|^(item|items|dish|dishes|do|you|have|any|what|"
                                  r"which|is|are|there|the|your|in|of|some)$", w, re.I)))
    out = set()
    for i, w in enumerate(raw):
        kind = _guest_tokens(w, rev) & set(_WHAT_IT_IS)
        # (the kind and one word nothing knows — "মাছ পটিকিয়া" — is the kind too: "which fish did you mean?")
        unheard = len(raw) == 2 and not _guest_tokens(raw[1 - i], rev) and not _A_VERB.search(raw[1 - i])
        if kind and (unheard or (asks(raw[i - 1] if i else None) and asks(raw[i + 1] if i + 1 < len(raw) else None))):
            out |= kind
    return out


def _protein(*kinds: str) -> Callable[[Dict[str, Any]], bool]:
    """A dish made of it — its curry / fry / kebab, not a bhorta / bhaji on the side ("মাছ ভর্তা" isn't a fish dish)."""
    def test(it: Dict[str, Any]) -> bool:
        text = kind_text(it)
        side_only = re.search(r"\bside\b", text) and not re.search(r"\bcurry\b", text)
        return bool(set(item_hints(it)["contains"]) & set(kinds)) and not side_only
    return test


# a guest's word (as _guest_tokens reads it) → is this dish that kind of food?
_WHAT_IT_IS: Dict[str, Callable[[Dict[str, Any]], bool]] = {
    "fish": _protein("fish", "prawn/shrimp"),  # (চিংড়ি is "মাছ" in Bangla)
    "prawn": _protein("prawn/shrimp"), "shrimp": _protein("prawn/shrimp"),
    "beef": _protein("beef"), "chicken": _protein("chicken"), "mutton": _protein("mutton"), "duck": _protein("duck"),
    "rice": lambda it: bangla_meal.is_plain_rice(it),
}


def _kind_word(transcript: str, index: MenuIndex, scope: set) -> str:
    """The guest's own word for the kind they asked about, as a label: "স্যুপের মধ্যে…" → "স্যুপ",
    "ড্রিংকসে কী আছে" → "ড্রিংকস", "which soup" → "soup"."""
    raws = re.findall(r"[A-Za-z]+|[ঀ-৿]+", transcript or "")
    banglish = bool(re.search(r"\b(ache|achhe|koto|den|dao|bhai|ki|kono|r|ar|ta|gula|gulo|khabo|nibo)\b", transcript or "",
                              re.I)) and not re.search(r"[ঀ-৿]", transcript or "")
    for raw in raws:
        if not _kind_ids_in(raw, index) & scope:
            continue
        if re.match(r"[A-Za-z]", raw):
            # "bhai kacchi ache?" is Bangla in Latin letters — the reply says "কাচ্চি", not "kacchi আইটেমের মধ্যে"
            return to_bangla_script(raw.lower()) if banglish else raw.lower()
        # "বার্গার" is the word itself (the kind's own spelling) — never cut to "বার্গা"
        if any(to_bangla_script(tk) == raw for tk in _guest_tokens(raw, _menu_rev(index))):
            return raw
        # (not re-checked: a bare "স্যুপ" reads like a dish name on its own)
        cut = re.sub(r"(তে|য়ে|য়ে|ে|য়|য়)$", "", _BN_SUFFIX.sub("", raw)) or raw  # ("ভর্তায়" → ভর্তা)
        # …but the cut must still name the kind
        return cut if cut == raw or _kind_ids_in(cut, index) & scope else raw
    # two words that name it together ("সেট মেনু কি কি আছে?" — neither "সেট" nor "মেনু" is a kind alone)
    for a, b in zip(raws, raws[1:]):
        pair = f"{a} {re.sub(r'(তে|য়ে|য়ে|ে|য়|য়)$', '', _BN_SUFFIX.sub('', b)) or b}"
        if _kind_ids_in(pair, index) & scope:
            # ("fast food ki ache?" is Bangla in Latin letters — "ফাস্টফুডের মধ্যে…", not "fast foodের মধ্যে")
            if banglish and re.fullmatch(r"fast food", pair.lower()):
                return "ফাস্টফুড"
            return to_bangla_script(pair.lower()) if banglish else pair
    return ""


def _dishes_named(text: str, index: MenuIndex, limit: int = 3, exact_only: bool = False) -> List[Dict[str, Any]]:
    """Dishes named in the guest's words, in English OR Bangla script ("অনিয়ন রিং" → Onion Ring,
    "স্পেশাল ফ্রাইড প্রন" → Special Fried Prawn). Every word of the dish name must be there; longest names first."""
    # ("রুইমাছ এক্টা": speech-to-text joins the fish to its kind)
    text = re.sub(r"([ঀ-৿]{2,}?)(মাছ|ভর্তা|ভুনা|কাবাব)(?![ঀ-৿])", r"\1 \2", text or "")
    hits = find_mentions(text, index, limit=limit)
    if hits or not re.search(r"[ঀ-৿]", text or ""):
        return hits
    # English plurals said in Bangla script: "রিংস" = rings, "ফ্রাইস" = fries → also try the word without "স"
    # (only ADDS words, so "রাইস" still means rice)
    singular = re.sub(r"([ঀ-৿]{2,})স(?![ঀ-৿])", r"\1", text)
    said = _guest_tokens(text, _menu_rev(index)) | _guest_tokens(singular, _menu_rev(index))
    name_nums = _name_numbers_said(text)
    said |= name_nums  # ("সেট মেনু ছয়": the word-reading never made a 6 of ছয়)
    scored = []
    for it in index.items:
        name = str(it.get("name") or "")
        toks = _name_tokens(name)
        if {x for x in toks if x.isdigit()} - name_nums:
            continue  # its number wasn't said as part of a name ("একটি" is a count, not Set Menu-1)
        base = _name_tokens(re.sub(r"\(.*?\)", " ", name)) if "(" in name else toks
        if base != toks and any(o is not it and _name_tokens(str(o.get("name") or "")) == base for o in index.items):
            base = toks  # another dish IS called that ("ড - তে ডাল" next to "ড - তে ডাল (পাসেল)")
        if toks and toks <= said:
            scored.append((len(toks), it))
        elif base and base <= said:
            scored.append((len(base) - 0.5, it))  # "রুই মাছ" = রুই মাছ (গ্লাসি) — the bracket is how, not what
    scored.sort(key=lambda x: -x[0])
    out: List[Dict[str, Any]] = []
    for n, it in scored:
        # "Onion Ring" is inside "Onion Ring Special"? keep only the most specific names
        if any(_name_tokens(str(it.get("name") or "")) < _name_tokens(str(o.get("name") or "")) for o in out):
            continue
        out.append(it)
        if len(out) >= limit:
            break
    if out or exact_only:
        return out  # (exact_only: every word of the name said — never the spelt-nearly matches below)
    # a dish's OWN word said a little differently ("পেপারনি পিজ্জা" = Pepperoni Pizza; "পিজ্জা" is every pizza's word):
    # every distinctive word of its name nearly said, and only one dish fits
    from rapidfuzz import fuzz as _fz2
    heard_words = [w for w in re.findall(r"[ঀ-৿]+", text or "") if len(w) >= 3]
    if heard_words:
        cached = getattr(index, "_bn_name_words", None)
        if cached is None:
            names = {index.item_id(it): [w for w in to_bangla_script(re.sub(r"\(.*?\)", " ", str(it.get("name") or ""))).split()
                                         if len(w) >= 3] for it in index.items}
            common: Dict[str, int] = {}
            for ws in names.values():
                for w in set(ws):
                    common[w] = common.get(w, 0) + 1
            index._bn_name_words = cached = (names, common)  # type: ignore[attr-defined]
        names, common = cached
        # (and every food word said fits the name: "বিফ তেহারি" is not বিফ পোলাও just because বিফ is its own word)
        said_food = [h for h in heard_words if h not in _NOT_FOOD_WORDS and h not in _EVERYDAY and _said_quantity(h) is None
                     and not PRICE_WORD.search(h)]
        fits = []
        for it in index.items:
            ws = names[index.item_id(it)]
            own = [w for w in ws if common.get(w, 0) == 1]
            if (own and all(max(_fz2.ratio(w, h) for h in heard_words) >= 78 for w in own)
                    and all(max(max(_fz2.ratio(w, h), _fz2.ratio(w, re.sub("(ের|এর|র)$", "", h))) for w in ws) >= 70
                            for h in said_food)):
                fits.append(it)
        if len(fits) == 1:
            return fits
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
    # "একটা বার্গার দেন" — a KIND said (its category's word), and the model picked one of them (Triple Cheese Tower
    # has no "burger" in its name): which one is the guest's to say
    kind_said = (words & _name_tokens(str(it.get("category") or ""))) - mine - _CAT_GENERIC
    if not said and kind_said:
        same = [o for o in index.items if o is not it and orderable.get(index.item_id(o), True)
                and kind_said & (_name_tokens(o.get("name")) | _name_tokens(str(o.get("category") or "")))]
        if same:
            return [it] + same[:5]
    if not said or said == mine:
        return []  # nothing named (a reference) or the full name said
    # "ফ্রাইড রাইস আর চিকেনের কিছু" — "something chicken" asks which: the model's pick of one is a suggestion, not
    # what they ordered (it added a Chicken Cashew Nut)
    if re.search(r"(?<![ঀ-৿])কিছু(?![ঀ-৿])|\b(something|anything|kichu)\b", heard, re.I):
        others = [o for o in index.items if o is not it and orderable.get(index.item_id(o), True)
                  and said <= _name_tokens(o.get("name"))]
        if others:
            return [it] + others[:5]

    def base_of(x: Dict[str, Any]) -> set:
        return _name_tokens(re.sub(r"\(.*?\)", " ", str(x.get("name") or "")))

    base = base_of(it)
    if base and base <= words and not any(o is not it and base_of(o) == base for o in index.items):
        return []  # "রুই মাছ" = রুই মাছ (গ্লাসি): the bracket is how it's made, not another dish
    # "ভাত" at a rice-and-curry place is the সাদা ভাত — the সুগন্ধি / পোলাও ones are asked for by name
    if (bangla_meal.is_plain_rice(it) and re.search(r"সাদা|^\s*ভাত\s*$|\b(plain|white|steamed)\b", str(it.get("name") or ""), re.I)
            and not (words & {t for o in index.items if o is not it and bangla_meal.is_plain_rice(o) for t in _name_tokens(o.get("name"))} - mine)):
        return []
    if any(o is not it and _name_tokens(o.get("name")) and _name_tokens(o.get("name")) <= words for o in index.items):
        return []  # the guest said ANOTHER dish in full — the retargeting fix corrects the pick, no question needed

    def head(x: Dict[str, Any]) -> set:
        last = re.findall(r"[A-Za-z]+|[ঀ-৿]+", re.sub(r"\(.*?\)", " ", str(x.get("name") or "")))
        return _guest_tokens(last[-1], _menu_rev(index)) if last else set()

    # "ব্রাউনি দুইটা": Chocolate Brownie IS a brownie, Oreo Brownie Sundae is a sundae — the dish the word is the
    # last word of, when it's the only one
    h = head(it)
    if h and h <= words and not any(o is not it and head(o) and head(o) <= words and said <= _name_tokens(o.get("name"))
                                    for o in index.items if orderable.get(index.item_id(o), True)):
        return []
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


# "কোক বাদ", "স্যুপটা বাদ দিন", "বোরহানি লাগবে না" — one tray line out
_TAKE_OUT_SAID = re.compile(
    r"(বাদ|বাতিল|ক্যান্সেল)\s*((দেন|দিন|দাও|দিবেন|দেবেন|করেন|করুন)|(করে|দিয়ে) (দেন|দিন|দাও))?\s*[.!।]?\s*$|"
    r"(লাগবে না|চাই না|নিব না|নেব না|নেবো না)\s*[.!।]?\s*$|^\s*(remove|cancel)\b|\b(remove|cancel)( it| that| this)?\s*[.!]?$",
    re.I,
)


def _take_out(transcript: str, index: MenuIndex, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"কোক বাদ" → that tray line removed — when exactly one line is meant (the model once read "কোক বাদ" as a question
    about Coke brands, then removed it on "না থাক কোক টা দেন"). A count ("একটা কমান") or "সব" → the usual flow."""
    t = transcript or ""
    if not rows or not _TAKE_OUT_SAID.search(t) or "?" in t or _said_quantity(t):
        return []
    if re.search(r"(?<![ঀ-৿])(সব|সবগুলো|সবকিছু|পুরো)(?![ঀ-৿])|\b(all|everything)\b", t, re.I):
        return []
    named = {index.item_id(it) for it in _dishes_named(t, index, limit=4)}
    said = _guest_tokens(t, _menu_rev(index)) - _CAT_GENERIC
    hits = []
    for r in rows:
        it = index.by_id.get(str(r.get("itemId"))) or {}
        if not it:
            continue
        mine = _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")))
        if index.item_id(it) in named or (said and said & mine):
            hits.append((r, it))
    if len(hits) != 1:
        return []
    r, it = hits[0]
    return [{"op": "remove", "item": index.ref(it), "line": r.get("line")}]


_SWAP_SAID = re.compile(r"করে (দেন|দিন|দাও|দিবেন|দেবেন)|বদলে|এর জায়গায়|এর জায়গায়|না দিয়ে|\b(instead|change (it |that )?to|"
                        r"replace|swap)\b", re.I)


def _swap_dish(transcript: str, index: MenuIndex, orderable: Dict[str, bool],
               rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"ফ্রাইড রাইস টা এগ ফ্রাইড রাইস করে দেন" → the tray's Chicken Fried Rice out, Egg Fried Rice in, same count —
    one new dish named, one tray line of its kind (it once said "ঠিক কী বদলাবো বুঝতে পারিনি")."""
    t = transcript or ""
    if not rows or not _SWAP_SAID.search(t) or "?" in t:
        return []
    in_tray = {str(r.get("itemId")) for r in rows}
    new = [it for it in _dishes_named(t, index, limit=4) if index.item_id(it) not in in_tray]
    if len(new) != 1 or not orderable.get(index.item_id(new[0]), True):
        return []
    fam = menu_answers.families(new[0])
    said = _guest_tokens(t, _menu_rev(index))
    old = []
    for r in rows:
        it = index.by_id.get(str(r.get("itemId"))) or {}
        if it and fam & menu_answers.families(it) and said & _name_tokens(re.sub(r"\s*\(.*?\)", "", str(it.get("name") or ""))):
            old.append((r, it))
    if len(old) != 1:
        return []
    r, it = old[0]
    qty = int(r.get("quantity") or 1)
    return [{"op": "remove", "item": index.ref(it), "line": r.get("line")},
            {"op": "add", "item": index.ref(new[0]), "line": "", "quantity": qty}]


_EACH = re.compile(r"(?<![ঀ-৿])([ঀ-৿]+টা|[ঀ-৿]+টি|\d+টা|\d+টি|দুটো|দুটা)\s*করে\s*(দেন|দিন|দাও|দিবেন|করেন|করুন)|"
                   r"\b(two|three|four|five|\d+) of each\b|সবগুলো\s*([ঀ-৿]+টা|\d+টা)\s*করে", re.I)


def _each_to(transcript: str, index: MenuIndex, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"দুইটা করে দেন" with no dish named → every tray line to two (it once changed only the rice)."""
    t = transcript or ""
    if len(rows) < 2 or not _EACH.search(t) or _dishes_named(t, index, limit=1):
        return []
    n = _said_quantity(t)
    if not n or n > 20:
        return []
    ops = []
    for r in rows:
        it = index.by_id.get(str(r.get("itemId"))) or {}
        if it and int(r.get("quantity") or 1) != n:
            ops.append({"op": "set", "item": index.ref(it), "line": r.get("line"), "quantity": n})
    return ops


_ALL_OF_THOSE = re.compile(
    r"^\s*((ঠিক আছে|ওকে|আচ্ছা|হ্যাঁ|হ্যা|জি)[,\s]*)?(ওগুলো|এগুলো|ঐগুলো|ওগুলা|এগুলা|সবগুলো|সবগুলা|সব কয়টা|সবকটা|তিনটাই|"
    r"দুইটাই|দুটোই|সবই)ই?\s*(দেন|দিন|দাও|দিবেন|দিয়ে দেন|নিব|নেব)\s*[.!।]?\s*$|\b(all of (them|those)|all three|both)\b.*"
    r"\b(please|give|add|take)\b", re.I)


def _take_all_listed(transcript: str, index: MenuIndex, orderable: Dict[str, bool], listed: List[Dict[str, Any]],
                     cart_qty: Dict[str, int], last_waiter: str = "") -> List[Dict[str, Any]]:
    """"ঠিক আছে ওগুলোই দেন" right after 2–6 dishes were suggested → one of each (it once asked "কতগুলো অর্ডার করতে
    চান?"). "Those" are the dishes the waiter SAID (the cards may hold more); one that needs a size or a choice is
    left to the usual flow (it asks). More than six, or nothing just said → the usual flow."""
    if not _ALL_OF_THOSE.search(transcript or ""):
        return []
    said = {index.item_id(it) for it in find_mentions(last_waiter or "", index, limit=8)}
    listed = [it for it in listed if index.item_id(it) in said] or listed
    if any(len([v for v in it.get("variations") or [] if v.get("name")]) > 1
           or any(int(g.get("min") or 0) >= 1 for g in it.get("modifierGroups") or []) for it in listed):
        return []
    if not 2 <= len(listed) <= 6:
        return []
    return [{"op": "add", "item": index.ref(it), "line": "", "quantity": 1} for it in listed
            if orderable.get(index.item_id(it), True) and index.item_id(it) not in cart_qty]


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
    """What we CAN make instead: a dish of the same course and kind (menu_answers.alternatives) — never ইলিশ ভর্তা for a
    সরষে ইলিশ, never Hot Wings for a burger."""
    better = menu_answers.alternatives(it, index, orderable, skip=set(skip) | set(blocked), limit=limit)
    if better:
        return better
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
    # "দশ মিনিট লাগবে?", "১৫ মিনিটে হবে?", "10 minutes?" — a number of minutes is a time, never a size or a count
    r"(মিনিট|মিনিটে|ঘণ্টা|ঘন্টা|ঘণ্টায়)\s*(লাগবে|লাগে|হবে|পাব|পাবো|আসবে|দেবেন)|\b\d+\s*(min|mins|minutes?|hours?)\b|"
    r"\b(koto ?khon|koto (shomoy|somoy|minute)|shomoy|somoy)\s+lag(b)?e\b",
    re.I,
)


def _orders_now(transcript: str) -> bool:
    return bool(_ORDERS_NOW.search(_TIME_TAKES.sub(" ", transcript or "")))
_QUESTION = re.compile(r"\?|^\s*(what|which|how|is|are|do|does|can|could|any|should|where|when)\b|(?<![\u0980-\u09FF])(কি|কী)(?![\w\u0980-\u09FF])|কোন", re.I)


def _is_question_not_order(transcript: str) -> bool:
    t = (transcript or "").strip()
    if _TIME_TAKES.search(t):
        return True  # "দশ মিনিট লাগবে?" — "লাগবে" here is time, not an order
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
        # the same dish listed twice (a breakfast copy and a lunch copy of "গরুর কালা ভুনা"): the one that can be
        # ordered now — the other once dropped the order with a bare "দুঃখিত, কোনটা বোঝালেন?"
        if kind in ("add", "set") and not row:
            it = _orderable_twin(it, index, orderable) or it
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

    named = _dishes_named(transcript, index, limit=6)
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
            continue
        # one dish said by name, and the model's dish shares none of the guest's own words — only a kind like "fish"
        # ("রুই মাছ একটা" → চিংড়ি ষোল আনা was added): it's the dish they said
        mine = index.by_id.get(op["itemId"])
        if (op["op"] == "add" and len(named) == 1 and sid not in op_ids and mine is not None
                and sum(o["op"] == "add" for o in ops) == 1 and said.get("available") is not False):
            core = _name_tokens(re.sub(r"\(.*?\)", " ", str(mine.get("name") or "")))
            if not (core & _guest_tokens(transcript, _menu_rev(index))) - _KIND_WORDS:
                fixes.append(f"{op['name']} → {said.get('name')}")
                op["itemId"], op["name"] = sid, said.get("name")
                op_ids.add(sid)
    return fixes


# words a dish name shares with a whole kind of dishes — saying one names the kind, not the dish
_KIND_WORDS = {"fish", "chicken", "beef", "mutton", "prawn", "rice", "naan", "curry", "bhuna", "kebab", "drink", "soup",
               "মাছ", "ভুনা", "কাবাব", "ভাত"}


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


def _counted(w: str) -> bool:
    """"২টা" / "3 pcs" — the part after a number says it's a count (the counter words are _BN_SUFFIX's)."""
    return bool(_BN_SUFFIX.search(w or "")) or bool(re.search(r"(pcs?|x)$", w or "", re.I))


def _name_numbers_said(text: str) -> set:
    """Numbers said as PART of a name — "সেট মেনু-৩", "Set Menu 3", "কম্বো তিন" — not as a count ("একটি", "২টা").
    ("একটি সেট মেনু-৩" once matched Set Menu-1: the "এক" of একটি.)"""
    out = set()
    for w in re.split(r"[\s\-–,।?!]+", (text or "").translate(_BN_DIGITS)):
        m = re.match(r"^(\d+)(.*)$", w)
        if m:
            if not _counted(m.group(2)):
                out.add(str(int(m.group(1))))
            continue
        if not w:
            continue
        val = _NUM_WORDS.get(_phon(w)) or _NUM_WORDS.get(w.lower())
        if val:
            out.add(val)
    return out


def _without_name_number(seg: str, it: Dict[str, Any]) -> str:
    """"সেট মেনু-৩ দুইটা" → "সেট মেনু- দুইটা": the ৩ is the dish's own number (Set Menu-3), not three of them (it
    made 3 × Set Menu-1). Only a bare number — "৩টা" is still a count."""
    nums = {str(int(n)) for n in re.findall(r"\d+", str(it.get("name") or ""))}
    if not nums:
        return seg
    out, dropped = [], False
    for w in re.split(r"(\s+|-)", seg.translate(_BN_DIGITS)):
        bare = str(int(w)) if w.isdigit() else (_NUM_WORDS.get(_phon(w)) if w.strip() else None)
        if not dropped and bare in nums:
            dropped = True
            continue
        out.append(w)
    return "".join(out)


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
        said = _said_quantity(_without_size_count(_without_name_number(segs[k], it), it))
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
    r"সাথে\s.*(নিলে|নিতে পারেন|ভালো যাবে|ভালো যায়|ভালো লাগবে|দারুণ|জমবে|ট্রাই|উপভোগ)|(নিলে|নিতে পারেন)\s.*(দারুণ|ভালো|জমবে)|"
    r"goes (really )?(well|great) with|pairs? (well|nicely)|you (could|might|may) (also )?(add|try|get|like)|"
    r"how about (a|an|some|adding)|(would|do) you (like|want) (a|an|some|any) .*(with (it|that|this|your)|to go with)|"
    # the model's own "and rice?" — the offer engine asks it, only for a curry (it once asked it after a খিচুড়ি)
    r"(সাথে|সঙ্গে)\s*(কি\s*)?(ভাত|রাইস|পরোটা|নান|রুটি)\s*(ও\s*)?(নেবেন|নিবেন|দেব|দিব|লাগবে|চান|নিতে চান)|"
    r"ভাতের সাথে (খেতে|নিতে) চান|ভাত(ও)? (অর্ডার করতে|নেবেন|নিবেন|নিতে চান)|"
    r"\b(would you like|do you want|want) (some |to have )?(rice|naan|bread)\b|\brice with it\b",
    re.I,
)


# the guest is asking for another dish (or one that suits a need) — an alternative is the answer, not a pitch
_WANTS_OTHER = re.compile(
    r"ঝাল|spic|\bhot\b|অ্যালার্জ|এলার্জ|allerg|নিরামিষ|ভেজ|\bveg|হালাল|halal|বাজেট|budget|সস্তা|cheap|দাম|price|"
    r"অন্য|বদলে|instead|other|alternative|মতো|মত\b|similar|like it|আর কী|আর কি|ছাড়া|without|কম\s|less|বেশি|more|"
    # something to go WITH it — "ক্লাসিক ফ্রাইজের সাথে কী খাওয়া যেতে পারে?" asks for other dishes
    r"সাথে|সঙ্গে|\bwith\b|\bpair|goes? well|মিলিয়ে|\bshathe\b|\bsathe\b",
    re.I,
)


# "which of these…?" — what the guest compares them ON (the facts we can answer it from)
_CMP_MILD = re.compile(r"কম ঝাল|ঝাল কম|ঝাল ছাড়া|ঝাল নেই|ঝাল নাই|\bmild|least spicy|not spicy|less spicy|kom jhal", re.I)
_CMP_HOT = re.compile(r"বেশি ঝাল|ঝাল বেশি|সবচেয়ে ঝাল|সব থেকে ঝাল|spiciest|most spicy|hottest|beshi jhal", re.I)
_CMP_CHEAP = re.compile(r"সস্তা|কম দাম|দাম কম|কমদামি|cheap|least expensive|lowest price|affordable|kom dam|shosta|sosta", re.I)
_CMP_PRICEY = re.compile(r"দামি|বেশি দাম|দাম বেশি|expensive|priciest|beshi dam", re.I)
_CMP_BEST = re.compile(r"কোনটা (নেব|নিব|দেব|নেওয়া)|কোনটা নিলে|which (one )?(should|would)|which is better|better", re.I)


def _compare_criterion(transcript: str) -> Optional[str]:
    t = transcript or ""
    if _CMP_MILD.search(t):
        return "mild"
    if _CMP_HOT.search(t):
        return "hot"
    if _CMP_CHEAP.search(t):
        return "cheap"
    if _CMP_PRICEY.search(t):
        return "pricey"
    if _WANTS_A_PICK.search(t) or _CMP_BEST.search(t):
        return "best"
    return None


def _lowest_price(it: Dict[str, Any]) -> float:
    """What the dish costs at its smallest size (the price a guest compares)."""
    sizes = [float(v.get("price") or 0) for v in it.get("variations") or [] if v.get("price") is not None]
    return min(sizes) if sizes else float(it.get("price") or 0)


_INFO_Q = re.compile(
    r"ওয়াশরুম|ওয়াশরুম|টয়লেট|বাথরুম|পার্কিং|ওয়াইফাই|ওয়াইফাই|ওয়াই ফাই|পাসওয়ার্ড|পাসওয়ার্ড|নামাজ|চার্জার|"
    r"\b(wi-?fi|password|washroom|toilet|restroom|bathroom|parking|prayer|charger)\b",
    re.I,
)  # questions about the place, not the food (answered, and no dish pitched after them)

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
    contact_missing: Optional[List[str]] = None,
) -> Tuple[Optional[str], Dict[str, Any], Dict[str, Any]]:
    """Checkout action → (reply to speak or None to keep the model's, decision flags, new checkout state).
    Online (pickup / delivery) guests have no table and are never placed by voice: the read-back asks "shall I
    confirm the order?" (the tray opens), a yes opens the details form — naming only what's still missing
    (`contact_missing`) — and the guest taps Confirm order there."""
    tbl = table or ""
    sig = co.cart_signature(rows)
    lead = (ops_line + " ") if ops_line else ""
    if online and action == "readback":
        return (lead + co.online_readback_text(rows, lang), {"showCheckout": True, "checkoutStage": "readback"},
                {"stage": "readback", "sig": sig, "table": ""})
    if online and action in ("ask_table", "place"):
        return (lead + co.online_details_text(contact_missing, lang),
                {"showCheckout": True, "askDetails": True, "checkoutStage": "details"}, {"stage": "details", "sig": sig, "table": ""})
    if action == "readback":
        text = co.readback_text(rows, tbl, lang, _vat_hint(restaurant, lang), eta_hint)
        return lead + text, {"showCheckout": True, "checkoutStage": "readback"}, {"stage": "readback", "sig": sig, "table": tbl}
    if action == "ask_table":
        # "send it" with no table yet: once the table is given, it is placed straight away
        direct = co.wants_send_now(transcript) or bool(prev.get("direct"))
        return (lead + co.ask_table_text(lang), {"askTable": True, "checkoutStage": "table"},
                {"stage": "table", "sig": "", "table": "", **({"direct": True} if direct else {})})
    if action == "place":
        if prev.get("stage") == "readback" or not rows:
            text = "ঠিক আছে, অর্ডারটা দিচ্ছি…" if lang == "bn" else "Great — placing your order now…"
        else:
            # confirmed straight from "…নাকি অর্ডার কনফার্ম করব?" (no second question): say what's going to the kitchen
            lines = ", ".join(co._line_label(r) for r in rows)
            text = (f"ঠিক আছে — {lines} — অর্ডারটা দিচ্ছি…" if lang == "bn"
                    else f"Great — {lines} — placing your order now…")
        return text, {"placeOrder": True, "checkoutStage": "placing"}, {"stage": "none", "sig": sig, "table": tbl}
    if action == "hold":
        text = None if "?" in transcript else lead + co.held_text(lang)
        return text, {"checkoutStage": "none"}, {"stage": "none", "sig": "", "table": tbl}
    if action == "empty":
        # (AI-first: the model says it, knowing why the tray is empty — at 1am it said "your tray is empty", never
        # that the café was closed)
        return (None if AI_FIRST else co.empty_cart_text(lang)), {"checkoutStage": "none"}, {"stage": "none", "sig": "", "table": tbl}
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
_SAYS_AVAILABLE = re.compile(
    r"পাওয়া যাবে|পাওয়া যাচ্ছে|পাওয়া যায়|এখন আছে|আছে(?![ঀ-৿])|দেওয়া যাবে|অর্ডার করতে পারেন|"
    r"\b(is|are) available\b|\bwe have\b|\byou can (order|get|have)\b|\bavailable (now|right now|today)\b",
    re.I,
)
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
    bn = lang == "bn"
    counted = bool(re.search(r"(?<![ঀ-৿])(একটা|একটি|দুইটা|দুটো|দুটা|তিনটা|চারটা|[০-৯0-9]+\s*টা)(?![ঀ-৿])|\b(one|two|three|[0-9]+)\b",
                             transcript or "", re.I)) and bool(_dishes_named(transcript, index, limit=1))
    if (_orders_now(transcript) or counted) and not _QUESTION.search(transcript):
        # an order we can't take without the model: never a list of prices for it ("burgers: Classic Smash Burger
        # (৳390), …" was the answer to "একটা ক্লাসিক স্মাশ বার্গার দিন") — the menu, where they can add it themselves
        return (("দুঃখিত, এই মুহূর্তে অর্ডারটা নিতে পারছি না — মেনু থেকে ট্রেতে যোগ করে দিন, অথবা একটু পরে আবার বলুন।" if bn
                 else "Sorry, I can't take that order right now — please add it from the menu, or try me again in a moment."),
                {"intent": "menu", "topic": "other", "decision": {"openMenu": True}})
    have = [(k, [i for i in items if orderable.get(index.item_id(i), True)]) for k, items in kind_items(transcript, index)]
    miss = missing_kinds(transcript, index)
    if have or miss:
        parts = []
        for kind, items in have:
            said = [bangla_meal.said_name(i) for i in items[:4]]
            # (the said name drops "(Half)" — keep the full name when two would read the same)
            listed = ", ".join(f"{s if said.count(s) == 1 else bangla_meal._SYMBOLS.sub('', str(i.get('name'))).strip()} ({_money(i.get('price'))})"
                               for s, i in zip(said, items[:4]))
            if listed:
                parts.append(f"আমাদের আছে {listed}।" if bn else f"Yes — for {kind} we have {listed}.")
        for kind in miss:
            parts.append(f"দুঃখিত, আমাদের মেনুতে {kind} নেই।" if bn else f"Sorry, we don't have {kind}.")
        if parts:
            return " ".join(parts), {"intent": "menu", "topic": "availability"}
    hits = _dishes_named(transcript, index, limit=3)
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
    "খাবো", "খাব", "শুধু", "khabo",
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


_SHORT_ASK = re.compile(r"(চান|করবেন|নেবেন|নিবেন|দেব|দিব|লাগবে|খাবেন|would you like|shall i|do you want|want (it|to))\s*\?\s*$", re.I)


def _one_last_question(text: str) -> str:
    """Two short yes/no questions back to back at the end → only the last ("এটা খেতে চান? অর্ডার করতে চান?")."""
    parts = re.findall(r"[^।.!?]+[।.!?]?", text or "")
    while len(parts) >= 2:
        a, b = parts[-2].strip(), parts[-1].strip()
        if (a.endswith("?") and b.endswith("?") and _SHORT_ASK.search(a) and _SHORT_ASK.search(b)
                and len(a.split()) <= 7 and len(b.split()) <= 7):
            parts = parts[:-2] + [" " + b]
            continue
        break
    out = "".join(parts).strip()
    return re.sub(r"(অর্ডার)\s+\1", r"\1", out)


# what's IN a dish ("কম্বোতে কি কি থাকে?", "সেট মেনুতে কী দেয়?", "what comes with it?") — not a list of that kind
_CONTENTS_Q = re.compile(
    r"(কি|কী)\s*(কি|কী)?\s*(থাকে|দেয়|দেওয়া হয়|দেয়া হয়|আসে)|উপকরণ|"
    r"\bwhat('s| is| comes| do you get)? (in|inside|with) (it|the|a|this|that)\b|\bincludes?\b|\bcomes? with\b",
    re.I,
)


# the waiter's last words asked which one ("…অথবা Coca-Cola — কোনটা দেব?", "Which one would you like?")
_WHICH_ASKED = re.compile(r"কোনটা (দেব|দিব|নেবেন|নিবেন|অর্ডার করবেন)\s*\?|\bwhich (one )?(would you like|shall i add)\b", re.I)


def _clean_order(transcript: str, index: MenuIndex, orderable: Dict[str, bool], cart_qty: Dict[str, int]) -> List[Dict[str, Any]]:
    """"দুইটা ক্রিস্পি রাইস স্যুপ আর একটা ফ্রেঞ্চ ফ্রাই দিন" → [add 2 × Crispy Rice Soup, add 1 × French Fry] — when
    it is that simple: an order word, every dish named in full (not already in the tray), a quantity per dish, and no
    other word that could change it. Anything else → [] (the model reads it). A dish with a size / choice to pick goes
    in without one — it's held and asked about (the clear dishes are added and said first), never left to the model,
    which used to just ask and add nothing at all."""
    t = (transcript or "").strip()
    # ("শুধু ডাল আর ভাত খাবো" — "I'll have…" said as "I'll eat…", never a question)
    eats = bool(re.search(r"(?<![ঀ-৿])(খাবো|খাব|খাবো)(?![ঀ-৿])|\bkhabo\b", t)) and not _QUESTION.search(t)
    # "দুইটা পরোটা আর একটা ডাল ভাজি" — a count for every dish and no question: an order, verb or not
    # ("দুইটা পরোটা আর ডিম ভাজি" — a list of dishes with a count said for some: the rest are one each)
    segs = [s for s in re.split(r"\s*(?:,|।|\s(?:আর|এবং)\s)\s*", t) if s.strip()]
    counted = not _QUESTION.search(t) and "?" not in t and (
        all(_said_quantity(s) for s in segs) or (len(segs) >= 2 and any(_said_quantity(s) for s in segs)))
    if not t or not (_orders_now(t) or eats or counted) or _NOT_CLEAN.search(t):
        return []
    rev = _menu_rev(index)
    ops: List[Dict[str, Any]] = []
    plain_rice = [d for d in index.items if bangla_meal.is_plain_rice(d) and orderable.get(index.item_id(d), True)]
    plain_rice.sort(key=lambda d: (not re.search(r"সাদা|plain|white|steamed", str(d.get("name") or ""), re.I),
                                   len(str(d.get("name") or ""))))
    for seg in [s.strip() for s in re.split(r"\s*(?:,|।|\s(?:আর|এবং)\s)\s*", t) if s.strip()]:
        dishes = _dishes_named(seg, index, limit=2)
        if not dishes and plain_rice and re.search(r"(?<![ঀ-৿])ভাত(?![ঀ-৿])", seg):
            dishes = plain_rice[:1]  # "ভাত" is the সাদা ভাত
        if len(dishes) != 1:
            return []
        it = dishes[0]
        iid = index.item_id(it)
        said = seg  # (the guest's own words — the count is read from these)
        if not orderable.get(iid, True):
            # "ডাল" at lunch when the breakfast ডাল is off but "ড - তে ডাল" is on: the one that's on, if just one
            alt = _same_dish_on_now(it, index, orderable)
            if alt is None:
                return []
            it = alt
            iid = index.item_id(it)
            seg = f"{seg} {it.get('name')}"  # (its words are now said)
        if cart_qty.get(iid) or _ambiguous_pick(it, index, orderable, seg):
            return []
        mine = _name_tokens(it.get("name"))
        for w in re.findall(r"[A-Za-z']+|[ঀ-৿]+|\d+", seg.translate(_BN_DIGITS)):
            lw = w.lower()
            if lw in _ORDER_FILLER or _said_quantity(w) is not None or lw.isdigit():
                continue
            if _guest_tokens(w, rev) and _guest_tokens(w, rev) <= mine:
                continue  # a word of the dish's name
            if it in _dishes_named(w, index, limit=2):
                continue  # what the dish is called for short ("কোক" — Coca-Cola)
            return []  # a word we can't place ("ভাইস", "ঝোল"…) — let the model read the whole sentence
        # the count, not a number in the dish's own name: "পরোটা দাও" → 1 পাঁচ পরোটা (not 5), "দুইটা পাঁচ পরোটা" → 2
        name_words = {w for w in re.findall(r"[ঀ-৿]+|[A-Za-z]+", str(it.get("name") or ""))}
        count_words = " ".join(w for w in re.findall(r"\S+", said) if w not in name_words)
        ops.append({"op": "add", "item": index.ref(it), "quantity": _said_quantity(count_words) or 1})
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


_PAY_Q = re.compile(r"পেমেন্ট|পে করা|পে করব|বিকাশ|নগদে|রকেট|কার্ড (নেন|নেবেন|চলে|দিয়ে)|ক্যাশ (নেন|দিতে)|বিল (কিভাবে|কীভাবে)|"
                    r"\b(payment|pay (by|with)|bkash|nagad|card|cash only|visa|mastercard|amex)\b", re.I)

_THANKS = re.compile(
    r"^(অনেক\s+)?(ধন্যবাদ|থ্যাংক\s*ইউ|থ্যাংকস|থ্যাঙ্কস|শুকরিয়া|শুকরিয়া|thank\s*you|thanks|thanx|thx|ty)"
    r"(\s+(ভাই|আপু|ভাইয়া|so much|a lot|very much))?[\s!.।]*$",
    re.I,
)


# "মোট কত হলো?", "কত হলো?", "বিল কত?", "সব মিলিয়ে কত?" — the tray's sum ("এক হাজারের মধ্যে থাকবে?" is a budget: the model)
_TRAY_TOTAL_Q = re.compile(
    r"(মোট|টোটাল|সব মিলিয়ে|সব মিলে|সবমিলিয়ে|বিল)\s*(কত|কতো|কোতো)|(কত|কতো|কোতো)\s*(হলো|হল|হইলো|হয়েছে|হয়েছে|হবে|পড়বে|পড়বে)\s*\??\s*$|"
    r"\b(total|how much (is it|in all|altogether|so far)|what'?s the (total|bill))\b|\b(mot|total) koto\b|\bkoto (holo|hoilo|hobe)\b",
    re.I,
)
# "আর একটা ডাল দিলে কত হবে?" — if this were added
_IF_ADDED = re.compile(r"(দিলে|নিলে|যোগ করলে|অ্যাড করলে)\s*(মোট\s*)?(কত|কতো)|\bif (i|we) (add|get|take)\b", re.I)


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


def _owner_pick(transcript: str, rules: Any, index: MenuIndex,
                orderable: Dict[str, bool]) -> Optional[Tuple[str, List[str]]]:
    """The owner's rule for what the guest is asking for: (the word they used, the rule's dishes that can be ordered
    now, in the owner's order) — the longest matching word wins. None: no rule matches (the AI picks)."""
    text = re.sub(r"\s+", " ", str(transcript or "").lower())
    best: Optional[Tuple[str, List[str]]] = None
    best_len = 0
    for rule in rules if isinstance(rules, list) else []:
        if not isinstance(rule, dict) or rule.get("on", True) is False:
            continue
        ids = [str(i) for i in rule.get("itemIds") or [] if str(i) in index.by_id and orderable.get(str(i), True)]
        if not ids:
            continue
        for phrase in rule.get("phrases") or []:
            w = re.sub(r"\s+", " ", str(phrase or "").strip().lower())
            if len(w) < 2:
                continue
            # English words whole ("hot" isn't "hotel"); Bangla as written (it takes endings: "ঝালের", "ঝাল-টা")
            hit = (re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) if re.fullmatch(r"[a-z0-9 '&-]+", w)
                   else w in text)
            if hit and len(w) > best_len:
                best, best_len = (str(phrase).strip(), ids), len(w)
    return best


_ASKS_OR_ORDERS = re.compile(r"আছে|আছেন|পাওয়া|পাওয়া|হবে|দিন|দেন|দাও|দিবেন|দেবেন|নেব|নিব|খাবো|\b(have|got|available|get)\b",
                             re.I)


def _not_this_version(transcript: str, index: MenuIndex) -> Optional[Tuple[str, Dict[str, Any]]]:
    """("আলুর পরোটা", পরোটা) when the guest asks for a dish with a food word in front of it ("আলুর", "ডিমের",
    "chicken") that no dish on the menu has with it — the plain dish is all there is."""
    t = transcript or ""
    if len(t.split()) > 6 or not _ASKS_OR_ORDERS.search(t):
        return None
    hits = _dishes_named(t, index, limit=1)
    if not hits:
        return None
    it = hits[0]
    name_toks = _name_tokens(str(it.get("name") or ""))
    rev = _menu_rev(index)
    raw = re.findall(r"[A-Za-z]+|[ঀ-৿]+", t)
    for i, w in enumerate(raw):
        if i == 0 or not (_guest_tokens(w, rev) & name_toks):
            continue
        prev = raw[i - 1]
        before = _guest_tokens(prev, rev)
        plain = set(_SIZE_TOKENS.values()) | set(_BN_WORDS.values()) | set(_NUM_TOKENS.values())
        if (not before or before & name_toks or before & plain or any(x.isdigit() for x in before)
                or prev in _EVERYDAY or _BN_SUFFIX.sub("", prev) in _EVERYDAY):
            return None
        if any(_name_tokens(str(o.get("name") or "")) >= (name_toks | before) for o in index.items):
            return None  # there IS such a dish (it just wasn't the first match)
        from rapidfuzz import fuzz as _fz
        if any(_fz.ratio(prev, w) >= 70 for w in to_bangla_script(str(it.get("name") or "")).split()):
            return None  # a word of its own name, spelt another way ("বিফ শিক কাবাব" is Beef Shik Kabab, not a version)
        # (only the words of the dish — "হট উইংস দেন আর কিছু" once came out as the dish asked for)
        own = []
        for x in raw[i:i + len(name_toks)]:
            if not (_guest_tokens(x, rev) & name_toks):
                break
            own.append(x)
        dish_words = " ".join(own)
        return f"{prev} {dish_words}", it
    return None


# a time of day the guest names → a moment on the restaurant's clock (minutes after midnight), read against ITS
# service periods (Settings → Hours): whatever they're called, "বিকেলে" is the one running at 4:30 pm
_WHEN_SAID = (
    ("এখন", r"(?<![ঀ-৿])এখন(?![ঀ-৿])|\bright now\b|\bnow\b|\bekhon\b", None),
    ("মাঝরাতে", r"মাঝরাত|গভীর রাত|\blate night\b|\bmidnight\b", 23 * 60 + 30),
    ("সকালে", r"সকাল|শকাল|ভোর|\bbreakfast\b|\bmorning\b|\bs[h]?okal\w*", 9 * 60),
    ("দুপুরে", r"দুপুর|\blunch\b|\bnoon\b|\bdupur\w*", 13 * 60 + 30),
    ("বিকেলে", r"বিকেল|বিকাল|বৈকাল|\bafternoon\b|\bbik[ae]l\w*|\bteatime\b", 16 * 60 + 30),
    ("সন্ধ্যায়", r"সন্ধ্যা|সন্ধা|সন্ধে|\bevening\b|\bsh?ond?h?y?a\w*", 18 * 60 + 30),
    ("রাতে", r"(?<![ঀ-৿])রাত|রাত্রে|ডিনার|\bdinner\b|\bnight\b|\braa?t(e|er)?\b|\brat e\b", 21 * 60),
)
# "… কি আছে / কী পাওয়া যায় / কি খাওয়া যাবে?", "what's on…", "what can I eat…" — asks what is served
# "এখানে খাওয়া যেতে পারে?", "কি খাবো?", "what can I eat?" — asks what there is to EAT (now, unless a time is said)
_EAT_ASK = re.compile(
    r"খাওয়া\s*যে(তে|ত)\s*পারে|খাওয়া\s*যে(তে|ত)\s*পারে|খাও\s*যে(তে|ত)\s*পারে|খেতে পারি|খাওয়া যায়|খাওয়া যায়|"
    r"(?<![ঀ-৿])(কি|কী)\s*খাব|(?<![ঀ-৿])(কি|কী)\s*খাবো|খাওয়ার মত (কি|কী)|খাওয়ার মত (কি|কী)|"
    r"\bwhat (can|should|could) (i|we) (eat|have)\b|\bki khabo\b|\bkhawa jete pare\b|"
    # speech-to-text: "এখন কি খেতে পারি?" heard as "এখন ঠিক হতে পারি।"
    r"(এখন|এখানে)\s+((ঠিক|কি|কী)\s+(হতে|খেতে)|খিচতে)\s+পারি",
    re.I,
)
_WHATS_SERVED = re.compile(
    r"(?<![ঀ-৿])(কি|কী|কোন|কোনগুলো)\s+([ঀ-৿]+\s+){0,2}(আছে|আছো|পাওয়া|পাওয়া|পাব|পাবো|খাওয়া|খাওয়া|খেতে|হবে|চলে|দেন|দিচ্ছেন)|"
    r"মেনুতে (কি|কী)|মেনু(টা)? (কি|কী)|\bwhat('?s| is| do you have| can (i|we) (eat|get|have|order))\b|"
    r"\bwhat to eat\b|\bki (ache|pawa|khawa)\b|"
    # "এখন কি খাওয়া যেতে পারে?" as speech-to-text writes it: "কি খাও যেতে পারে", "কিই খাবা জেতে পারে", "কি খা঵া জেতে…"
    r"(কি|কী|কিই|কে)\s+খা\S*\s+(যে|জে|ছে)\S*\s+পা\S*",
    re.I,
)
_BN_DIG = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def _period_menu_reply(transcript: str, index: MenuIndex, orderable: Dict[str, bool], periods: List[Dict[str, Any]],
                       now_min: Optional[int], scope: set, lang: str, opening: Optional[List[Dict[str, Any]]] = None,
                       in_tray: Optional[set] = None) -> Optional[Tuple[str, List[Dict[str, Any]], str]]:
    """"বিকেলে কি আছে?" / "রাতে কি পাওয়া যায়?" / "এখন কি খাওয়া যেতে পারে?" — what's served at that time, as a waiter
    says it: the all-day food AND what the owner set for that time (a category's / dish's hours), the rice meal first
    at a Bengali rice house, "we're closed then" outside the opening hours. None → the usual answer ("এখন" with no
    hours set anywhere: the ranked picks already fit the time)."""
    from availability import periods_at  # (a pure helper)

    t = transcript or ""
    eat_ask = bool(_EAT_ASK.search(t))
    if not (_WHATS_SERVED.search(t) or eat_ask):
        return None
    said = next(((label, at) for label, pat, at in _WHEN_SAID if re.search(pat, t, re.I)), None)
    if not said and eat_ask:
        # "এখানে খাওয়া যেতে পারে?" / "কি খাবো?" — no time said: what there is to eat NOW (it once got a pineapple drink
        # and two puddings as "breakfast", from the general picks)
        said = ("এখন", None)
    if not said:
        return None
    label, at = said
    is_now = label == "এখন"
    if at is None:
        if now_min is None:
            return None
        at = now_min
    periods = periods or []
    rules = {"periods": periods}
    target = set(periods_at(at, rules)) if periods else set()
    bn = lang == "bn"
    any_hours = any(it.get("periods") is not None for it in index.items)
    if is_now and not any_hours:
        return None  # no hours anywhere: the usual picks (they already suit the time)

    # closed at that time (the opening hours) → say so, and when it opens
    if opening and not is_now and not any(a <= at < b for a, b in _open_spans(opening)):
        first = min((a for a, _b in _open_spans(opening)), default=None)
        when = _bn_spoken(first) if first is not None else ""
        text = (f"{label} আমরা খোলা থাকি না — আমরা খুলি {when}।" if bn and when
                else f"{label} আমরা খোলা থাকি না।" if bn
                else "We're not open at that time." + (f" We open at {_fmt_hhmm(f'{first // 60}:{first % 60:02d}')}." if first is not None else ""))
        return text, [], "period_closed"

    on_now = is_now or (now_min is not None and bool(target & set(periods_at(now_min, rules))))
    in_scope = lambda it: not scope or index.item_id(it) in scope  # noqa: E731
    now_ok = lambda it: orderable.get(index.item_id(it), True) or not on_now  # noqa: E731
    in_order = sorted(index.items, key=lambda it: index.position.get(index.item_id(it), 1 << 20))  # (the menu's order)
    # never what's already in the tray, never a dish the restaurant switched off or sold out today — at any hour
    on_menu = lambda it: (index.item_id(it) not in (in_tray or set()) and not it.get("hidden")  # noqa: E731
                          and it.get("status") in (None, "active")
                          and not re.search(r"শেষ হয়ে গেছে|sold out", str(it.get("unavailableReason") or ""), re.I))
    in_order = [it for it in in_order if on_menu(it)]
    set_for = [it for it in in_order if set(it.get("periods") or []) & target and in_scope(it) and now_ok(it)]
    all_day = [it for it in in_order if it.get("periods") is None and in_scope(it) and now_ok(it)]
    breakfast = any(re.search(r"breakfast|সকাল|নাস্তা", f"{p.get('id')} {p.get('name')}", re.I)
                    for p in periods if str(p.get("id")) in target)
    p = max((p for p in periods if str(p.get("id")) in target),
            key=lambda p: sum(str(p.get("id")) in (it.get("periods") or []) for it in set_for), default=None)
    hours = (_bn_hours(p.get("start"), p.get("end")) if bn else f"{_fmt_hhmm(p.get('start'))} to {_fmt_hhmm(p.get('end'))}") \
        if p else ""
    open_now = any(orderable.get(index.item_id(it), True) for it in index.items)

    def lead_of(items: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[int]]:
        """(what a waiter names, what's "সাথে … আছে", the kinds) — at breakfast the bread and dal ARE the meal."""
        main = [it for it in items if _period_role(it) == "main" or (breakfast and _period_role(it) in ("bread", "side"))]
        if breakfast:
            main.sort(key=lambda it: ({"bread": 0, "side": 1}.get(_period_role(it), 2),))
        top = _top_kinds(main)
        main.sort(key=lambda it: (top.index(_kind_of(it)) if _kind_of(it) in top else len(top), not is_signature(it))
                  if not breakfast else ({"bread": 0, "side": 1}.get(_period_role(it), 2),))
        return main, [it for it in items if it not in main], top

    def names_of(items: List[Dict[str, Any]], n: int = 4) -> List[str]:
        return list(dict.fromkeys(bangla_meal.said_name(it) for it in items))[:n]

    def kinds_word(items: List[Dict[str, Any]], top: List[int]) -> str:
        if breakfast:
            return "নাস্তার আইটেমগুলো" if bn else "breakfast"
        return _kinds_phrase(items, bn) if top or items else ("এই আইটেমগুলো" if bn else "these dishes")

    def closing(text: str) -> str:
        if on_now:
            return text + (" কোনটা দেব?" if bn else " Which would you like?")
        return text + ((" এখন এগুলো পাওয়া যাচ্ছে না — তবে এখন যা আছে তার থেকে কিছু দেব?" if open_now
                        else " এখন অবশ্য আমরা বন্ধ — তখন এলে পাবেন।") if bn
                       else (" They're not on right now — shall I get you something that is?" if open_now
                             else " We're closed right now — you'll find them then."))

    def cards(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [_suggestion_row(it) for it in items[:12] if orderable.get(index.item_id(it), True)] if on_now else []

    head = label if (on_now or not hours) else f"{label}, মানে {hours},"
    if not bn:
        head = "Right now" if is_now else (f"From {hours}" if hours and not on_now else "At that time")
    set_main, set_rest, set_top = lead_of(set_for)
    day_main, _day_rest, day_top = lead_of(all_day)

    # 1. a Bengali rice house at lunch / dinner: the rice meal first, then what's set for that time
    meal = _rice_meal_then(index, orderable, periods, target, on_now) if bn else None
    if meal:
        rice_line = bangla_meal.meal_text(meal, "bn", rice_in_tray=True).replace("ভাতের সাথে ", "", 1)
        rice_line = rice_line.split("। সাথে")[0].rstrip("।")
        text = f"{head} ভাত খেতে পারেন — ভাতের সাথে {rice_line}।"
        if set_main:
            text += f" আবার চাইলে {_TIME_KIND_SAY[set_top[0]][3] if set_top else 'এগুলো'}ও খেতে পারেন — " \
                    f"{_bn_join(names_of(set_main))}{_with_bread(set_rest)}।"
        meal_items = [meal["rice"]] + [x for g in ("fish", "chicken", "meat") for x in meal.get(g) or []]
        return closing(text), cards(meal_items + set_main + set_rest), "period_menu_meal"

    # 2. food set for that time, and all-day food too (a fast-food place with desserts only at night: the burgers
    #    are still there) → both: "রাতে আমাদের বার্গার তো আছেই — …; আর রাতে মিষ্টিও পাওয়া যায় — …"
    if set_for and len(day_main) >= 3 and not breakfast:  # (breakfast: its own dishes are the answer)
        set_kind = _TIME_KIND_SAY[set_top[0]][3] if set_top else (_TIME_KIND_SAY[_kind_of(set_for[0])][3]
                                                                  if _kind_of(set_for[0]) < len(_TIME_KIND_SAY) else "")
        set_names = names_of(set_main or set_rest)
        # the all-day food by its kind ("বার্গার আর ফ্রাইড চিকেন") — or, with no kind most of it is (a Chinese menu of
        # soups, rice, chicken, beef…), "the whole menu", one dish of each section (never three soups)
        if _top_kinds(day_main):
            day_said, day_pick = _kinds_phrase(day_main, bn), day_main
        else:
            firsts: Dict[str, Dict[str, Any]] = {}
            for it in day_main:
                if not re.search(r"soup|salad|appeti|starter", kind_text(it), re.I):
                    firsts.setdefault(str(it.get("category") or ""), it)
            day_said, day_pick = ("পুরো মেনুই" if bn else "the whole menu"), (list(firsts.values()) or day_main)
        if bn:
            text = (f"{label} আমাদের {day_said} তো আছেই — {_bn_join(names_of(day_pick, 3))}; "
                    f"আর {label}{f' ({hours})' if hours and not on_now else ''} {set_kind or 'এগুলো'}ও পাওয়া যায় — "
                    f"{_bn_join(set_names)}।")
            text += (" কোনটা দেব?" if on_now else f" {set_kind or 'এগুলো'} এখন পাওয়া যাচ্ছে না, বাকিগুলো এখনই দিতে পারি — কোনটা দেব?")
        else:
            text = (f"{head} we have {day_said} — {', '.join(names_of(day_pick, 3))}; "
                    f"plus {', '.join(set_names)}." + (" Which would you like?" if on_now else
                                                       " Those aren't on right now — the rest I can bring now."))
        return text, cards(day_main[:6] + set_main + set_rest), "period_menu_both"

    # 3. only what's set for that time (a menu that changes through the day)
    breads = [it for it in set_for if _period_role(it) == "bread"]
    if set_for and breakfast and breads and bn:
        # a Bengali breakfast: the bread, and what it's eaten with — "সকালে পরোটা বা তালপুরি রুটি খেতে পারেন — সাথে
        # ডাল, ভাজি, ডিম ভাজি আর নেহারি আছে।" (it once named four: two breads and two dals)
        with_ = [it for it in set_for if it not in breads and _period_role(it) not in ("drink", "sweet")]
        text = f"{head} {_bn_join(names_of(breads, 3)).replace(' আর ', ' বা ')} খেতে পারেন"
        if with_:
            text += f" — সাথে {_bn_join(names_of(with_, 6))} আছে"
        return closing(text + "।"), cards(breads + with_), "period_menu"
    if set_for:
        lead = set_main or set_rest
        with_it = _with_phrase(set_rest, bn) if set_main else ""
        if bn:
            verb = "চলছে" if is_now else ("চলে" if on_now else "পাওয়া যায়")
            text = f"{head} আমাদের {kinds_word(lead, set_top)} {verb}: {_bn_join(names_of(lead))}।"
            text += f" সাথে {with_it}-ও আছে।" if with_it else ""
        else:
            text = f"{head} we have {kinds_word(lead, set_top)}: {', '.join(names_of(lead))}." + (
                f" We also have {with_it}." if with_it else "")
        return closing(text), cards(lead + set_rest), "period_menu"

    # 4. between two meals (11:16 — breakfast over, lunch at 12): only desserts and drinks are on, and those are no
    #    answer to "what can I eat?" (it once said "দুপুরের খাবারে সরা দই, ডাবের পুডিং…") — say when the food is
    gap = _between_meals(index, orderable, periods, at, bn, in_order) if is_now else None
    if gap:
        return gap

    # 5. nothing set for that time: the usual answer (the ranked picks for that meal: "বিকেলের নাস্তায় …")
    return None


def _meal_word(start: int, bn: bool) -> str:
    """The meal a period starting then is: 12:00 → "দুপুরের খাবার"."""
    if start < 11 * 60:
        return "সকালের নাস্তা" if bn else "breakfast"
    if start < 16 * 60:
        return "দুপুরের খাবার" if bn else "lunch"
    if start < 18 * 60:
        return "বিকেলের নাস্তা" if bn else "the afternoon menu"
    return "রাতের খাবার" if bn else "dinner"


def _between_meals(index: MenuIndex, orderable: Dict[str, bool], periods: List[Dict[str, Any]], now: int, bn: bool,
                   in_order: List[Dict[str, Any]]) -> Optional[Tuple[str, List[Dict[str, Any]], str]]:
    """No food on now (only sweets / drinks orderable) and a later meal today with food: "সকালের নাস্তা শেষ হয়ে গেছে —
    দুপুরের খাবার শুরু হবে দুপুর ১২টায়: ভাত, মাছ, মাংস। এর মধ্যে চাইলে দই বা চা-কফি নিতে পারেন।\""""
    def mins(hhmm: Any) -> Optional[int]:
        try:
            h, m = (int(x) for x in str(hhmm).split(":")[:2])
            return h * 60 + m
        except (TypeError, ValueError):
            return None

    # (by the menu's own sections too: an "ওরিও ব্লাস্ট" under "কলিজা ঠাণ্ডা" is a drink, a ঘি সুজি a sweet)
    is_food = lambda it: _period_role(it) in ("main", "bread") and menu_answers.course(it) not in ("drink", "dessert")  # noqa: E731
    on = [it for it in in_order if orderable.get(index.item_id(it), True)]
    if not on or any(is_food(it) for it in on):
        return None  # food on now (or closed altogether): the usual answers
    later = sorted((s, p) for p in periods for s in [mins(p.get("start"))] if s is not None and s > now)
    nxt = next(((s, p, food) for s, p in later
                for food in [[it for it in in_order if str(p.get("id")) in (it.get("periods") or [])
                              and is_food(it)]] if food), None)
    if not nxt:
        return None
    start, _p, food = nxt
    ended = [p for p in periods if (mins(p.get("end")) or 0) <= now and (mins(p.get("start")) or 0) < now
             and any(str(p.get("id")) in (it.get("periods") or []) for it in in_order)]
    sweets = [it for it in on if menu_answers.course(it) == "dessert"][:2]
    # (a cup of tea first, then a coffee — not an espresso shot or a shake)
    drinks = sorted([it for it in on if menu_answers.course(it) == "drink" and not is_packaged(it)],
                    key=lambda it: (not re.search(r"(?<![ঀ-৿])চা(?![ঀ-৿])|\btea\b|\bchai\b", str(it.get("name") or ""), re.I),
                                    "hot_drink" not in menu_answers.families(it),
                                    bool(re.search(r"espresso|এসপ্রেসো", str(it.get("name") or ""), re.I))))[:1]
    names = lambda items, n: list(dict.fromkeys(bangla_meal.said_name(it) for it in items))[:n]  # noqa: E731
    if bn:
        text = (f"{_meal_word(mins(ended[-1].get('start')) or 0, True)} শেষ হয়ে গেছে — " if ended else "")
        # (a rice house: the curries eaten with rice — never "ভাতের সাথে মাটন কাচ্চি")
        curries = [it for it in food if bangla_meal.role(it) in ("fish", "chicken", "meat")]
        rice = "ভাতের সাথে " if bangla_meal.is_bhaat_house(index.items) and curries else ""
        food = curries if rice else food
        text += f"{_meal_word(start, True)} শুরু হবে {_bn_spoken(start)}: {rice}{_bn_join(names(food, 3))}।"
        if sweets or drinks:
            text += f" এর মধ্যে চাইলে {_bn_join(names(sweets + drinks, 4)).replace(' আর ', ' বা ')} নিতে পারেন।"
    else:
        text = (f"{_meal_word(mins(ended[-1].get('start')) or 0, False).capitalize()} is over — " if ended else "")
        text += f"{_meal_word(start, False)} starts at {_fmt_hhmm(f'{start // 60}:{start % 60:02d}')}: " \
                f"{', '.join(names(food, 3))}."
        if sweets or drinks:
            text += f" Meanwhile I can bring {' or '.join(names(sweets + drinks, 4))}."
    return text, [_suggestion_row(it) for it in sweets + drinks], "period_between"


def _with_bread(rest: List[Dict[str, Any]]) -> str:
    """", নান কিংবা পরোটা দিয়ে" — the bread set with them."""
    breads = " ".join(str(it.get("name") or "") for it in rest if _period_role(it) == "bread")
    naan = bool(re.search(r"নান|naan|\bnan\b", breads, re.I))
    porota = bool(re.search(r"পরোটা|রুটি|paratha|roti", breads, re.I))
    return ", নান কিংবা পরোটা দিয়ে" if naan and porota else ", নান দিয়ে" if naan else ", পরোটা দিয়ে" if porota else ""


def _open_spans(opening: List[Dict[str, Any]]) -> List[Tuple[int, int]]:
    """The opening hours as minute ranges of a day (days left out; past midnight → two ranges)."""
    out: List[Tuple[int, int]] = []
    for w in opening or []:
        try:
            a = int(str(w["start"])[:2]) * 60 + int(str(w["start"])[3:5])
            b = int(str(w["end"])[:2]) * 60 + int(str(w["end"])[3:5])
        except (KeyError, TypeError, ValueError):
            continue
        # (06:00–00:00 closes at midnight: no empty 00:00–00:00 range — it made the hours "রাত ১২টা থেকে ১২টা")
        out += [(a, b)] if a < b else [(a, 24 * 60), *([(0, b)] if b else [])] if a > b else [(0, 24 * 60)]
    return out


def _open_windows(opening: List[Dict[str, Any]]) -> List[Tuple[int, int]]:
    """Each opening window as (start, end) minutes, an end past midnight counted on: 18:00–02:00 → (1080, 1560)."""
    out: List[Tuple[int, int]] = []
    for w in opening or []:
        try:
            a = int(str(w["start"])[:2]) * 60 + int(str(w["start"])[3:5])
            b = int(str(w["end"])[:2]) * 60 + int(str(w["end"])[3:5])
        except (KeyError, TypeError, ValueError):
            continue
        out.append((a, b if b > a else b + 24 * 60))
    return out


def _closed_fact(opening: List[Dict[str, Any]], local_time: str) -> List[str]:
    """The restaurant closed right now → the fact the model must say (with when it opens). Before, a 1am order got
    "your tray is empty" and "try again later", never "we're closed, we open at 9"."""
    lt = re.search(r"(\d{1,2}):(\d{2})", local_time or "")
    spans = _open_spans(opening)
    if not lt or not spans:
        return []
    now = int(lt.group(1)) * 60 + int(lt.group(2))
    if any(a <= now < b for a, b in spans):
        return []
    opens = min((a for a, _b in spans), key=lambda a: (a - now) % (24 * 60))
    return [f"The restaurant is CLOSED right now and opens at {opens // 60:02d}:{opens % 60:02d} — nothing can be "
            "ordered until then. When the guest orders or asks what's available, say plainly that it's closed and "
            "when it opens. That is the RESTAURANT's opening time — each dish still has its own serving hours (a lunch "
            "dish is not served from opening time)."]


def _bn_spoken(minute: int) -> str:
    """600 → "সকাল ১০টায়"."""
    part, clock = _bn_spoken_time(f"{minute // 60}:{minute % 60:02d}")
    return f"{part} {clock}য়"


_GET_Q = re.compile(r"পাবো|পাব(?![ঀ-৿])|পাওয়া|পাওয়া|আছে|হবে|মিলবে|খাওয়া যাবে|খাওয়া যাবে|অর্ডার করা যাবে|"
                    r"\b(pabo|pab|paoa|pawa|paowa|ache|hobe|available|can i (get|have|order)|do you (have|serve)|is there)\b",
                    re.I)


def _dish_at_time(transcript: str, index: MenuIndex, orderable: Dict[str, bool], periods: List[Dict[str, Any]],
                  now_min: Optional[int], opening: List[Dict[str, Any]], lang: str
                  ) -> Optional[Tuple[str, List[Dict[str, Any]], str, List[str]]]:
    """"সকালের খাবারে কি বোয়াল মাছ পাবো?" — that dish at that time, from the menu's own hours: served then or not (and
    when it is), the restaurant open then or not, closed right now or not. Never "হ্যাঁ, সকালে পাবেন" for a lunch dish
    while the restaurant is closed (it said exactly that). None → the usual flow (no time said, no dish, no hours)."""
    from availability import format_windows, periods_at

    t = transcript or ""
    said = next(((label, at) for label, pat, at in _WHEN_SAID if re.search(pat, t, re.I)), None)
    if not said or said[0] == "এখন" or not _GET_Q.search(t) or _orders_now(t) and not _QUESTION.search(t):
        return None
    named = _dishes_named(t, index, limit=2)
    quiet = re.sub("|".join(f"(?:{pat})" for _l, pat, _a in _WHEN_SAID), " ", t, flags=re.I)
    if not named:
        # "বোয়াল মাছ" for হাওরের বোয়াল মাছ: the dish whose name holds every food word said (one only) — and a word
        # beyond the kind's ("বোয়াল", not just "কাবাব": "বিকেলে কি কাবাব আছে?" asks WHICH there are)
        _ph, keep = _asked_phrase(quiet, index)
        keep = [w for w in keep if not re.match(r"(খাবার|খাবারে|খাবারের|khabar\w*|food|meal)$", w, re.I)]
        said_toks = set().union(*[_guest_tokens(w, _menu_rev(index)) for w in keep]) - _CAT_GENERIC if keep else set()
        own_word = any(not _kind_ids_in(w, index) for w in keep if _guest_tokens(w, _menu_rev(index)) & said_toks)
        near = [x for x in index.items if said_toks and said_toks <= _name_tokens(str(x.get("name") or ""))
                and not x.get("hidden")]
        named = near if own_word and len({bangla_meal.said_name(x) for x in near}) == 1 else []
        if not named and _WHATS_SERVED.search(t):
            return None  # a list question — the period list answers that
        if not named and re.search(r"[A-Za-z]{3,}", quiet):
            named = _banglish_dish(quiet, index)  # "shokaler khabare ki boal mach pabo?" → হাওরের বোয়াল মাছ
        if not named:
            kind = [index.by_id[i] for i in _named_kind_ids(quiet, index) if i in index.by_id]
            return _kind_at_time(kind, label=said[0], at=said[1], t=quiet, index=index, periods=periods,
                                 now_min=now_min, opening=opening, lang=lang) if kind else None
    if len({bangla_meal.said_name(x) for x in named}) != 1:
        return None
    it = named[0]
    label, at = said
    bn = lang == "bn"
    spans = _open_spans(opening)
    by_id = {str(p.get("id")): p for p in periods or []}
    if not spans and it.get("periods") is None:
        return None  # no hours anywhere — nothing to say about time beyond what's on now
    name = bangla_meal.said_name(it)
    iid = index.item_id(it)
    reason = str(it.get("unavailableReason") or "")
    open_then = not spans or any(a <= at < b for a, b in spans)
    open_now = not spans or now_min is None or any(a <= now_min < b for a, b in spans)
    target = set(periods_at(at, {"periods": periods})) if periods else set()
    mine = it.get("periods")
    served_then = mine is None or bool(set(mine) & target)

    def hours_of(ids: List[str]) -> str:
        wins = [{"start": by_id[i]["start"], "end": by_id[i]["end"]} for i in ids if i in by_id
                and by_id[i].get("start") and by_id[i].get("end")]
        return format_windows(wins, "bn" if bn else "en") if wins else ""

    if not open_then:
        first = min((a for a, _b in spans), default=None)
        when = _bn_spoken(first) if first is not None and bn else ""
        text = (f"{label} আমরা খোলা থাকি না" + (f" — আমরা খুলি {when}" if when else "") + "।" if bn
                else "We're not open at that time.")
        return text, [], "dish_time_closed", []
    if not served_then:
        when = hours_of(list(mine or []))
        # what IS served then, of the same course (never a side for a main)
        at_then = {index.item_id(x): (x.get("periods") is None or bool(set(x.get("periods") or []) & target))
                   and "শেষ হয়ে গেছে" not in str(x.get("unavailableReason") or "") for x in index.items}
        alts = menu_answers.alternatives(it, index, at_then, skip={iid}, ok=lambda _x: True, limit=2)
        if not alts:  # nothing of its kind then (no fish in the morning) — what there IS to eat at that time
            alts = sorted((x for x in index.items if at_then.get(index.item_id(x)) and x.get("periods") is not None
                           and menu_answers.course(x) in ("main", "starter", "bread") and not x.get("hidden")),
                          key=lambda x: index.position.get(index.item_id(x), 1 << 20))[:2]
        if bn:
            text = f"না, {label} {name} পাওয়া যায় না" + (f" — এটা পাওয়া যায় {when}" if when else "") + "।"
            if alts:
                text += f" {label} পাবেন {menu_answers.join([bangla_meal.said_name(a) for a in alts], 'বা')}।"
        else:
            text = f"No, the {name} isn't served then" + (f" — it's served {when}" if when else "") + "."
            if alts:
                text += f" At that time there's the {menu_answers.join([bangla_meal.said_name(a) for a in alts], 'or')}."
        return text, [_suggestion_row(a) for a in alts], "dish_time_no", []
    # served then (and open then)
    when = hours_of(list(mine or [])) if mine else ""
    if re.search(r"শুধু .+ হয়, আজ নয়|only — not today", reason):
        text = (f"{name} {reason}।" if bn else f"The {name} is {reason}.")
        return text, [], "dish_time_day", []
    if bn:
        text = f"জি, {label} {name} পাওয়া যায়" + (f" ({when})" if when else "") + "।"
        if "শেষ হয়ে গেছে" in reason:
            text += " তবে আজকেরটা শেষ হয়ে গেছে।"
        elif not open_now:
            first = min((a for a, _b in spans), default=None)
            text += " এখন রেস্টুরেন্ট বন্ধ" + (f" — খুলবে {_bn_spoken(first)}" if first is not None else "") + "।"
        elif orderable.get(iid, True):
            text += " এখনই দেব?"
    else:
        text = f"Yes, the {name} is served then" + (f" ({when})" if when else "") + "."
        if "শেষ হয়ে গেছে" in reason or "sold out" in reason.lower():
            text += " But today's is sold out."
        elif not open_now:
            text += " We're closed right now."
        elif orderable.get(iid, True):
            text += " Shall I add one now?"
    offer = [iid] if open_now and orderable.get(iid, True) and "শেষ হয়ে গেছে" not in reason else []
    return text, [_suggestion_row(it)], "dish_time_yes", offer


_BANGLISH_FILLER = {"ki", "kono", "konta", "ache", "achhe", "pabo", "pab", "pawa", "paoa", "paowa", "jabe", "hobe", "khabare",
                    "khabar", "khabarer", "khete", "er", "te", "e", "r", "ar", "bhai", "den", "dao", "koto", "kot", "ta",
                    "ti", "a", "the", "is", "there", "any", "can", "i", "get", "have", "you", "do"}


def _banglish_dish(text: str, index: MenuIndex) -> List[Dict[str, Any]]:
    """A dish named in Latin letters ("boal mach" → হাওরের বোয়াল মাছ): every word said near a word of its Bangla name,
    and no other dish as close. [] when unsure."""
    from rapidfuzz import fuzz as _fz

    words = [to_bangla_script(w.lower()) for w in re.findall(r"[A-Za-z]+", text or "")
             if w.lower() not in _BANGLISH_FILLER and len(w) >= 2]
    if not words:
        return []
    scored = []
    for it in index.items:
        if it.get("hidden"):
            continue
        own = to_bangla_script(re.sub(r"\(.*?\)", " ", str(it.get("name") or ""))).split()
        if not own:
            continue
        hits = sum(1 for w in words if max(_fz.ratio(w, o) for o in own) >= 60)
        if hits == len(words):
            scored.append((sum(max(_fz.ratio(w, o) for o in own) for w in words), it))
    scored.sort(key=lambda x: -x[0])
    if not scored or (len(scored) > 1 and scored[1][0] >= scored[0][0] - 5):
        return []
    return [scored[0][1]]


def _kind_at_time(kind: List[Dict[str, Any]], *, label: str, at: int, t: str, index: MenuIndex,
                  periods: List[Dict[str, Any]], now_min: Optional[int], opening: List[Dict[str, Any]], lang: str
                  ) -> Optional[Tuple[str, List[Dict[str, Any]], str, List[str]]]:
    """"রাতে মাছ পাবো?" / "মাঝরাতে চা পাওয়া যাবে?" — which of that kind is served then (or that we're closed then)."""
    from availability import periods_at

    bn = lang == "bn"
    spans = _open_spans(opening)
    if not spans and all(x.get("periods") is None for x in kind):
        return None
    if spans and not any(a <= at < b for a, b in spans):
        first = min((a for a, _b in spans), default=None)
        text = (f"{label} আমরা খোলা থাকি না" + (f" — আমরা খুলি {_bn_spoken(first)}" if first is not None else "") + "।"
                if bn else "We're not open at that time.")
        return text, [], "dish_time_closed", []
    target = set(periods_at(at, {"periods": periods})) if periods else set()
    then = [x for x in kind if (x.get("periods") is None or set(x.get("periods") or []) & target)
            and "শেষ হয়ে গেছে" not in str(x.get("unavailableReason") or "")]
    word = _kind_word(t, index, {index.item_id(x) for x in kind}) or ""
    names = list(dict.fromkeys(bangla_meal.said_name(x) for x in then))[:4]
    open_now = not spans or now_min is None or any(a <= now_min < b for a, b in spans)
    closed_now = ("" if open_now else (" এখন অবশ্য রেস্টুরেন্ট বন্ধ।" if bn else " We're closed right now, though."))
    if not then:
        text = (f"না, {label} {word} পাওয়া যায় না।" if bn else f"No, there's no {word} at that time.")
        return text, [], "dish_time_no", []
    if bn:
        text = f"জি, {label} {upsell_engine.of_bn(word) + ' মধ্যে ' if word else ''}পাবেন {menu_answers.join(names, 'বা')}।{closed_now}"
    else:
        text = f"Yes — {label}: the {menu_answers.join(names, 'or')}.{closed_now}"
    return text, [_suggestion_row(x) for x in then[:4]], "dish_time_yes", []


def _rice_meal_then(index: MenuIndex, orderable: Dict[str, bool], periods: List[Dict[str, Any]], target: set,
                    now: bool) -> Optional[Dict[str, Any]]:
    """At a Bengali rice house, at a lunch / dinner period: the rice meal of the dishes served then — the all-day
    ones (and ones set for that time); orderable ones when it's now. None elsewhere (a café, breakfast, a snack time)."""
    meal_time = any(re.search(r"lunch|dinner|দুপুর|রাত", f"{p.get('id')} {p.get('name')}", re.I)
                    for p in periods if str(p.get("id")) in target)
    if not meal_time or not bangla_meal.is_bhaat_house(index.items):
        return None
    served = [it for it in index.items if (it.get("periods") is None or set(it.get("periods") or []) & target)
              and (not now or orderable.get(index.item_id(it), True))]
    served.sort(key=lambda it: (not is_signature(it), index.position.get(index.item_id(it), 1 << 20)))
    return bangla_meal.meal(served)


def _period_role(it: Dict[str, Any]) -> str:
    """"main" (what a waiter names: kebabs, curries, rice dishes, snacks), or what's said only as "সাথে … আছে":
    "bread", "drink", "sweet", "side"."""
    r = upsell_engine.dish_roles(it)
    if r["drink"] or dish_facts(it)["drink"] or is_packaged(it):
        return "drink"
    if r["dessert"]:
        return "sweet"
    if re.search(r"\bnaan\b|paratha|porota|roti", kind_text({"name": it.get("name")})):
        return "bread"
    if bangla_meal.role(it) == "side" or bangla_meal.is_plain_rice(it):
        return "side"
    if is_side(it) and bangla_meal.role(it) not in ("fish", "chicken", "meat"):
        return "side"  # "এক্সট্রা খিচুড়ি/পোলাও রাইস", an add-on: said after the dishes, never named first
    return "main"


def _with_phrase(items: List[Dict[str, Any]], bn: bool) -> str:
    """"নান-পরোটা, ড্রিংকস আর মিষ্টি" — the rest, by kind."""
    roles = {_period_role(it) for it in items}
    names = " ".join(str(it.get("name") or "") for it in items if _period_role(it) == "bread")
    out = []
    if "bread" in roles:
        naan, porota = bool(re.search(r"নান|naan|\bnan\b", names, re.I)), bool(re.search(r"পরোটা|রুটি|paratha|roti", names, re.I))
        out.append(("নান-পরোটা" if naan and porota else "নান" if naan else "পরোটা-রুটি") if bn
                   else ("naan and paratha" if naan and porota else "naan" if naan else "paratha"))
    if "side" in roles:
        out.append("ভর্তা-ভাজি" if bn else "sides")
    if "drink" in roles:
        out.append("ড্রিংকস" if bn else "drinks")
    if "sweet" in roles:
        out.append("মিষ্টি" if bn else "desserts")
    return _bn_join(out) if bn else ", ".join(out)


# the kinds a waiter names a time's food by ("কাবাব আর গ্রিল আইটেমগুলো"), from what the dishes are
# (pattern, "…আইটেমগুলো" form, English, the kind itself: "আবার চাইলে কাবাব-গ্রিলও খেতে পারেন")
_TIME_KIND_SAY = (
    (r"kebab|kabab|tikka|grill|shashlik|tandoori|chaap", "কাবাব-গ্রিল", "kebabs and grills", "কাবাব-গ্রিল"),
    (r"biryani|kacchi|polao|pulao|khichuri|tehari", "কাচ্চি-পোলাও", "biryani and polao", "কাচ্চি-পোলাও"),
    # (a set menu / a sweet before what's in its name: "Set Menu-2 (Fried Rice, …, Soup)" is no soup, a sundae no shake)
    (r"set ?menu|\bcombo\b|platter|thali", "সেট মেনুর", "set menus", "সেট মেনু"),
    (r"dessert|sweet|firni|doi|pudding|halwa|payesh|brownie|sundae|ice ?cream|cake|kulfi", "মিষ্টির", "desserts", "মিষ্টি"),
    (r"\bfish\b|prawn", "মাছের", "fish dishes", "মাছ"),
    (r"burger", "বার্গারের", "burgers", "বার্গার"),
    (r"pizza", "পিজ্জার", "pizzas", "পিজ্জা"),
    (r"fried chicken|\bwings\b|tenders|nugget|broast", "ফ্রাইড চিকেনের", "fried chicken", "ফ্রাইড চিকেন"),
    (r"sizzl", "সিজলিংয়ের", "sizzlers", "সিজলিং"),
    (r"fried rice|chow ?mein|noodle|pasta", "রাইস-নুডলসের", "rice and noodles", "রাইস-নুডলস"),
    (r"curry|bhuna|jhol|korma|rezala|kalia|dopiaza|nehari", "ভুনা-তরকারির", "curries", "ভুনা-তরকারি"),
    (r"\bsoup\b", "স্যুপের", "soups", "স্যুপ"),
    (r"shawarma|sandwich|roll|snack|fries|wedges", "নাস্তার", "snacks", "নাস্তা"),
    (r"\bnaan\b|paratha|porota|roti|\bdal\b|bhaji|breakfast|egg", "নাস্তার", "breakfast dishes", "নাস্তা"),
    (r"tea|coffee|espresso|latte|cappuccino", "চা-কফির", "tea and coffee", "চা-কফি"),
    (r"juice|lassi|shake|cola|drink", "ড্রিংকসের", "drinks", "ড্রিংকস"),
)


def _kind_of(it: Dict[str, Any]) -> int:
    """Which of _TIME_KIND_SAY this dish is (its position), or len() for none."""
    text = kind_text(it)
    return next((i for i, k in enumerate(_TIME_KIND_SAY) if re.search(k[0], text, re.I)), len(_TIME_KIND_SAY))


def _top_kinds(items: List[Dict[str, Any]]) -> List[int]:
    """The one or two kinds most of these dishes are (each at least a quarter of them), the biggest first."""
    counts: Dict[int, int] = {}
    for it in items:
        k = _kind_of(it)
        if k < len(_TIME_KIND_SAY):
            counts[k] = counts.get(k, 0) + 1
    ranked = [k for k, n in sorted(counts.items(), key=lambda kv: -kv[1]) if n * 4 >= len(items)]
    # (two kinds said the same way — "নাস্তার" — are one)
    out: List[int] = []
    for k in ranked:
        if all(_TIME_KIND_SAY[k][1] != _TIME_KIND_SAY[o][1] for o in out):
            out.append(k)
    return out[:2]


def _kinds_phrase(items: List[Dict[str, Any]], bn: bool) -> str:
    """"কাবাব-গ্রিল আর নাস্তার আইটেমগুলো" — the kinds these dishes are; else their category's name without "(…)"."""
    top = _top_kinds(items)
    if top:
        return (" আর ".join(_TIME_KIND_SAY[k][1] for k in top) + " আইটেমগুলো") if bn \
            else " and ".join(_TIME_KIND_SAY[k][2] for k in top)
    cat = re.sub(r"\s*\(.*?\)", "", str((items[0] if items else {}).get("category") or "")).strip()
    return (f"{cat}-এর আইটেমগুলো" if cat else "এই আইটেমগুলো") if bn else (f"{cat} dishes" if cat else "these dishes")


def _bn_join(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " আর " + names[-1] if names else ""


def _bn_daypart(h: int) -> str:
    return ("ভোর" if 4 <= h < 6 else "সকাল" if h < 12 and h >= 6 else "দুপুর" if 12 <= h < 15 else
            "বিকেল" if 15 <= h < 18 else "সন্ধ্যা" if 18 <= h < 20 else "রাত")


def _bn_spoken_time(hhmm: Any) -> Tuple[str, str]:
    """"17:01" → ("বিকেল", "৫টা"); "15:30" → ("বিকেল", "সাড়ে ৩টা"); "16:50" → ("বিকেল", "৫টা") — as it's said."""
    try:
        h, m = (int(x) for x in str(hhmm).split(":")[:2])
    except ValueError:
        return "", str(hhmm)
    half = 20 <= m < 45
    if m >= 45:
        h, m = (h + 1) % 24, 0
    h12 = h % 12 or 12
    clock = (f"সাড়ে {h12}টা" if half else f"{h12}টা").translate(_BN_DIG)
    return _bn_daypart(h), clock


def _bn_hours(start: Any, end: Any) -> str:
    """"বিকেল ৫টা থেকে রাত ১০টা পর্যন্ত"; the same part of the day said once: "দুপুর ১২টা থেকে ৩টা পর্যন্ত"."""
    (dp1, c1), (dp2, c2) = _bn_spoken_time(start), _bn_spoken_time(end)
    return f"{dp1} {c1} থেকে {'' if dp1 == dp2 else dp2 + ' '}{c2} পর্যন্ত".replace("  ", " ")


_OPEN_Q = re.compile(
    r"খোলা|খুলবে|খুলবেন|খোলেন|খোলে(?![ঀ-৿])|খোলার সময়|খোলার সময়|বন্ধ (হয়|হয়|হবে|করেন|করবেন|থাকে)|কয়টা পর্যন্ত|কয়টা পর্যন্ত|"
    r"কয়টায় (খোলে|খুলবে|বন্ধ)|কখন (খোলে|খুলবে|বন্ধ)|\b(open|opening|close|closing|timings?|hours)\b|\bkhola\b",
    re.I,
)


def _open_answer(transcript: str, opening: List[Dict[str, Any]], hours_text: str, now_min: Optional[int],
                 lang: str) -> Optional[str]:
    """"কাল সকালে খোলা?" / "আজ রাতে কয়টা পর্যন্ত খোলা?" / "কখন খোলেন?" — from the opening hours (it once answered
    "কাল সকালে খোলা?" with "জি, গরুর কালা ভুনা আছে", and "কয়টা পর্যন্ত খোলা" with the rice dishes)."""
    t = transcript or ""
    if not _OPEN_Q.search(t):
        return None
    bn = lang == "bn"
    spans = _open_spans(opening)
    if not spans:
        if hours_text:
            return f"আমরা খোলা থাকি {hours_text}।" if bn else f"We're open {hours_text}."
        return None
    # opens at the earliest start, closes at the latest end — past midnight counted on (18:00–02:00 was "12am to 12am")
    wins = _open_windows(opening)
    first, last = min(a for a, _b in wins), max(b for _a, b in wins)
    fmt = lambda m: f"{m // 60 % 24}:{m % 60:02d}"  # noqa: E731
    span_bn = _bn_hours(fmt(first), fmt(last % (24 * 60)))
    said = next(((label, at) for label, pat, at in _WHEN_SAID if re.search(pat, t, re.I)), None)
    open_now = now_min is None or any(a <= now_min < b for a, b in spans)
    if re.search(r"পর্যন্ত|কয়টায় বন্ধ|কখন বন্ধ|বন্ধ (হয়|হয়|হবে|করেন|করবেন)|\b(close|closing|till|until)\b", t, re.I):
        part, clock = _bn_spoken_time(fmt(last % (24 * 60)))
        return (f"আমরা {part} {clock} পর্যন্ত খোলা থাকি।" if bn else f"We're open until {_fmt_hhmm(fmt(last % (24 * 60)))}.")
    if said and said[0] != "এখন":
        label, at = said
        if any(a <= at < b for a, b in spans):
            return (f"জি, {label} খোলা থাকে — আমরা খোলা থাকি {span_bn}।" if bn
                    else f"Yes, we're open then — {_fmt_hhmm(fmt(first))} to {_fmt_hhmm(fmt(last % 1440))}.")
        return (f"না, {label} খোলা থাকে না — আমরা খুলি {_bn_spoken(first)}।" if bn
                else f"No, we're not open then — we open at {_fmt_hhmm(fmt(first))}.")
    if bn:
        return f"আমরা খোলা থাকি {span_bn}।" + ("" if open_now else f" এখন বন্ধ — খুলবে {_bn_spoken(first)}।")
    return f"We're open {_fmt_hhmm(fmt(first))} to {_fmt_hhmm(fmt(last % 1440))}." + ("" if open_now else " We're closed right now.")


def _fmt_hhmm(hhmm: Any) -> str:
    try:
        h, m = (int(x) for x in str(hhmm).split(":")[:2])
    except ValueError:
        return str(hhmm)
    return f"{h % 12 or 12}{':%02d' % m if m else ''}{'am' if h < 12 else 'pm'}"


# "কি কি / কী কী / কোন কোন … আছে", "কি আছে", "what … do you have" — the guest asks what there IS (a list)
_LIST_Q = re.compile(
    r"(কি|কী)\s+(কি|কী)|কোন\s+কোন|(কি|কী)\s+(আছে|আছো|পাওয়া|পাওয়া|পাবো|পাব)|(আছে|পাওয়া যায়|পাওয়া যায়)\s+(কি|কী)\s*\W*$|"
    r"\bki\s+ki\b|\bki\s+(ache|ase|pawa)\b|\bwhat\b.{0,30}\b(have|got|are there|is there|do you (do|serve|make))\b|"
    r"\bwhich\b.{0,30}\b(have|are there)\b|\b(list|all) (of )?(your|the)\b",
    re.I,
)
_A_VERB = re.compile(r"(করেন|করুন|করো|করব|করবো|দিন|দেন|দাও|দিবেন|দেবেন|নেব|নিব|নেবো|নিবো|চাই|লাগবে|বাদ|ক্যান্সেল|ক্যানসেল|"
                     r"সরান|সরাও|খাবো|খাব|খাই|আনুন|আনেন|দেখান|দেখাও|বলেন|বলুন)$|^(বাদ|না|নাই|নেই)$")
# words around a kind that ask nothing ("মাছ আছে?", "মাছের মধ্যে কি") — not a misheard dish name
_KIND_FILLER = {"মধ্যে", "ভিতর", "ভিতরে", "কি", "কী", "আছে", "আছো", "কোন", "কোনটা", "আইটেম", "আইটেমের", "দিন", "দেন", "দাও",
                "আর", "তো", "একটু", "বলেন", "বলুন", "বলো", "প্লিজ", "আপনাদের", "তোমাদের", "আপনার", "এখানে", "আজকে",
                "পাওয়া", "পাওয়া", "যায়", "যায়", "চাই", "লাগবে", "খাবো", "খাব", "নেব", "নিব", "না", "হ্যাঁ"}


def _kind_list_reply(transcript: str, index: MenuIndex, orderable: Dict[str, bool], scope: set, lang: str,
                     seen: Any = ((), ()), said_before: str = "") -> Optional[Tuple[str, List[Dict[str, Any]], str]]:
    """"মাছের মধ্যে আছে রুই মাছ, হাওরের বোয়াল মাছ, … — কোনটা দেব?" for a list question about a kind; for the kind
    plus a word that is nothing on the menu ("মাছ পটিকিয়া") the same list after "which one did you mean?"."""
    t = transcript or ""
    if re.search(r"ভেজ|নিরামিষ|ভেজিটেরিয়ান|\b(veg|vegetarian|vegan|veggie)\b", t, re.I):
        return None  # "ভেজ বার্গার কি কি আছে?" — only the vegetarian ones: the model, with the diet check
    label = _kind_word(t, index, scope)
    if not label:
        return None
    words = re.findall(r"[A-Za-z]+|[ঀ-৿]+", t)
    rest = [w for w in words if not _kind_ids_in(w, index) & scope and w not in _KIND_FILLER
            and _BN_SUFFIX.sub("", w) not in _KIND_FILLER]
    # (just the kind and ONE word nothing knows — "মাছ পটিকিয়া"; never with a verb: "বার্গারটা ক্যান্সেল করেন")
    unheard = (len(words) == 2 and len(rest) == 1 and len(rest[0]) >= 3 and not _LIST_Q.search(t)
               and not _guest_tokens(rest[0], _menu_rev(index)) and not _A_VERB.search(rest[0])
               and rest[0] not in _EVERYDAY and _BN_SUFFIX.sub("", rest[0]) not in _EVERYDAY  # ("মুরগির কিছু?")
               # ("মাছ ছাড়া" — WITHOUT fish: no fish name to ask about)
               and not re.match(r"(ছাড়া|ছাড়া|বাদে|বাদ|না|নয়|ছাড়|without|no|except)$", rest[0], re.I))
    if not (_LIST_Q.search(t) or unheard):
        return None
    items = [index.by_id[i] for i in scope if i in index.by_id and orderable.get(i, True)]
    if any(dish_facts(it)["drink"] or is_packaged(it) for it in items):
        return None  # drinks have their own list (made-here first — "ড্রিংকসের মধ্যে আছে…")
    # the menu's order — an "এক্সট্রা পোলাও রাইস" / add-on after the dishes themselves
    items.sort(key=lambda it: (bool(re.search(r"এক্সট্রা|অতিরিক্ত|\bextra\b|\badd[- ]?on\b", str(it.get("name") or ""), re.I)),
                               index.position.get(index.item_id(it), 1 << 20)))
    said_all = [bangla_meal.said_name(it) for it in items]
    spoken = list(dict.fromkeys(said_all))  # "Rui (half)" and "(full)" are one dish to say; both stay cards
    if not spoken:
        return None
    dishes = list(zip(items, said_all))
    bn = lang == "bn"
    # "আর কি কি মাছ আছে?" right after the fish were said — the ones not said yet (it once said the same 8 again)
    older, last = (set(x) for x in (seen if isinstance(seen, tuple) else ((), seen)))
    if (older or last) and bhorta_bhaji._MORE.search(t) and not unheard:
        # (seen = on the screen AND said: ten cards shown, eight named — the other two are still "more")
        fresh = [(it, s_) for it, s_ in dishes if not (index.item_id(it) in older or (
            index.item_id(it) in last and (not said_before or s_ in said_before)))]
        if not fresh:
            text = (f"{upsell_engine.of_bn(label)} মধ্যে এগুলোই আছে — যা বললাম। এর মধ্যে কোনটা নেবেন?" if bn
                    else f"That's all the {label} we have — the ones I said. Which would you like?")
            return text, [_suggestion_row(it) for it, _s in dishes[:12]], "kind_all_said"
        names = list(dict.fromkeys(s_ for _it, s_ in fresh))[:8]
        joined = (", ".join(names[:-1]) + (" আর " if bn else " and ") + names[-1]) if len(names) > 1 else names[0]
        text = (f"আরও আছে — {joined}। কোনটা নেবেন?" if bn else f"We also have {joined}. Which would you like?")
        return text, [_suggestion_row(it) for it, _s in fresh[:12]], "kind_more"
    if len(spoken) == 1 and not unheard:
        # one of its kind: "জি, Burger & Fries Combo আছে — ৳490। দেব?" (not "কম্বোর মধ্যে আছে … কোনটা দেব?")
        price = _money(min(float(it.get("price") or 0) for it in items))
        text = (f"জি, {spoken[0]} আছে — {price}। দেব?" if bn else f"Yes, we have the {spoken[0]} ({price}) — shall I add one?")
        return text, [_suggestion_row(it) for it, _s in dishes[:12]], "kind_one"
    names = spoken[:8]
    more = len(spoken) - len(names)
    joined = (", ".join(names[:-1]) + (" আর " if bn else " and ") + names[-1]) if len(names) > 1 else names[0]
    if bn:
        more_bn = str(more).translate(str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯"))
        text = f"{upsell_engine.of_bn(label)} মধ্যে আছে {joined}" + (f" — আরও {more_bn}টা স্ক্রিনে আছে" if more else "") + "। কোনটা দেব?"
        if unheard:
            text = f"দুঃখিত, {upsell_engine.of_bn(label)} কোনটা বললেন? " + text
    else:
        text = f"For {label} we have {joined}" + (f" — {more} more on your screen" if more else "") + ". Which one would you like?"
        if unheard:
            text = f"Sorry, which {label} did you mean? " + text
    return text, [_suggestion_row(it) for it, _s in dishes[:12]], ("kind_unheard" if unheard else "kind_list")


_POINTING_AT = re.compile(r"\b(it|this|that|these|those|they|them)\b|ওইটা|ওটা|এটা|এটি|এইটা|সেটা|এগুলো|এগুলা|ওগুলো|ওগুলা|"
                          r"এগুলোর|ওগুলোর|এদের", re.I)  # "Is it spicy?" — the dishes just said


def _one_dish_word(t: str, index: MenuIndex) -> bool:
    """A word said that only one dish's name has ("pepperoni" → Pepperoni Pizza) — the guest means that dish."""
    words = {w.lower() for w in re.findall(r"[A-Za-z]{4,}", t or "")} - {"spicy", "pizza", "burger", "chicken", "beef",
                                                                          "what", "that", "this", "there", "very"}
    for w in words:
        owners = {bangla_meal.said_name(it) for it in index.items if w in str(it.get("name") or "").lower().split()}
        if len(owners) == 1:
            return True
    return False


def _suggest_more(
    transcript: str, *, index: MenuIndex, orderable: Dict[str, bool], kinds: List[str], profile: GuestProfile,
    stats: OrderStats, rstate: RecoState, kind_scope: set, lang: str, stage: str, in_tray: Optional[set],
    history: Optional[List[Dict[str, Any]]], cart_ids: List[str],
) -> Optional[Tuple[str, List[Dict[str, Any]], str]]:
    """The guest's next suggestion ask after a list (followups.py): more of the same ask without a dish already said,
    the same ask narrowed ("ঝাল কিছু?", "হালকা", "মুরগির", "বার্গার ছাড়া"), or ONE pick of the dishes just said.
    None → the usual flow (a new ask, a dish named, no list said lately)."""
    t = transcript or ""
    ask = followups.ask_kind(t)
    if not ask or stage != "none" or not rstate.thread_shown or rstate.turn - rstate.thread_turn > 3:
        return None
    if _dishes_named(t, index, limit=1, exact_only=True):
        return None  # "আর একটা Thai Soup কেমন?" — about a dish: the usual flow
    if ask == "refine" and (followups._SPICY.search(t) or followups._MILD.search(t)) and (
            _dishes_named(t, index, limit=1) or _one_dish_word(t, index)):
        return None  # "Is the pepperoni spicy?" — about THAT dish (it once answered with the Naga Drums Pizza)
    if profile.allergies or profile.vegetarians_in_party:
        return None  # (the model adds the safety note)
    bn = lang == "bn"
    tray = set(in_tray or ())
    # what started the thread: the guest's last line that wasn't itself a follow-up ("স্যুপ কোনটা ভালো?")
    # (a line naming a kind starts one too — "স্যুপ কোনটা ভালো?" reads like "which one is best?")
    users = [str(m.get("content") or "") for m in history or [] if m.get("role") == "user"]
    at = next((n for n in range(len(users) - 1, -1, -1)
               if not followups.ask_kind(users[n]) or (_named_kind_ids(users[n], index)
                                                         and followups.ask_kind(users[n]) == "pick")), -1)
    start = users[at] if at >= 0 else ""
    start_scope = _named_kind_ids(start, index) if start else set()
    start_scope = {i for i in start_scope if i not in set(profile.declined)}
    if any(followups.ask_kind(u) == "more" and followups.OTHER.search(u) for u in users[at + 1:]):
        start_scope = set()  # "অন্য কিছু" stepped out of that kind — "আর কি আছে?" after it is more of everything
    # what was asked since — "চিকেনের কিছু?" then "ঝাল কম" is chicken AND mild
    lines = followups.stack([u for u in users[at + 1:] if followups.ask_kind(u) == "refine"]
                            + ([t] if ask == "refine" else []))
    kids = bool(profile.kids or re.search(r"বাচ্চা|শিশু|ছোটদের|\b(kids?|child|children)\b", start, re.I))
    row = lambda it: _suggestion_row(it)  # noqa: E731
    if ask == "pick" and kind_scope:
        return None  # "স্যুপ কোনটা ভালো?" — a new ask about a kind: its own list

    if ask == "pick":
        said = [i for i in (rstate.last_list if rstate.turn - rstate.last_list_turn <= 2 else rstate.last_offered)
                if i in index.by_id and i not in tray and orderable.get(i, True)]
        cand = [index.by_id[i] for i in said]
        food = [x for x in cand if menu_answers.course(x) in ("main", "starter")] or cand
        if not food:
            return None
        hot = {index.item_id(x) for x in food if stats.pop_score(index.item_id(x)) >= 1.2}
        if hot:
            best = max(food, key=lambda x: stats.pop_score(index.item_id(x)))
        else:
            ranked, _ = rank(index, orderable, kinds, profile, stats=stats, context_ids=cart_ids,
                             limit=len(food), only={index.item_id(x) for x in food})
            stars = [x for x in food if x.get("signature")]
            best = stars[0] if stars else (ranked[0].item if ranked else food[0])
        why = followups.reason_for(best, hot, index.item_id(best), " ".join([start, t] + lines), bn, kids)
        name, price = bangla_meal.said_name(best), menu_answers.price_of(best)
        listed = [index.by_id[i] for i in (rstate.last_list if rstate.turn - rstate.last_list_turn <= 2
                                           else rstate.last_offered) if i in index.by_id]
        among = ("এগুলোর মধ্যে " if bn else "Of these, ") if len(listed) > 1 else ""
        text = (f"{among}আমি বলব {name} ({price}){why}। দেব?" if bn
                else f"{among}I'd go with the {name} ({price}){why}. Shall I add it?")
        # the list stays as the cards, the pick first (highlighted); "হ্যাঁ" adds the pick
        return text, [row(best)] + [row(x) for x in listed if x is not best], "thread_pick"

    # ---- more / refine: the thread's ask (its kind), what was said already left out for "more"
    own_scope = bool(kind_scope)  # the kind is in THIS line ("মুরগির কিছু?") — not "within" the thread's kind
    scope = set(kind_scope) if kind_scope else set(start_scope)
    if ask == "more" and not kind_scope and followups.OTHER.search(t):
        scope = set()  # "অন্য কিছু" after the burgers: something other than burgers (not more of them)
    shown = set(rstate.thread_shown)
    shown_items = [index.by_id[i] for i in rstate.thread_shown if i in index.by_id]
    # a café's first answer had tea and cake in it: "আর কি আছে?" may be more of those too
    asks_drinks = bool(re.search(r"ড্রিংক|পানীয়|ঠান্ডা|ঠাণ্ডা|জুস|কফি|(?<![ঀ-৿])চা(?![ঀ-৿])|মিষ্টি|ডেজার্ট|"
                                 r"\b(drinks?|juice|coffee|tea|sweet|dessert)\b", start + " " + t, re.I)) or (
        sum(menu_answers.course(x) in ("drink", "dessert") for x in shown_items) >= max(2, len(shown_items) // 3)) or (
        # a café: mostly coffee, tea and cake — those ARE its menu
        sum(menu_answers.course(x) in ("main", "starter") for x in index.items) * 2 < len(index.items))
    sides_ok = followups.wants_sides(lines)
    said_names = {bangla_meal.said_name(x) for x in shown_items}  # (the Half after the Full is no new dish)
    prices = sorted(menu_answers.lowest_price(index.by_id[i]) for i in (rstate.last_list or rstate.last_offered)
                    if i in index.by_id and menu_answers.course(index.by_id[i]) in ("main", "starter"))
    ceiling = prices[len(prices) // 2] if prices else 0  # "একটু কম দামের": below the middle of what was just said

    def pool(only: Optional[set], skip: set, extras: bool = False) -> List[Dict[str, Any]]:
        ranked, _ = rank(index, orderable, kinds, profile, stats=stats, context_ids=cart_ids, recent=rstate.recent,
                         asked_for=only or set(), limit=len(index.items), only=only or None, exclude=skip)
        out = [p.item for p in ranked if orderable.get(index.item_id(p.item), True) and not p.item.get("hidden")
               and index.item_id(p.item) not in skip]
        if not only:
            ok_courses = (("side", "drink", "dessert") if extras else
                          ("main", "starter") + (("drink", "dessert") if asks_drinks else ()) + (
                              ("side",) if sides_ok else ()))
            out = [x for x in out if menu_answers.course(x) in ok_courses]
        out = [x for x in out if not bangla_meal.is_plain_rice(x)]  # (সাদা ভাত is never "a suggestion")
        if bangla_meal.is_bhaat_house(index.items) and not only and not sides_ok:
            out = [x for x in out if bangla_meal.role(x) != "side"]
        if kids:
            out = [x for x in out if followups.kid_friendly(x)]
        for line in lines:
            out = [x for x in out if followups.fits(x, line, ceiling)]
        seen, uniq = set(said_names) if ask == "more" else set(), []
        for x in out:
            k = bangla_meal.said_name(x)
            if k not in seen:
                seen.add(k)
                uniq.append(x)
        return uniq

    skip = tray | (shown if ask == "more" else set())
    items = pool(scope, skip)
    if ask == "refine" and len(items) < 2 and len(lines) > 1:
        lines = followups.stack([t])  # stacked too narrow ("ঝাল" + "মুরগির" → one dish): the latest ask on its own
        items = pool(scope, skip) or items
    widened = False
    if not items and scope and ask == "refine" and not own_scope:
        items, widened = pool(None, skip), True  # "নুডলসের মধ্যে ঝাল?" with none → the spicy dishes elsewhere
    label_kind = (_kind_word(start, index, scope) if scope and not own_scope else "")
    within = (f"{upsell_engine.of_bn(label_kind)} মধ্যে " if bn else f"in {label_kind} ") if label_kind and not widened else ""
    label = followups.compose(lines, bn)
    which = lambda xs: ("দেব?" if len(xs) == 1 else "কোনটা দেব?") if bn else (  # noqa: E731
        "Shall I add it?" if len(xs) == 1 else "Which would you like?")
    if not items and ask == "more" and not scope and not lines:
        # every dish said: the sides, drinks and desserts are still there ("আর কি আছে?" at a burger place)
        extra = pool(None, skip, extras=True)[:4]
        if extra:
            listed = followups.say_list(extra, bn, False)
            text = (f"মেইন খাবার সবই বলেছি — এছাড়া আছে {listed}। {'দেব?' if len(extra) == 1 else 'কোনটা দেব?'}" if bn
                    else f"That's all our mains — there's also {listed}. Which would you like?")
            return text, [row(x) for x in extra], "thread_more"
    if not items:
        if ask == "more":
            left = [x for x in shown_items if all(followups.fits(x, line, ceiling) for line in lines)] or shown_items
            text = (f"{within}এই কয়টাই আছে — যা আছে সবই বলেছি। এর মধ্যে কোনটা দেব, নাকি অন্য কিছু দেখবেন?" if bn
                    else f"That's everything {within}we have. Which of them would you like, or something else?")
            return text, [row(x) for x in left[:6]], "thread_all_said"
        if any(followups.CHEAPER.search(x) for x in lines):
            return None  # the cheaper engine has its own fallback (below the dearest of them)
        text = (f"দুঃখিত, {within}{label} তেমন কিছু নেই। অন্য কিছু দেখবেন?" if bn
                else f"Sorry, there's nothing {label} {within}on the menu. Shall I suggest something else?")
        return text, [], "thread_none"
    items = items[:4]
    if ask == "more":
        listed = followups.say_list(items, bn, bangla_meal.is_bhaat_house(index.items) and not scope)
        if bn:
            other = not kind_scope and followups.OTHER.search(t)
            lead = ("অন্যগুলোর মধ্যে আছে " if other else
                    f"{within}{label} আরও আছে " if label else f"{within}আরও আছে ")
            text = f"{lead}{listed}। {which(items)}"
        else:
            text = f"We also have {listed}{(' ' + within.strip()) if within else ''}. {which(items)}"
        return text, [row(x) for x in items], "thread_more"
    listed = followups.say_list(items, bn, False)
    if bn:
        text = f"{within}{label} হলো {listed}। {which(items)}" if within else f"{label} আছে {listed}। {which(items)}"
        if widened:
            text = f"{upsell_engine.of_bn(label_kind)} মধ্যে {label} তেমন নেই — তবে অন্যগুলোর মধ্যে আছে {listed}। {which(items)}"
    else:
        text = f"{label.capitalize()} {within}— {listed}. {which(items)}"
    return text, [row(x) for x in items], "thread_refine"


def _fixed_reco(
    transcript: str, *, index: MenuIndex, orderable: Dict[str, bool], kinds: List[str], profile: GuestProfile,
    stats: OrderStats, rstate: RecoState, kind_scope: set, lang: str, stage: str, mode: str, about_shown: bool,
    cart_ids: List[str], in_tray: Optional[set] = None, understood: Optional[Dict[str, Any]] = None,
    owner_pick: Optional[Tuple[str, List[str]]] = None,
) -> Optional[Tuple[str, List[Dict[str, Any]], str]]:
    """(reply, cards, note) in the waiter's fixed recommendation shape — or None when the turn needs the model.
    With a reading of the guest (`understood`): only when they want a recommendation, and its kind / taste /
    audience / count fill in what the word patterns missed ("ঝাল খাবারের মধ্যে কি আছে?" → the spicy shape)."""
    t = transcript or ""
    u = understood
    # ("সবচেয়ে জনপ্রিয় কোনটা?" about the dishes on screen still gets the honest answer below — the model once claimed
    # "Burger & Fries Combo … জনপ্রিয়" with no order numbers behind it)
    if stage != "none" or mode in ("quiet", "complement", "last_call") or (about_shown and not _POPULAR_Q.search(t)):
        return None
    # an allergy / a diet at this table → the model: what to avoid, what they CAN have, "please tell the staff" — never
    # the plain shape (it answered "বাদাম খাই না, কি খেতে পারি?" with Chocolate Brownie among the specials)
    # ("গরু খাই না" stays here: the ranking already leaves beef out, nothing to warn about)
    if profile.allergies or profile.vegetarians_in_party or set(profile.diet) & {"vegetarian", "vegan"}:
        return None
    # the owner chose what to show for this ask ("ঝাল কিছু আছে?" → their dishes, in their order)
    if owner_pick and not _dishes_named(t, index) and not _NOT_WANT.search(t) and (
            (u or {}).get("intent") == "recommend" or (_ASKING.search(t) and not _orders_now(t))):
        word, ids = owner_pick
        mine = [index.by_id[i] for i in ids if i in index.by_id and i not in (in_tray or set())] or \
               [index.by_id[i] for i in ids if i in index.by_id]
        n = _asked_count(t) or int((u or {}).get("count") or 0)
        mine = mine[:n] if n else mine[:5]
        if mine:
            names = [re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")).strip() for it in mine]
            # (no "very popular" — the owner chose them; that's not evidence of how often they're ordered)
            text = reco_format.kind_text(word, names[:3], names[3:5], lang, popular=False)
            return text, [_suggestion_row(it) for it in mine], "reco_owner"
    period_q = bool(_meal_period(t) and _ASKING.search(t))  # "বিকেলের মেনুতে কি কি পাওয়া যায়?"
    if u is not None and u.get("intent") != "recommend" and not period_q and not _POPULAR_Q.search(t):
        return None  # ("সবচেয়ে জনপ্রিয় কোনটা?" is always answered honestly below, whatever the reading says)
    if _ASKED_FOR_ONE.search(t) or _a_dish_not_kind(t, index, kind_scope) or missing_kinds(t, index):
        return None
    if reco_format.taste_asked(t) and _one_dish_word(t, index):
        return None  # "Is the pepperoni spicy?" — about that dish, not a list of spicy ones
    if _BRANDS.search(t) or _PRICE_Q.search(t):
        # "মোজো বা ফান্টা বা কোক আছে?" is about brands, not a kind ("কোকের মধ্যে আছে … জুস" was wrong); "সরা দইয়ের দাম
        # কত?" wants a price ("সরা আইটেমের মধ্যে…" never said it) → the model, with the facts
        return None
    if _POPULAR_Q.search(t) and not kind_scope and not _NOT_WANT.search(t):
        # "সবচেয়ে জনপ্রিয় কোনটা?" — from real orders when there are any; otherwise said honestly, with the house
        # specials (it once invented "Burger & Fries Combo বাচ্চাদের জন্য দারুণ… জনপ্রিয়")
        on = [it for it in index.items if orderable.get(index.item_id(it), True) and not it.get("hidden")
              and menu_answers.course(it) in ("main", "starter") and index.item_id(it) not in set(in_tray or ())]
        if about_shown and rstate.last_offered:  # "…of these": among the dishes just shown
            on = [it for it in on if index.item_id(it) in set(rstate.last_offered)] or on
        hot = sorted((it for it in on if stats.pop_score(index.item_id(it)) >= 1.2),
                     key=lambda it: -stats.pop_score(index.item_id(it)))[:3]
        star = [it for it in on if is_signature(it)][:3]
        pick = hot or star
        if pick:
            names = [bangla_meal.said_name(x) for x in pick]
            if hot:
                text = (f"এখানে সবচেয়ে বেশি অর্ডার হয় {reco_format._join(names, 'আর')}। কোনটা দেব?" if lang == "bn"
                        else f"Our most ordered are {reco_format._join(names, 'and')}. Which would you like?")
            else:
                text = (f"কোনটা সবচেয়ে বেশি চলে সেই হিসাব আমার কাছে নেই — তবে আমাদের স্পেশাল হলো "
                        f"{reco_format._join(names, 'আর')}। কোনটা দেব?" if lang == "bn"
                        else f"I don't have the sales numbers — but our specials are {reco_format._join(names, 'and')}. "
                             "Which would you like?")
            return text, [_suggestion_row(x) for x in pick], "reco_popular"
        if about_shown and rstate.last_offered:
            # no order numbers and no house special among the dishes just shown: say so, and start with the first two
            shown_now = [index.by_id[i] for i in rstate.last_offered if i in index.by_id]
            first = ([x for x in shown_now if menu_answers.course(x) in ("main", "starter")] or shown_now)[:2]
            if first:
                names = [bangla_meal.said_name(x) for x in first]
                text = (f"কোনটা সবচেয়ে বেশি চলে সেই হিসাব আমার কাছে নেই — তবে এগুলোর মধ্যে "
                        f"{reco_format._join(names, 'বা')} দিয়ে শুরু করতে পারেন। কোনটা দেব?" if lang == "bn"
                        else f"I don't have the sales numbers — of these, the {reco_format._join(names, 'or')} is a good "
                             "place to start. Which would you like?")
                return text, [_suggestion_row(x) for x in first], "reco_popular"
    if _CHEAPER.search(t) and not _NOT_WANT.search(t) and not (
            profile.allergies or profile.diet or profile.vegetarians_in_party):  # (those: the model adds the safety note)
        # "এইগুলার অনেক দাম। একটু কম দামের মধ্যে সাজেস্ট করো" → cheaper than what they saw (profile.max_price), else the
        # most affordable — said WITH the prices (it once answered with a plain "রাতের খাবারে … খুবই ভালো")
        ranked, _ = rank(index, orderable, kinds, profile, stats=stats, context_ids=cart_ids, recent=rstate.recent,
                         limit=len(index.items), only=kind_scope or None, exclude=set(in_tray or ()))
        food, seen = [], set()
        for p in ranked:
            f = dish_facts(p.item)
            key = re.sub(r"\s*\(.*?\)", "", str(p.item.get("name") or "")).strip().lower()
            if (orderable.get(index.item_id(p.item), True) and _lowest_price(p.item) > 0 and key not in seen
                    and (kind_scope or not (f["drink"] or f["side"] or f["dessert"] or is_packaged(p.item)
                                            # ("কোকা কোলা" / "স্প্রাইট" — Bangla-named bottles — were "the cheapest food")
                                            or upsell_engine.dish_roles(p.item)["drink"]
                                            # (nor সাদা ভাত, বেগুন ভাজা, a পরোটা, an "এক্সট্রা পোলাও": a meal's parts)
                                            or menu_answers.course(p.item) not in ("main", "starter")))):
                seen.add(key)
                food.append(p)
        if not food and profile.max_price and rstate.cheaper_than:
            # nothing below the cheapest dish they saw → below the dearest one (still "cheaper than those")
            wider = GuestProfile.from_dict({**profile.to_dict(), "max_price": rstate.cheaper_than - 1})
            ranked, _ = rank(index, orderable, kinds, wider, stats=stats, context_ids=cart_ids, recent=rstate.recent,
                             limit=len(index.items), only=kind_scope or None, exclude=set(in_tray or ()))
            for p in ranked:
                f = dish_facts(p.item)
                key = re.sub(r"s*(.*?)", "", str(p.item.get("name") or "")).strip().lower()
                if (orderable.get(index.item_id(p.item), True) and _lowest_price(p.item) > 0 and key not in seen
                        and index.item_id(p.item) not in set(rstate.last_offered)
                        and (kind_scope or menu_answers.course(p.item) in ("main", "starter"))
                        and not (f["drink"] or is_packaged(p.item))):
                    seen.add(key)
                    food.append(p)
        if not profile.max_price:
            food.sort(key=lambda p: _lowest_price(p.item))  # nothing to compare with: the most affordable
        food = sorted(food[:5], key=lambda p: _lowest_price(p.item))
        if food:
            plain = lambda it: re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")).strip()  # noqa: E731
            say = [f"{plain(p.item)} ({_money(_lowest_price(p.item))})" for p in food]
            top, more = say[:3], say[3:]
            if lang == "bn":
                text = "কম দামের মধ্যে " + reco_format._join(top, "অথবা") + " নিতে পারেন" + (
                    f", এছাড়াও {reco_format._join(more, 'কিংবা')}-ও আছে।" if more else "।")
            else:
                text = "For something more affordable: " + reco_format._join(top, "or") + (
                    f" — or {reco_format._join(more, 'or')}." if more else ".")
            return text, [_suggestion_row(p.item, "more affordable") for p in food], "reco_cheaper"
    # ("মাছ ছাড়া" right after the suggestions is no question, but it asks for them again without the fish)
    refines = bool(extract_prefs(t).avoid) and len(t.split()) <= 3 and bool(rstate.last_offered) and         rstate.turn - rstate.last_offer_turn <= 1 and not _orders_now(t)
    if u is None and not refines and (_orders_now(t) or _ABOUT_MINE.search(t) or not _ASKING.search(t)):
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
    if _FOLLOW_UP.search(t) and not refines:
        return None  # "আর কী আছে?" / "what else?" — other than what we just said → the model, with the conversation
    if re.search(r"(?<![ঀ-৿])(হাফ|ফুল|অর্ধেক|কোয়ার্টার|কোয়ার্টার|সিঙ্গেল|ডাবল)(?![ঀ-৿])|\b(half|full|quarter|single|double)\b", t, re.I):
        return None  # "হাফ প্লেট কাচ্চি হবে?" asks for a size — answered with it ("Basmati Kacchi Half ৳…"), not a kind list
    if _CONTENTS_Q.search(t):
        return None  # "কম্বোতে কি কি থাকে?" — what's in it (the model, from its description), not a list of combos
    if re.search(r"ভেজ|নিরামিষ|ভেজিটেরিয়ান|\b(veg|vegetarian|vegan|veggie)\b", t, re.I):
        return None  # "ভেজ বার্গার আছে?" — the vegetarian ones (or "none"), never the beef burgers listed as burgers
    if _NOT_WANT.search(t):
        return None  # "…খেতে চাই না" — never answered with a list of dishes
    said = extract_prefs(t)
    # ("ঠান্ডা কিছু" is a mood to the patterns, but when the reading says it means drinks, it's just the kind)
    moods = set(said.mood) - {"sharing"} - ({"cold", "refreshing"} if (u or {}).get("kind") else set())
    # "মাছ ছাড়া" / "গরু ছাড়া" right after the suggestions: the same suggestion without it (the ranking leaves it out)
    refine = refines and not (said.party_size or said.budget or said.max_price or moods)
    if (said.avoid or said.party_size or said.budget or said.max_price or said.spice == "mild" or moods) and not refine:
        return None  # a budget, a head-count, "less spicy", "something light"… → the model plans it
    # ("গরু ছাড়া" is a no-beef diet — nothing to warn about: the ranking leaves beef out)
    diet = set(profile.diet) | set(said.diet)
    if profile.allergies or profile.vegetarians_in_party or said.allergies or (diet and not (refine and diet <= {"no_beef"})):
        return None  # an allergy / diet at this table: the model adds the "staff will confirm" safety note
    aud = reco_format.audience_asked(t) or aud_u
    taste = reco_format.taste_asked(t) or taste_u
    # "ওইটা ঝাল?" / "Is it very spicy?" right after a list → about THOSE dishes (it once answered with another list
    # of spicy dishes)
    if (taste and taste[0] == "spicy" and _POINTING_AT.search(t) and rstate.last_offered
            and rstate.turn - rstate.last_offer_turn <= 1):
        shown = [index.by_id[i] for i in rstate.last_offered if i in index.by_id]
        hot = [x for x in shown if dish_facts(x).get("heat") in ("spicy", "likely spicy")]
        mild = [x for x in shown if x not in hot]
        say = lambda xs, w: reco_format._join([bangla_meal.said_name(x) for x in xs], w)  # noqa: E731
        if shown:
            bn = lang == "bn"
            if len(shown) == 1:
                d = bangla_meal.said_name(shown[0])
                text = ((f"হ্যাঁ, {d} একটু ঝাল। দেব?" if hot else f"না, {d} তেমন ঝাল নয়। দেব?") if bn
                        else (f"Yes, the {d} is on the spicy side. Shall I add it?" if hot
                              else f"No, the {d} isn't very spicy. Shall I add it?"))
            elif bn:
                text = ((f"এগুলোর মধ্যে ঝাল হলো {say(hot, 'আর')}" + (f"; {say(mild, 'আর')} তেমন ঝাল নয়" if mild else ""))
                        if hot else "এগুলোর কোনোটাই তেমন ঝাল নয়") + "। কোনটা দেব?"
            else:
                text = ((f"Of these, the {say(hot, 'and')} {'is' if len(hot) == 1 else 'are'} spicy"
                         + (f"; the {say(mild, 'and')} {'is' if len(mild) == 1 else 'are'} not" if mild else ""))
                        if hot else "None of these is very spicy") + ". Which would you like?"
            return text, [_suggestion_row(x) for x in (hot or shown)], "taste_of_shown"
    if aud:
        if taste or kind_scope:
            return None  # "বাচ্চাদের জন্য মিষ্টি কিছু" — two asks at once → the model
        shape = "audience"
    elif taste:
        if kind_scope:
            return None  # "ঝাল স্যুপ" → the model
        shape = "taste"
    elif kind_scope:
        # "ম্যাঙ্গো শেক আছে?" with mango juices and other shakes but no mango shake: a dish this menu doesn't have —
        # the model says so (it once listed every mango and every shake as "ম্যাঙ্গো আইটেম")
        per_word = [s for s in (_kind_ids_in(w, index) for w in re.findall(r"[A-Za-z]+|[ঀ-৿]+", t)) if s]
        if len(per_word) >= 2 and not set.intersection(*per_word):
            return None
        shape = "kind"
    elif _WANTS_A_PICK.search(t) or asks_for_recommendation(t) or u is not None or period_q or refine:
        shape = "general"
    else:
        return None

    # a Bengali bhaat restaurant while rice is served: "কী খাওয়া যায়?" → rice with its curries and sides, the way its
    # waiter says it — never "আলু ভর্তা, ডাল…" as dishes of their own
    if shape == "general" and not _asked_count(t) and (
            any(k in ("lunch", "dinner", "late") for k in kinds) or re.search(r"ভাত|\b(rice|bhat|bhaat)\b", t.lower())) \
            and bangla_meal.is_bhaat_house(index.items):
        ranked_all, _ = rank(index, orderable, kinds, profile, stats=stats, context_ids=cart_ids, recent=rstate.recent,
                             limit=len(index.items))
        rice_in_tray = any(bangla_meal.role(index.by_id[i]) == "rice" for i in (in_tray or ()) if i in index.by_id)
        tray = in_tray or set()
        m = bangla_meal.meal([p.item for p in ranked_all if orderable.get(index.item_id(p.item), True)
                              and (index.item_id(p.item) not in tray or bangla_meal.role(p.item) == "rice")])
        if m:
            text = bangla_meal.meal_text(m, lang, rice_in_tray=rice_in_tray)
            curries = m["fish"] + m["chicken"] + m["meat"]
            cards = curries + ([] if rice_in_tray else [m["rice"]]) + m["side"][:1]
            return text, [_suggestion_row(it) for it in cards], "reco_bhaat"

    prof = profile
    if aud and aud[2] and "sharing" not in profile.mood:  # a family / friends table: dishes made for sharing first
        prof = GuestProfile.from_dict({**profile.to_dict(), "mood": list(profile.mood) + ["sharing"]})
    ranked, _ = rank(index, orderable, kinds, prof, stats=stats, context_ids=cart_ids, recent=rstate.recent,
                     asked_for=set(kind_scope), limit=60, only=kind_scope or None, exclude=set(in_tray or ()))
    items = [p for p in ranked if orderable.get(index.item_id(p.item), True)]
    if shape != "kind" and not re.search(r"ড্রিংক|পানীয়|ঠান্ডা|ঠাণ্ডা|জুস|কফি|(?<![ঀ-৿])চা(?![ঀ-৿])|মিষ্টি|ডেজার্ট|"
                                         r"\b(drinks?|juice|coffee|tea|sweet|dessert|thanda)\b", t, re.I):
        # ("মাছ ছাড়া" once got "প্রকৃত আনারস" — a juice — among the dishes; at breakfast, when few dishes are on, a
        # juice and two puddings were "what to eat") — food first, ALWAYS; a dessert only when there's no food at all
        food = [p for p in items if menu_answers.course(p.item) in ("main", "starter", "bread")]
        sweets = [p for p in items if menu_answers.course(p.item) == "dessert"]
        items = food or sweets or items
    if shape == "audience" and (profile.kids or (aud and re.search(r"বাচ্চা|শিশু|ছোটদের|kid|child", str(aud[0]) + t, re.I))):
        # for a child: never the Triple Cheese Tower or a naga burger (kid_friendly)
        kept = [p for p in items if followups.kid_friendly(p.item)]
        items = kept if len(kept) >= 2 else items
    if shape != "kind" and bangla_meal.is_bhaat_house(index.items):
        # a bhaat restaurant: bhorta / bhaji / dal only ever WITH rice; and outside rice time (বিকেলের নাস্তা) the
        # curries made for rice aren't "something to eat now" — snacks, soup, tea, doi are
        items = [p for p in items if bangla_meal.role(p.item) != "side"]
        if not any(k in ("lunch", "dinner", "late") for k in kinds):
            light = [p for p in items if bangla_meal.role(p.item) not in ("fish", "chicken", "meat")]
            if len(light) >= 3:
                items = light
    if shape != "kind" and not (taste and taste[0] in ("sweet", "sour")):
        items = [p for p in items if not dish_facts(p.item)["drink"]]  # nobody recommends water as "something good"
    if taste:
        items = [p for p in items if reco_format.has_taste(taste[0], p.item, dish_facts(p.item), is_signature)]
        if taste[0] == "spicy":
            # "ঝাল কিছু আছে?" is food: a 🌶 on a milkshake or a sweet (ওরিও ব্লাস্ট 🌶🌶🌶🌶) doesn't make it the answer
            # (nor anything in a drinks section: "ওরিও ব্লাস্ট" names no drink — its section "কলিজা ঠাণ্ডা" is all drinks)
            by_cat: Dict[str, List[str]] = {}
            for it in index.items:
                by_cat.setdefault(str(it.get("category") or ""), []).append(_period_role(it))
            # (a sweets section the same: "জাফরানি মালাই ঘি সুজি 🌶🌶" in "মিষ্টি বিলাস")
            drink_cats = {c for c, roles in by_cat.items()
                          if c and (roles.count("drink") * 2 >= len(roles) or roles.count("sweet") * 2 >= len(roles)
                                    or re.search(r"মিষ্টি|ডেজার্ট|dessert|sweet", c, re.I))}
            items = [p for p in items if _period_role(p.item) not in ("drink", "sweet")
                     and str(p.item.get("category") or "") not in drink_cats]
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
        # (for children what suits them leads — a signature Triple Cheese Tower is no kid's dish)
        top, more = reco_format.split(items if shape == "audience" and profile.kids else star + rest)
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
        return bangla_meal.said_name(p.item)  # (no "(…)", no 🌶 ✓ — they are not said)

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
    if shape == "kind" and len(top + more) == 1:
        # "চা আছে?" with one tea on the menu: "জি, ষোল আনা স্পেশাল চা আছে — ৳40। দেব?" (not "চা আইটেমের মধ্যে … খুবই ভালো")
        one = (top + more)[0].item
        price = _money(_lowest_price(one))
        text = (f"জি, {said_name(top[0] if top else more[0])} আছে — {price}। দেব?" if lang == "bn"
                else f"Yes, we have the {said_name(top[0] if top else more[0])} ({price}) — shall I add one?")
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
    # speech-to-text spellings: "রুইমাছ এক্টা" → "রুই মাছ একটা" (the fish joined to its kind, a misspelt number)
    transcript = re.sub(r"([ঀ-৿]{2,}?)(মাছ|ভর্তা|ভুনা|কাবাব)(?![ঀ-৿])", r"\1 \2", transcript or "")
    transcript = re.sub(r"(?<![ঀ-৿])এক্টা(?![ঀ-৿])", "একটা", transcript)
    # "ম্যাংগো" and "ম্যাঙ্গো" are one word spelt two ways (ং+গ = ঙ্গ): one spelling, so "দুইটা ম্যাংগো জুস" is Mango Juice
    transcript = transcript.replace("ংগ", "ঙ্গ")
    # "ফাস্ট ফুড" is one word to a guest ("ফাস্টফুড আইটেমে কী কী আছে?"); said apart, "ফাস্ট" fuzzy-matched "Pasta"
    transcript = re.sub(r"(ফাস্ট|ফাষ্ট)\s+(ফুড|ফুট)", r"\1\2", transcript)
    ctx = dict(context or {})
    restaurant = restaurant or ctx.get("restaurant")
    lang = locale if lock_language and locale in ("bn", "en") else reply_language(transcript, locale)
    ids = {"tenant": tenant, "branch": branch, "channel": channel, "conversationId": conversation_id, "userId": user_id}
    # online guests (pickup / delivery) finish on the checkout form — no table, no placing by voice
    online = str(channel or ctx.get("channel") or "").strip().lower() == "online"
    # (the model's "Channel:" line — the app sends the channel beside the context, so an online guest once read as
    # dine-in and was told "we don't deliver")
    ctx["channel"] = (("online — " + ctx["fulfillment"]) if ctx.get("fulfillment") in ("pickup", "delivery") else "online") \
        if online else "dine-in"
    # which of name / phone / address the guest's form still lacks (from the app) — only those are ever asked for.
    # (The app lists an empty address whatever the toggle says; it only counts for delivery.)
    fulfillment = "pickup" if ctx.get("fulfillment") == "pickup" else "delivery"
    contact_raw = ([str(m) for m in ctx["contactMissing"] if m in ("name", "phone", "address")]
                   if isinstance(ctx.get("contactMissing"), list) else None)

    def missing_for(f: str) -> Optional[List[str]]:
        return None if contact_raw is None else [m for m in contact_raw if m != "address" or f == "delivery"]

    contact_missing = missing_for(fulfillment)

    index = MenuIndex(_day_dishes((menu_snapshot or {}).get("items") or [], ctx.get("localTime")))
    orderable = {index.item_id(it): it.get("available") is not False for it in index.items}
    if OPENAI_API_KEY and MENU_PROFILE_AI:
        menu_profile.warm(index.items, _read_menu)  # once per menu, in the background: "what do you have?"
    # this restaurant's cuisines (from its dishes) → which knowledge packs the waiter reads (knowledge/)
    cuisines = knowledge.cuisine_keys(menu_profile.menu_glance(index.items))
    # what the menu-data checks worked out for this turn — handed to the model to answer from (AI_FIRST)
    facts: List[str] = []
    if AI_FIRST:
        facts += _closed_fact(list((restaurant or {}).get("opening") or []), str(ctx.get("localTime") or ""))
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
    # "না দাঁড়ান, একটা ফ্রাইড রাইস ও দেন" while the order is read back → still ordering: back to taking the order (it
    # answered "ঠিক আছে, এখনই দিচ্ছি না" and added nothing)
    # (only with a "wait" in it — "add one Borhani too" during the read-back is added and read back again, as ever)
    if (stage in ("readback", "table") and _orders_now(transcript) and not _SAYS_CONFIRM.search(transcript)
            and co.wants_to_hold(transcript)
            and (_dishes_named(transcript, index, limit=1) or _new_words(transcript, index))):
        ck, stage = {**ck, "stage": "none"}, "none"
    if stage == "details" and (not online or not cart_rows):
        # the form's order was placed (or the tray emptied) — a new order starts from the top: read-back first
        stage, ck = "none", {**ck, "stage": "none"}
    table = co.table_from_text(transcript, expecting=stage == "table") or str(ctx.get("table") or ck.get("table") or "").strip() or None
    # online (pickup / delivery) has no table — the checkout steps never wait for one
    ck_table = "online" if online else table
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
    # "বিকেলের মেনুতে কি কি পাওয়া যায়?" → suggestions for THAT meal ("বিকেলের নাস্তায় … ভালো"), not the menu page
    period_asked = _meal_period(transcript)
    if period_asked:
        kinds = [period_asked]
    rstate = RecoState.from_dict((dialog_state or {}).get("reco"))
    # "দ্বিতীয়টার দাম কত?" / "প্রথমটা কেমন?" right after a list → THAT dish, by its place in the list just said (the model
    # once priced the third one). Not a tray change ("প্রথমটা বাদ দিন" is the tray's first line).
    transcript = _ordinal_to_dish(transcript, rstate, index)
    rstate.continuing = bool(followups.ask_kind(transcript))  # (a follow-up adds to the suggestion thread — to_dict)
    profile = GuestProfile.from_dict(rstate.profile).merge(extract_prefs(transcript))
    # ("মাছ ছাড়া" after the suggestions turns down the fish only — the profile's avoid does that — not the chicken too)
    if rstate.last_offered and is_decline(transcript) and rstate.turn - rstate.last_offer_turn <= 1 and not (
            extract_prefs(transcript).avoid and len(transcript.split()) <= 4):
        profile.declined = list(dict.fromkeys(profile.declined + rstate.last_offered))
        rstate.declined_turn = rstate.turn
    # "না এগুলা ভালো লাগছে না, অন্য কিছু সাজেস্ট করো" → the dishes on screen / just suggested are turned down — every
    # one of them (it once answered "এগুলোর মধ্যে সেট মেনু-6 সবচেয়ে ভালো হবে")
    # "প্লেটার খাবো না" / "no sizzling" → every dish of that kind is out for the rest of the visit (a named dish: just it)
    # (not in an order: "একটা বার্গার দাও, পেঁয়াজ ছাড়া" keeps the burger)
    if _DONT_WANT.search(transcript or "") and not _orders_now(transcript):
        named = _dishes_named(transcript, index, limit=3)
        out_ids = [index.item_id(it) for it in named] if named else sorted(_kind_ids_in(transcript, index))
        if out_ids:
            profile.declined = list(dict.fromkeys(profile.declined + [i for i in out_ids if i not in cart_qty]))
            rstate.declined_turn = rstate.turn
    rejects_these = bool(_REJECTS_THESE.search(transcript or ""))
    if rejects_these:
        gone = [str(x) for x in (ctx.get("shownItems") or []) if str(x) in index.by_id] or (
            rstate.last_offered if rstate.last_offered and rstate.turn - rstate.last_offer_turn <= 2 else [])
        profile.declined = list(dict.fromkeys(profile.declined + [i for i in gone if i not in cart_qty]))
        rstate.declined_turn = rstate.turn
    # "something cheaper" → a real ceiling: below the cheapest dish we just suggested
    # (what's on screen, else what we suggested in the last few turns — "এইগুলার অনেক দাম" two turns later too)
    if _CHEAPER.search(transcript):
        before = [str(x) for x in (ctx.get("shownItems") or []) if str(x) in index.by_id] or (
            rstate.last_offered if rstate.last_offered and rstate.turn - rstate.last_offer_turn <= 3 else [])
        # (the dishes, not the সাদা ভাত / ডাল card beside them — "under ৳40" left nothing to suggest)
        mains = [i for i in before if i in index.by_id and menu_answers.course(index.by_id[i]) in ("main", "starter")]
        prev = [p for p in (_lowest_price(index.by_id[i]) for i in (mains or before) if i in index.by_id) if p > 0]
        if prev:
            profile.max_price = int(min(prev)) - 1
            rstate.cheaper_than = int(max(prev))  # (nothing below the cheapest of them → below the dearest)
    stats = OrderStats(**(ctx.get("orderStats") or {})) if isinstance(ctx.get("orderStats"), dict) else OrderStats()
    mentioned_now = [index.item_id(it) for it in _dishes_named(transcript, index, limit=6)]
    asked_ids = {index.item_id(it) for it in index.items if explicitly_asked(it, transcript)}
    # "স্যুপের মধ্যে কী ভালো?" → the picks are soups only (not one soup + two dinner dishes)
    kind_scope = _named_kind_ids(transcript, index)
    if kind_scope and _DONT_WANT.search(transcript or "") and not _orders_now(transcript):
        kind_scope = set()  # "মাছ ছাড়া" names the kind to leave OUT, not the one to show
    if kind_scope and not any(orderable.get(i, True) for i in kind_scope):
        kind_scope = set()  # none of them can be ordered now → the usual picks, the waiter says so
    # the owner's picks (Settings → Upsell & picks): the guest asks for one of its words → its dishes are the picks
    owner_pick = _owner_pick(transcript, (restaurant or {}).get("suggestRules"), index, orderable)
    if owner_pick:
        kind_scope = set(owner_pick[1])
    # already in the tray → never recommended back to them (they chose it) — unless they name it now
    in_tray = {i for i in cart_qty if cart_qty[i] > 0} - asked_ids
    asked_ids |= kind_scope
    picks, blocked = rank(
        index, orderable, kinds, profile, stats=stats, context_ids=list(cart_qty) + mentioned_now,
        recent=rstate.recent, asked_for=asked_ids, only=kind_scope or None, exclude=in_tray,
        limit=max(8, profile.party_size + 5),  # a table of 6 needs more distinct dishes to plan with
    )
    # a ভাত restaurant: a bhorta / bhaji / dal, or the plain rice, is what goes WITH the meal — never the pick itself
    # ("বিকেলে হালকা কিছু" once got বেগুন ভাজা, a budget plan শুটকি ভুনা's neighbour ডিম ভর্তা)
    if not kind_scope and bangla_meal.is_bhaat_house(index.items):
        kept = [p for p in picks if index.item_id(p.item) in asked_ids
                or not (bangla_meal.role(p.item) == "side" or bangla_meal.is_plain_rice(p.item))]
        picks = kept if len(kept) >= 3 else picks
    # any restaurant: an extra / a sauce / plain rice, a drink or a dessert is never the answer to "what should I eat?"
    # ("আরেকটু কম দামে" once got এক্সট্রা পোলাও রাইস and a pineapple drink) — unless that's what they asked for
    if not kind_scope and not re.search(r"ড্রিংক|পানীয়|ঠান্ডা|ঠাণ্ডা|জুস|কফি|(?<![ঀ-৿])চা(?![ঀ-৿])|মিষ্টি|ডেজার্ট|"
                                        r"\b(drinks?|juice|coffee|tea|sweet|dessert|thanda)\b", transcript, re.I):
        kept = [p for p in picks if index.item_id(p.item) in asked_ids
                or menu_answers.course(p.item) in ("main", "starter", "bread")]
        # (food always first — even when fewer than three are on: never a juice and puddings as "what to eat")
        picks = kept or [p for p in picks if menu_answers.course(p.item) == "dessert"] or picks
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
    # the owner set this word as a suggestion ("ঠান্ডা কিছু" → their drinks): asking for it is not a complaint
    if owner_pick and mode == "quiet" and mode_why == "service request or complaint" and _ASKING.search(transcript or ""):
        mode, mode_why = "full", "the owner's word for a suggestion"
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
    named_elsewhere = [it for it in _dishes_named(transcript, index, limit=4) if index.item_id(it) not in shown_ids]
    about_shown = (len(shown) >= 2 and bool(_REF_LIST.search(transcript)) and not named_elsewhere and stage == "none"
                   and not rejects_these  # "এগুলা ভালো লাগছে না" is not "which of these?"
                   # ("স্যুপ কোনটা ভালো?" with spicy dishes on screen — a kind named that isn't what's shown: about soups)
                   and not (kind_scope and not kind_scope & set(shown_ids)
                            and not re.search(r"এগুল|ওগুল|এইগুল|ঐগুল|এদের|ওদের|\b(these|those|them)\b", transcript, re.I)))
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
        text = re.sub(r"[ \t]*[🌶✓✔★☆🔥⭐]+️?", "", text).strip()  # (menu-card marks are never said)
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
        if stage != "none" or offer_pending:
            return None
        only = None
        if not offers.may_offer(rstate, moment, arm):
            # (the "late" timing arm still asks what completes the meal — rice / bread — right after it's ordered;
            # the budget and two "no"s still stop it)
            if not offers.may_offer(rstate, moment, {**arm, "timing": "early"}):
                return None
            only = offers.MEAL_COMPLETING
        # what's already in the kitchen counts toward the meal ("আরেকটা স্যুপ" after a fried rice was ordered: no
        # "মেইন কোর্সে Beef Sizzling নেবেন?" — the main is on its way)
        placed = []
        for o in ((ctx.get("kitchen") or {}).get("myOrders") or []):
            for nm in o.get("items") or []:
                it = index.resolve(None, nm if isinstance(nm, str) else (nm or {}).get("name"))
                if it and all(r.get("itemId") != index.item_id(it) for r in rows_now):
                    placed.append({"itemId": index.item_id(it), "quantity": 1, "price": 0, "placed": True})
        return offers.plan(moment, offers.Ctx(
            index=index, orderable=orderable, rows=rows_now + placed, added=added, picks=[p.item for p in picks], stats=stats,
            profile=profile, clash=clash, lang=lang, arm=arm, meal_kinds=kinds, done_types=rstate.gaps_offered,
            owner_rules=list((restaurant or {}).get("upsellRules") or [])), only=only)

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
        if made_offer.get("choices") and not decision_.get("chooseOptions"):  # "পরোটা, নাকি নান?" — a button each
            decision_["chooseOptions"] = [{"label": ch["label"], "say": ch["label"]} for ch in made_offer["choices"]] + [
                {"label": "না, থাক", "say": "না"} if bn else {"label": "No, thanks", "say": "no"}]
        if not decision_.get("chooseOptions"):  # F: a yes/no question — one tap answers it too
            decision_["chooseOptions"] = (
                [{"label": "হ্যাঁ, দিন", "say": "হ্যাঁ"}, {"label": "না, থাক", "say": "না"}] if bn
                else [{"label": "Yes, add it", "say": "yes"}, {"label": "No, thanks", "say": "no"}])

    def bread_with_kebabs(text: str, m: Dict[str, Any], shown: List[Dict[str, Any]]) -> str:
        """Kebabs suggested, no bread in the tray → "…কাবাবের সাথে পরোটা নেবেন, নাকি নান?" ("নান" → which naan)."""
        kebabs = [it for it in shown if offers.is_kebab(it)]
        if (not shown or len(kebabs) * 2 <= len(shown) or stage != "none" or offer_pending
                or "bread" in rstate.gaps_offered or not offers.may_offer(rstate, "first_add", {**arm, "timing": "early"})
                or any(upsell_engine.dish_roles(index.by_id[i])["rice"] for i in cart_qty if i in index.by_id)):
            return text
        o = offers.bread_offer("first_add", offers.Ctx(
            index=index, orderable=orderable, rows=cart_rows, added=[], picks=[p.item for p in picks], stats=stats,
            profile=profile, clash=clash, lang=lang, arm=arm, meal_kinds=kinds, done_types=rstate.gaps_offered),
            set(cart_qty))
        if not o or not o.choices:
            return text
        # said, not asked: the list already ends "কোনটা দেব?" — two questions at once leave the guest unsure which to
        # answer. The "পরোটা নেবেন, নাকি নান?" question comes once a kebab is in the tray.
        ask = "সাথে পরোটা বা নান-ও নিতে পারেন।" if bn else "You can have paratha or naan with it too."
        if bn:
            m["voiceReplyText"] = (m.get("voiceReplyText") or text) + " " + ask
        return text + " " + ask

    said_number = _said_quantity(transcript)
    short_no = (len(transcript.split()) <= 3 and said_number is None
                and (co.wants_to_hold(transcript) or is_decline(transcript)))
    # (e0) The table's bell (top-left of a dine-in page with its table number) is how a guest calls staff. Said to the
    # waiter: a vague "আপনারা কি কিছু সার্ভিস করবেন?" → point at the bell and offer to open it; a clear "ওয়েটার ডাকেন" /
    # "বিলটা দিন" → open its options straight away. Also while a checkout question is open (it once answered "staff
    # can't be called" there). With automatic paging on (staffAlerts) a clear call stays the model's: it pages them.
    bell = bool(str(ctx.get("table") or "").strip()) and not online
    service_ok = stage in ("none", "table", "readback")

    def service_options() -> Dict[str, Any]:
        tstate["pending"] = None
        text = ("কোন সার্ভিসের জন্য ওয়েটার চাচ্ছেন? নিচে থেকে বেছে নিন — ওয়েটার, বিল, পানি বা টেবিল পরিষ্কার।" if bn
                else "What do you need the waiter for? Pick below — a waiter, the bill, water or cleaning the table.")
        res = tray_done(text, [], False, cart_rows, "service_options", "other")
        res["meta"].setdefault("decision", {})["openServiceSheet"] = True
        return res

    def no_bell() -> Dict[str, Any]:
        if online:
            text = ("অনলাইন অর্ডারে ওয়েটার ডাকার ব্যবস্থা নেই — অর্ডার নিয়ে কিছু জানার থাকলে আমাকেই বলুন।" if bn
                    else "Online orders don't have table service — but ask me anything about your order.")
            return tray_done(text, [], False, cart_rows, "service_online", "other")
        text = ("টেবিলের QR কোডটা স্ক্যান করলে উপরে বাঁ দিকে ঘণ্টার বোতাম পাবেন — ওখানে চাপলে ওয়েটার আসবে। অথবা কাউন্টারে বলুন।"
                if bn else "Scan the QR code on your table and you'll find a bell at the top left — tap it and a waiter "
                           "will come. Or just ask at the counter.")
        return tray_done(text, [], False, cart_rows, "service_no_table", "other")

    if pending and pending.get("kind") == "call_waiter" and service_ok:
        tstate["pending"] = None
        if co.says_yes(transcript) or is_affirmative(transcript) or _YES_START.search(transcript):
            return service_options()
        if short_no or upsell_engine._NO.search(transcript):
            text = "ঠিক আছে! আর কিছু লাগলে বলবেন।" if bn else "Alright! Just tell me if you need anything."
            return tray_done(text, [], False, cart_rows, "service_declined", "other")
    if service_ok and not _names_food(transcript, index):
        if _CALL_STAFF.search(transcript) and not (restaurant or {}).get("staffAlerts"):
            return service_options() if bell else no_bell()
        if _VAGUE_SERVICE.search(transcript):
            if not bell:
                return no_bell()
            tstate["pending"] = {"kind": "call_waiter"}
            text = ("উপরে বাঁ দিকে ঘণ্টার বোতাম আছে — ওখানে চাপলেই ওয়েটার ডাকা যায়। আমি কি এখনই খুলে দেব?" if bn
                    else "There's a bell at the top left — tap it to call a waiter. Shall I open it for you?")
            buttons = ([{"label": "হ্যাঁ, খুলুন", "say": "হ্যাঁ"}, {"label": "না", "say": "না"}] if bn
                       else [{"label": "Yes, open it", "say": "yes"}, {"label": "No", "say": "no"}])
            return _with_buttons(tray_done(text, [], False, cart_rows, "service_ask", "other"), buttons)

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
                      # ("আর ভাত" names food on this menu: a new request, even before it's matched to a dish;
                      # "কি আছে" is a question, said without its "?")
                      and not _new_words(transcript, index) and not _QUESTION.search(transcript)
                      # ("টক বেশি দিয়েন", "ঝাল কম" — how they want it: a note for the kitchen)
                      and not re.search(r"ঝাল|টক|মিষ্টি|লবণ|নুন|বেশি|বেশী|(?<![ঀ-৿])কম(?![ঀ-৿])|ছাড়া|ছাড়া|নোট|"
                                        r"\b(less|more|extra|without|no|spicy|sweet|salt)\b", transcript, re.I)
                      and not (co.says_yes(transcript) or is_affirmative(transcript) or _YES_START.search(transcript))
                      and not (upsell_engine._NO.search(transcript) or is_decline(transcript) or is_done_ordering(transcript))
                      and not (_CLEAR_ALL.search(transcript) or _DROP_HELD.search(transcript) or _tray.qty_intent(transcript))
                      # ("মাছ" / "নান" answer "মাছ নেবেন, নাকি মাংস?" — one of the question's own answers)
                      and not any(re.search(str(ch.get("match") or "(?!)"), transcript, re.I)
                                  for ch in ((pending.get("offer") or {}).get("choices") or []) if isinstance(ch, dict)))
        # "অর্ডার করবো" with an offer open — no to the offer, and on to the read-back (it once got "বুঝতে পারিনি")
        if (pending.get("kind") == "offer" and cart_rows and re.search(
                r"অর্ডার\s*(করবো|করব|করে দিন|করে দেন|দিবো|দিব|দেব|দেন|দিন|কনফার্ম)|কনফার্ম\s*(করেন|করুন|করো|করবো)?\s*$|"
                r"\b(place (the |my )?order|checkout|confirm( the| my)? order|that'?s it)\b", transcript, re.I)):
            print(f"[brain] open offer + {transcript!r} → no to the offer, then the read-back")
            transcript, short_no, unreadable = ("আর কিছু লাগবে না" if bn else "that's all"), False, False
        # "সাথে কিছু খাওয়ার" — asks what goes with it: the pairing answer, not the offer again
        if unreadable and re.search(r"সাথে\s*(কিছু\s*)?(খাওয়ার|খাওয়ার|খাবার|খেতে)|কিছু\s*(খাওয়ার|খাওয়ার|খাবার)|"
                                    r"\bsomething to eat\b", transcript, re.I):
            unreadable = False
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

    def _choice_buttons(choices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{"label": ch["label"], "say": ch["label"]} for ch in choices[:6]] + [
            {"label": "না, থাক", "say": "না"} if bn else {"label": "No, thanks", "say": "no"}]

    def _hold_choices(o_info: Dict[str, Any], text: str, choices: List[Dict[str, Any]], then: Any = None) -> None:
        """Ask the next question of the same offer (no new offer in the budget): its answers next turn."""
        nxt = {**o_info, "text": text, "choices": choices, "then": then,
               "item_ids": [i for ch in choices for i in ch.get("items") or []]}
        tstate["pending"] = {"kind": "offer", "ops": [], "clear": False, "offer": nxt}

    def _ask_next(o_info: Dict[str, Any], done: str, t_ops: List[Dict[str, Any]], after: List[Dict[str, Any]]) -> Dict[str, Any]:
        then = o_info["then"]
        _hold_choices(o_info, str(then.get("text") or ""), list(then.get("choices") or []))
        res = tray_done((done + " " + str(then.get("text") or "")).strip(), t_ops, False, after, "offer_accepted")
        return _with_buttons(res, _choice_buttons(list(then.get("choices") or [])))

    def _offer_choice(picked: Dict[str, Any], o_info: Dict[str, Any]) -> Dict[str, Any]:
        """The guest picked an answer: one dish → in the tray; several → "কোন নান দেব — A, B না C?" (a button each)."""
        items = [index.by_id[i] for i in picked.get("items") or [] if i in index.by_id]
        chosen = [it for it in _dishes_named(transcript, index, limit=3) if it in items]
        if len(chosen) == 1 or len(items) == 1:
            it = (chosen or items)[0]
            # ("নান" for two kebabs → two naan, one each — unless they say how many)
            per_kebab = sum(int(r["quantity"]) for r in cart_rows if r["itemId"] in index.by_id
                            and offers.is_kebab(index.by_id[r["itemId"]])) if o_info.get("type") == "bread" else 0
            op = {"op": "add", "itemId": index.item_id(it), "name": str(it.get("name")),
                  # ("দুইটা ভর্তা দাও" … "আলু" → two of them)
                  "quantity": said_number if said_number and said_number > 0
                  else (int(o_info.get("qty") or 0) or max(1, min(per_kebab, 6)))}
            v = offers._smallest_size(it) if len([x for x in it.get("variations") or [] if x.get("name")]) > 1 else None
            if v:
                op["variant"], op["price"] = str(v["name"]), float(v.get("price") or 0)
            after = _tray.simulate(cart_rows, [op], False, index.by_id)
            done = offers.accepted_text(o_info, [op], lang)
            if isinstance(o_info.get("then"), dict):
                return _ask_next(o_info, done, [op], after)
            close = "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn else "Anything else, or shall I confirm your order?"
            return tray_done((done + " " + close).strip(), [op], False, after, "offer_accepted")
        names = [bangla_meal.said_name(it) for it in items[:6]]
        # each answered by the word only it has ("গার্লিক" → Garlic Naan; "পাতলা" is in two of them)
        words = [set(n.split()) for n in names]
        sub = []
        for n, ws, it in zip(names, words, items):
            own = [w for w in ws if sum(w in o for o in words) == 1] or [n]
            sub.append({"label": n, "match": "|".join(re.escape(w) for w in own), "items": [index.item_id(it)]})
        joined = (", ".join(names[:-1]) + (" না " if bn else " or ") + names[-1]) if len(names) > 1 else names[0]
        text = picked.get("ask") or (f"কোন {picked.get('label')} দেব — {joined}?" if bn else f"Which {picked.get('label')} — {joined}?")
        _hold_choices(o_info, text, sub)
        res = tray_done(text, [], False, cart_rows, "offer_which", "other")
        res["meta"]["suggestions"] = [_suggestion_row(it) for it in items[:6]]
        return _with_buttons(res, _choice_buttons(sub))

    # (a-) the waiter's offer last turn ("…একটা ঠান্ডা Mint Lemonade ভালো যাবে (৳160)। দেব?") → "হ্যাঁ" applies it exactly
    # ("হ্যাঁ, দুইটা" → two), "না" is remembered (two "no"s → no more offers this visit), anything else → the usual flow
    if offer_pending and stage == "none":
        o_info = offer_pending.get("offer") or {}
        o_ops = [dict(x) for x in offer_pending.get("ops") or []]
        o_ids = {str(i) for i in o_info.get("item_ids") or []}
        named_other = [it for it in _dishes_named(transcript, index, limit=3) if index.item_id(it) not in o_ids]
        # food words that aren't the offer's ("আর ভাত" to "পরোটা নেবেন, নাকি নান?") — or food this menu doesn't have
        # ("আর একটা বোরহানি" to "একটা চা নেবেন?" once added the tea): a new request, never a yes to the offer
        choice_words = " ".join(str(ch.get("label") or "") for ch in o_info.get("choices") or [] if isinstance(ch, dict))
        new_food = [w for w in _new_words(transcript, index, o_ids) if w not in choice_words]
        own_names = choice_words + " " + " ".join(str(index.by_id[i].get("name") or "") for i in o_ids if i in index.by_id)
        if not new_food and _food_word_said(transcript, own_names):
            new_food = ["?"]
        if new_food and not named_other:
            named_other = [{"name": " ".join(new_food)}]
        o_close = (("তাহলে অর্ডারটা কনফার্ম করব?" if bn else "Shall I confirm your order then?")
                   if o_info.get("moment") == "wrap_up"
                   else ("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn else "Anything else, or shall I confirm your order?"))
        said_yes = co.says_yes(transcript) or is_affirmative(transcript) or _YES_START.search(transcript)
        said_no = short_no or upsell_engine._NO.search(transcript) or is_decline(transcript)
        choices = [ch for ch in o_info.get("choices") or [] if isinstance(ch, dict) and ch.get("items")]
        # (only a plain answer — "নান", "দুটো পরোটা": a whole order naming other dishes too ("একটা আফগানি কাবাব দাও,
        # সাথে দুটো পরোটা দাও") goes the usual way, every dish and every number in it — it once added just 1 পরোটা)
        plain_answer = (not named_other or len(transcript.split()) <= 3) and not new_food  # ("মাছ", "গার্লিক নান দিন"; not "নান আর ভাত")
        if choices and not said_no and plain_answer and not _SAYS_CONFIRM.search(transcript):
            # "সাথে পরোটা নেবেন, নাকি নান?" → "নান": one naan → added; several → "কোন নান দেব — …?"; "হ্যাঁ" → which?
            picked = next((ch for ch in choices if re.search(str(ch.get("match") or "(?!)"), transcript, re.I)), None)
            if picked:
                return _offer_choice(picked, o_info)
            if said_yes and not named_other:
                on_yes = o_info.get("on_yes") if isinstance(o_info.get("on_yes"), dict) else None
                if on_yes:  # "সাথে ভর্তা বা ভাজি কিছু নেবেন?" → "হ্যাঁ" → what there is, not the question again
                    _hold_choices(o_info, str(on_yes.get("text") or ""), list(on_yes.get("choices") or choices))
                    res = tray_done(str(on_yes.get("text") or ""), [], False, cart_rows, "offer_which", "other")
                    res["meta"]["suggestions"] = [_suggestion_row(index.by_id[i]) for ch in choices
                                                  for i in ch.get("items") or [] if i in index.by_id][:12]
                    return _with_buttons(res, _choice_buttons(choices))
                tstate["pending"] = offer_pending
                return _with_buttons(tray_done(str(o_info.get("text") or ""), [], False, cart_rows, "offer_which", "other"),
                                     _choice_buttons(choices))
        if said_yes and not named_other and o_ops and not _SAYS_CONFIRM.search(transcript):
            adds = [x for x in o_ops if x["op"] == "add"]
            if said_number and said_number > 0 and len(adds) == 1:
                adds[0]["quantity"] = said_number  # "হ্যাঁ, দুইটা"
            after = _tray.simulate(cart_rows, o_ops, False, index.by_id)
            done = offers.accepted_text(o_info, o_ops, lang)
            if isinstance(o_info.get("then"), dict):  # "…ভাত যোগ করলাম। ভাতের সাথে মাছ নেবেন, নাকি মাংস?"
                return _ask_next(o_info, done, o_ops, after)
            return tray_done((done + " " + o_close).strip(), o_ops, False, after, "offer_accepted")
        if (is_done_ordering(transcript) and not named_other and not _YES_START.search(transcript)
                and not (short_no or upsell_engine._NO.search(transcript) or is_decline(transcript))):
            # "কিছু লাগবে না" — no to the offer AND to anything more: counted as a no, then on to confirming (below)
            rstate.offer_declines += 0 if o_info.get("type") == "which" else 1  # ("কোন ভর্তা দেব?" is no upsell)
            profile.declined = list(dict.fromkeys(profile.declined + [i for i in o_ids if i not in cart_qty]))
            rstate.profile = profile.to_dict()
        adds = [x for x in o_ops if x["op"] == "add"]
        # "দুইটা গরুর লাল ভুনা" … "সাথে ভাত দেব?" → "না, একটা করেন": MAKE the dish one — not one rice
        if (said_number and said_number > 0 and not named_other and len(transcript.split()) <= 5
                and re.search(r"(?<![ঀ-৿])(করেন|করুন|করো|কর|করে দিন|করে দেন|করে দাও)(?![ঀ-৿])|\b(koren|koro|kore din|make it)\b",
                              transcript, re.I)
                and not _tray.MORE_WORDS.search(transcript)):
            target = next((r for r in reversed(cart_rows) if r["itemId"] not in o_ids and int(r["quantity"]) != said_number), None)
            if target is not None:
                rstate.offer_declines += 0 if o_info.get("type") == "which" else 1  # ("কোন ভর্তা দেব?" is no upsell)
                op = {"op": "set", "itemId": target["itemId"], "name": target["name"], "lineKey": target.get("key"),
                      "quantity": said_number}
                after = _tray.simulate(cart_rows, [op], False, index.by_id)
                nm = bangla_meal.said_name(index.by_id.get(target["itemId"]) or {"name": target["name"]})
                done = (f"ঠিক আছে, {nm} {said_number}টা করলাম।" if bn else f"Done — {said_number} × {nm}.")
                return tray_done((done + " " + o_close).strip(), [op], False, after, "offer_declined_qty_set")
        if (said_number and said_number > 0 and len(adds) == 1 and len(o_ops) == 1 and not named_other
                and len(transcript.split()) <= 4 and not _SAYS_CONFIRM.search(transcript)):
            # "না, দুইটা" / "দুইটা দেন" → the number is how many (like "হ্যাঁ, দুইটা")
            adds[0]["quantity"] = said_number
            after = _tray.simulate(cart_rows, o_ops, False, index.by_id)
            return tray_done((offers.accepted_text(o_info, o_ops, lang) + " " + o_close).strip(), o_ops, False, after,
                             "offer_accepted")
        if short_no or upsell_engine._NO.search(transcript) or (is_decline(transcript) and not named_other):
            rstate.offer_declines += 0 if o_info.get("type") == "which" else 1  # ("কোন ভর্তা দেব?" is no upsell)
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
        # the AI's reading: a question about time / the menu / the choice itself is not the answer
        not_an_answer = understood is not None and u_intent in (
            "wait_time", "recommend", "menu_overview", "see_menu", "dish_question", "small_talk", "service",
            "tray_review", "checkout")
        # "r ekta fries" while the burger's spice is asked: ANOTHER dish ("and one fries") — never the burger's
        # "Fries + soft drink" option
        if (re.match(r"\s*(আর|আরো|আরও|আরেকটা|r|ar|and|also|plus)\s", transcript, re.I)
                and (said_number or re.search(r"\b(ekta|ekti|duita|duto|duta|tinta|one|two|three)\b", transcript, re.I))
                and _new_words(transcript, index, held_ids)):
            not_an_answer = True
        if held and not not_an_answer and not _is_question_not_order(transcript):
            # the parts that name ANOTHER dish are a new order (read below, as usual) — the rest answers the held ones
            heard = transcript
            if others:
                segs = [x for x in _DISH_JOIN.split(transcript) if x.strip()]
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
                and len(transcript.split()) <= 5 and not _dishes_named(transcript, index, limit=1)):
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
    if rel and stage == "none" and last_change and not _dishes_named(transcript, index, limit=1):
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
    if _tray.TRAY_QUESTION.search(transcript) and stage == "none" and not _dishes_named(transcript, index, limit=1):
        if cart_rows:
            s_txt, s_total, s_count = _tray.summary(cart_rows)
            vat = _vat_hint(restaurant, lang)
            text = (f"আপনার ট্রেতে এখন {s_count}টা আইটেম: {s_txt} — মোট {_money(s_total)}{vat}। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?"
                    if bn else f"You have {s_count} items: {s_txt} — {_money(s_total)}{vat}. Anything else, or shall I confirm your order?")
        else:
            text = "আপনার ট্রে এখনো খালি — কী দেব বলুন?" if bn else "Your tray is empty so far — what can I get you?"
        return tray_done(text, [], False, cart_rows, "tray_review", "order_review")

    # (c2) "মোট কত হলো?" / "কত হলো?" — the tray's own sum, never the model's arithmetic (it once said ৳260 for ৳300);
    # "আর একটা ডাল দিলে কত হবে?" — that dish's price on top
    if (stage in ("none", "readback") and cart_rows and not tstate.get("pending") and _TRAY_TOTAL_Q.search(transcript)
            # ("total 4 ta coke koren" — make it four in all: an order, not a question about the bill)
            and (_IF_ADDED.search(transcript) or not (_orders_now(transcript) or _said_quantity(transcript)
                                                      or re.search(r"করেন|করুন|কর(?![ঀ-৿])|\bkoren\b|\bkoro\b|\bmake\b",
                                                                   transcript, re.I)))):
        s_txt, s_total, s_count = _tray.summary(cart_rows)
        vat = _vat_hint(restaurant, lang)
        extra = _dishes_named(transcript, index, limit=2) if _IF_ADDED.search(transcript) else []
        if len(extra) == 1:
            x = extra[0]
            n = _said_quantity(transcript) or 1
            p = menu_answers.lowest_price(x) * n
            text = (f"{n}টা {bangla_meal.said_name(x)} {_money(p)} — তাহলে মোট হবে {_money(s_total + p)}{vat}। দেব?" if bn
                    else f"{n} × {bangla_meal.said_name(x)} is {_money(p)} — that makes {_money(s_total + p)}{vat}. Shall I add it?")
            rstate.last_offered, rstate.last_offer_turn = [index.item_id(x)], rstate.turn + 1
            return tray_done(text, [], False, cart_rows, "total_if_added", "order_review")
        if not _dishes_named(transcript, index, limit=1):
            text = (f"এখন পর্যন্ত মোট {_money(s_total)}{vat} — {s_txt}। আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn
                    else f"So far that's {_money(s_total)}{vat} — {s_txt}. Anything else, or shall I confirm your order?")
            return tray_done(text, [], False, cart_rows, "tray_total", "order_review")

    # (d) wait times — "how long will it take?", "where's my food?", "what's quickest?" — answered from the
    # real numbers (dish prep times, the live kitchen queue, the guest's own orders), never guessed by the model.
    # Only for a plain time question: "add 2 kacchi, how long?" goes to the model with the same numbers.
    kitchen = ctx.get("kitchen") if isinstance(ctx.get("kitchen"), dict) else None
    cart_est = wtalk.cart_estimate(cart_rows, index.by_id, kitchen)
    time_q, quick_q = asks_time(transcript), asks_quickest(transcript)
    # ("রেস্টুরেন্ট কতক্ষণ খোলা?" asks the opening hours, not the kitchen's wait — it got "15 মিনিটের মতো লাগে")
    if ((time_q or quick_q) and stage == "none" and len(transcript.split()) <= 16 and not _orders_now(transcript)
            and not _OPEN_Q.search(transcript)):
        mentioned = _dishes_named(transcript, index)
        mine = (kitchen or {}).get("myOrders") or []
        about_dish = bool(mentioned) or bool(_ABOUT_A_DISH.search(transcript))
        w_text, w_note, w_rows, w_offer = "", "", [], []
        if mine and not about_dish and (PLACED_Q.search(transcript) or not cart_rows):
            w_text, w_note = wtalk.placed_order_reply(kitchen, lang) or "", "wait_placed_order"
            # "খাবার অনেক দেরি হচ্ছে" — a complaint first gets a sorry, then the time
            if w_text and re.search(r"দেরি|দেরী|অনেকক্ষণ|অনেক সময়|অনেক সময়|এখনো আসে নি|এখনো আসেনি|আসছে না|"
                                    r"\b(late|so long|taking (too )?long|still waiting|where is my)\b", transcript, re.I):
                w_text = ("দেরির জন্য দুঃখিত। " if bn else "Sorry for the wait. ") + w_text
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
    # "এটা আপনার মেনুতে?" — "this" with nothing it could mean (nothing on the screen or in the tray, no dish in the
    # waiter's last words, nothing just suggested) and no dish named → "please say it again" (it read out the specials)
    if (stage == "none" and _POINTING.search(transcript) and len(transcript.split()) <= 6
            and not shown_ids and not cart_rows and not mentioned_now and not kind_scope
            and not find_mentions(last_waiter, index, limit=1)
            and not (rstate.last_offered and rstate.turn - rstate.last_offer_turn <= 2)):
        rstate.turn += 1
        return tray_done(_SORRY_REPEAT["bn" if bn else "en"], [], False, cart_rows, "pointing_unclear", "other")

    # "আমি জানি কী অর্ডার করব" / "I know what to order" (a conversation starter on the home screen) → the waiter just
    # listens: "জি, বলুন — কী দেব?" — never a list of suggestions (it opened the suggestions sheet)
    if stage == "none" and _KNOWS_ORDER.search(transcript) and not mentioned_now:
        rstate.turn += 1
        return tray_done("জি, বলুন — কী দেব?" if bn else "Sure — what would you like?", [], False, cart_rows,
                         "knows_order", "other")

    # "আলুর পরোটা আছে?" — the menu has পরোটা but no আলুর পরোটা → say so, and offer the one there is (it answered
    # "হ্যাঁ, আলুর পরোটা আছে")
    # "ভর্তার মধ্যে কি কি আছে?" / "ভাজি আছে?" / "বাঁধা ভাজি আছে?" — the bhortas or bhajis as a kind, said the way a
    # Bengali waiter says them (it once listed ইলিশ কচু as a bhorta and said "ভাজি শেষ" for the one dish called ভাজি)
    side_ans = (bhorta_bhaji.answer(transcript, sorted(index.items, key=lambda it: index.position.get(index.item_id(it), 1 << 20)),
                                    index.item_id, orderable,
                                    _dishes_named(transcript, index, limit=3), lang, _suggestion_row,
                                    # (what this guest was just shown: "আর কি কি ভর্তা আছে?" is the others)
                                    seen=([i for i in rstate.thread_shown if i not in rstate.last_offered], list(rstate.last_offered))
                                    if rstate.turn - max(rstate.thread_turn, rstate.last_offer_turn) <= 3 else [],
                                    said_before=last_waiter,
                                    tray=[index.by_id[i] for i in cart_qty if i in index.by_id])
                if stage in ("none", "readback") and not tstate.get("pending") and not profile.allergies else None)
    other_kind = _not_this_version(transcript, index) if stage == "none" and not side_ans else None
    not_this_version = other_kind if AI_FIRST else None  # (checked against the model's cart changes below)
    if other_kind and AI_FIRST:
        asked_as, it = other_kind
        facts.append(f'"{asked_as}" is not on the menu; the nearest is {it.get("name")} '
                     f"({_money(it.get('price'))}) — offer it, don't add it unasked")
        other_kind = None
    if other_kind:
        asked_as, it = other_kind
        said = bangla_meal.said_name(it)
        text = (f"{asked_as} নেই, তবে {said} আছে — দেব?" if bn
                else f"We don't have {asked_as}, but we do have {said} — shall I add it?")
        res = tray_done(text, [], False, cart_rows, "version_missing", "other")
        res["meta"]["suggestions"] = [_suggestion_row(it)]
        res["meta"].setdefault("decision", {})["showSuggestionsModal"] = True
        return _with_buttons(res, [{"label": "হ্যাঁ, দিন", "say": f"একটা {said} দিন"}, {"label": "না", "say": "না"}] if bn
                             else [{"label": "Yes, add it", "say": f"one {said} please"}, {"label": "No", "say": "no"}])

    # "বিকেলে কি আছে?" / "এখন কি পাওয়া যাবে?" → what the restaurant set for that time (its service periods, its
    # category / dish hours) — never a guess from the dish names when the owner has said
    lt = re.search(r"(\d{1,2}):(\d{2})", str(ctx.get("localTime") or ""))
    # (not "ভালো কি খাওয়া যায় এখন?" — a pick, from what's orderable now; not "মানুষ / জায়গা আছে এখন?" — no food)
    # (also while the order waits for its yes — "সকালের খাবারে কি কি আছে?" then is a question, the model once answered it
    # with the tray's warnings)
    # "সকালের খাবারে কি বোয়াল মাছ পাবো?" / "রাতে মাছ পাবো?" — that dish (or kind) at that time, by the menu's hours: first
    at_time = (_dish_at_time(transcript, index, orderable, list((menu_snapshot or {}).get("periods") or []),
                             int(lt.group(1)) * 60 + int(lt.group(2)) if lt else None,
                             list((restaurant or {}).get("opening") or []), lang)
               if stage in ("none", "readback") and not tstate.get("pending") and not side_ans else None)
    period_menu = None if (at_time or side_ans or stage not in ("none", "readback") or _dishes_named(transcript, index, limit=1) or _orders_now(transcript)
                           or _ABOUT_MINE.search(transcript) or profile.allergies  # (an allergy → the model)
                           # (a plain "ভালো কি খাওয়া যায়?" is still what there is to eat NOW — the time first; a pick
                           # with a taste / audience / popularity in it is the recommender's)
                           or (re.search(r"ভালো|সেরা|বেস্ট|রেকমেন্ড|সাজেস্ট|জনপ্রিয়|পপুলার|\b(recommend|suggest|best|good|popular)\b",
                                         transcript, re.I)
                               and not (_EAT_ASK.search(transcript) and not kind_scope
                                        and not reco_format.taste_asked(transcript)
                                        and not reco_format.audience_asked(transcript)
                                        and not _POPULAR_Q.search(transcript)))
                           or re.search(r"মানুষ|লোক(?![ঀ-৿])|কেউ|ভিড়|ভীড়|জায়গা|জায়গা|সিট|টেবিল|\b(people|seat|table|space|room)s?\b",
                                        transcript, re.I)) else \
        _period_menu_reply(transcript, index, orderable, list((menu_snapshot or {}).get("periods") or []),
                           int(lt.group(1)) * 60 + int(lt.group(2)) if lt else None,
                           # ("সকালের নাস্তায় কি আছে?" — নাস্তা is the meal, not a kind: it once cut 12 breakfast dishes to
                           # পরোটা and ডিম ভাজি)
                           _named_kind_ids(re.sub(r"নাস্তা\S*|নাশতা\S*|\bbreakfast\b|\bnasta\S*", " ", transcript, flags=re.I), index)
                           if re.search(r"নাস্তা|নাশতা|\bbreakfast\b|\bnasta", transcript, re.I) else kind_scope, lang,
                           opening=list((restaurant or {}).get("opening") or []), in_tray=set(cart_qty))
    # "এখন ভালো কি আছে?" / "কিছু সাজেস্ট করেন" between two meals (only sweets and drinks on): when the food is — never
    # "দুপুরের খাবারে সরা দই, ডাবের পুডিং…" as the pick
    if not period_menu and not at_time and not side_ans and stage in ("none", "readback") and not kind_scope and lt \
            and not profile.allergies and not _orders_now(transcript) and not _dishes_named(transcript, index, limit=1) \
            and re.search(r"ভালো|সেরা|রেকমেন্ড|সাজেস্ট|(কি|কী) আছে|কিছু|খাব|খাওয়া|খাওয়া|খেতে|ক্ষুধা|খিদে|"
                          r"\b(recommend|suggest|eat|food|hungry)\b", transcript, re.I) \
            and not re.search(r"পান|ড্রিংক|(?<![ঀ-৿])চা(?![ঀ-৿])|কফি|মিষ্টি|ডেজার্ট|জুস|লাচ্ছি|\b(drink|coffee|tea|dessert|sweet|juice)",
                              transcript, re.I):
        live = [it for it in sorted(index.items, key=lambda it: index.position.get(index.item_id(it), 1 << 20))
                if not it.get("hidden") and it.get("status") in (None, "active")
                and not re.search(r"শেষ হয়ে গেছে|sold out", str(it.get("unavailableReason") or ""), re.I)]
        period_menu = _between_meals(index, orderable, list((menu_snapshot or {}).get("periods") or []),
                                     int(lt.group(1)) * 60 + int(lt.group(2)), bn, live)
    if AI_FIRST:
        if period_menu:
            facts.append("What is served at the time asked (from the restaurant's own hours): " + period_menu[0])
        period_menu = None
    if period_menu:
        text, rows, note = period_menu
        if stage == "readback":
            ck = {**ck, "stage": "none"}  # still choosing: the read-back is asked again when they're done
        m = _base_meta(language=lang, intent="suggestions" if rows else "menu", topic="restaurant_info", suggestions=rows,
                       decision={"showSuggestionsModal": bool(rows), "showUpsellTray": False}, notes=note, **ids)
        rstate.turn += 1
        if rows:
            rstate.last_offered, rstate.last_offer_turn = [r["itemId"] for r in rows], rstate.turn
        rstate.profile = profile.to_dict()
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, [note]
        if bn:
            m["voiceReplyText"] = text
        print(f"[brain] {note} → {text[:120]}")
        return {"replyText": text, "meta": m}

    # "আবার বলেন তো" / "কী বললেন?" / "say that again" → the same words again (the model once answered something new)
    said_before = next((m_.get("content") or "" for m_ in reversed(history or []) if m_.get("role") == "assistant"), "")
    if said_before and len(transcript.split()) <= 6 and _SAY_AGAIN.search(transcript):
        rstate.turn += 1
        return tray_done(said_before, [], False, cart_rows, "said_again", "other")

    # price / "is there X?" / a dish we don't have / the sections — from the menu itself, never guessed (it once said
    # "বিফ তেহারি আজকে পাওয়া যাচ্ছে না" for a dish that isn't on the menu, and "সবচেয়ে দামি" the wrong burger)
    menu_ans = (_menu_answer(transcript, index, orderable, kind_scope, recent, lang,
                             ok=lambda x: not clash(x) and not violations(x, profile),
                             shown=[str(x) for x in (ctx.get("shownItems") or []) if str(x) in index.by_id] or (
                                 rstate.last_offered if rstate.turn - rstate.last_offer_turn <= 2 else []))
                if stage in ("none", "readback") and not tstate.get("pending") and not profile.allergies else None)
    menu_ans = side_ans or at_time or menu_ans  # (the ভর্তা / ভাজি and dish-at-a-time answers, from above)
    if AI_FIRST:
        if menu_ans:
            facts.append(menu_ans[0])
        menu_ans = None
    if menu_ans:
        text, rows, note, offer_ids = menu_ans
        if stage == "readback":
            ck = {**ck, "stage": "none"}
        m = _base_meta(language=lang, intent="menu" if note.startswith("price") or not rows else "suggestions",
                       topic="restaurant_info", suggestions=rows,
                       decision={"showSuggestionsModal": bool(rows) and not note.startswith(("price", "have")),
                                 "showUpsellTray": False}, notes=note, **ids)
        if note in ("unavailable_named", "unavailable_kind", "not_on_menu", "which_one") and rows:  # tap buttons
            n_said = next((q for q in (_said_quantity(w) for w in transcript.split()) if q), 1)
            pre = (f"{n_said}টা " if bn else f"{n_said} × ") if note == "which_one" and n_said > 1 else ""
            m["decision"]["chooseOptions"] = [{"label": r["title"], "say": (pre + r["title"] + " দিন") if bn
                                               else (pre + r["title"] + ", please"), "itemId": r["itemId"]}
                                              for r in rows[:(6 if note == "which_one" else 3)]]
            if note == "which_one":
                m["decision"]["showSuggestionsModal"] = False
        if note == "confirm_heard":
            m["decision"]["showSuggestionsModal"] = False
            m["decision"]["chooseOptions"] = ([{"label": "হ্যাঁ, দিন", "say": "হ্যাঁ"}, {"label": "না, থাক", "say": "না"}] if bn
                                              else [{"label": "Yes, add it", "say": "yes"}, {"label": "No, thanks", "say": "no"}])
        rstate.turn += 1
        if offer_ids or rows:
            rstate.last_offered, rstate.last_offer_turn = (offer_ids or [r["itemId"] for r in rows]), rstate.turn
        if note == "side_kind_more":
            rstate.continuing = True  # (the same thread: a third "আর কি কি ভর্তা?" never comes back to the first ones)
        if note == "side_kind_which" and offer_ids:
            # "কোন ভর্তা দেব?" holds its answers like an offer: "আলু" / "আলু ভর্তা" adds it (as many as were asked for),
            # "ভাত" (when it asked "নাকি ভাত বলেছিলেন?") orders rice, "না" leaves it
            choices = bhorta_bhaji.dish_choices([index.by_id[i] for i in offer_ids if i in index.by_id], index.item_id)
            if "নাকি ভাত" in text:
                rice = [it for it in index.items if bangla_meal.role(it) == "rice" and orderable.get(index.item_id(it), True)]
                if rice:
                    choices.append({"label": "ভাত", "match": r"(?<![ঀ-৿])ভাত|\b(rice|bhat|vaat)\b",
                                    "items": [index.item_id(it) for it in rice]})
            tstate["pending"] = {"kind": "offer", "ops": [], "clear": False, "offer": {
                "type": "which", "moment": "first_add", "text": text, "choices": choices, "then": None,
                "item_ids": [i for ch in choices for i in ch["items"]], "qty": _said_quantity(transcript) or 1}}
            # (buttons: ভাত first when it's asked, then the dishes)
            m["decision"]["chooseOptions"] = (
                [{"label": ch["label"], "say": ch["label"]} for ch in choices if ch["label"] == "ভাত"]
                + [{"label": ch["label"], "say": ch["label"]} for ch in choices if ch["label"] != "ভাত"][:5])
        rstate.profile = profile.to_dict()
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, [note]
        m["mentionedItems"] = [{"itemId": r["itemId"], "name": r.get("title")} for r in rows[:1]]
        if bn:
            m["voiceReplyText"] = text
        print(f"[brain] {note} → {text[:120]}")
        return {"replyText": text, "meta": m}

    words_menu = bool(_SEE_MENU.search(transcript) or asks_overview(transcript))
    if (
        stage == "none"
        # the AI's reading decides ("মিনি স্লাইডার ট্রিও এর মধ্যে কি কি আছে?" is a dish question, though it has "কি কি
        # আছে"); the word patterns only when there's no reading — or when the reading says "recommend" with nothing
        # to recommend by (no kind, taste, audience or count) while the words plainly ask for the menu ("আপনার মেনু
        # দেখতে চাই", "কি আছে তোমাদের খাবার?" were answered with specials)
        and ((u_intent in ("see_menu", "menu_overview")
              or (u_intent in ("recommend", "other") and words_menu
                  and not any((understood or {}).get(k) for k in ("kind", "taste", "audience", "count"))))
             if understood is not None else words_menu)
        and not _WANTS_A_PICK.search(transcript)
        and not (_CHEAPER.search(transcript) or _CMP_CHEAP.search(transcript))  # "সবচেয়ে কমদামি খাবার কি আছে?" — a pick
        and not kind_scope and not kind_items(transcript, index) and not missing_kinds(transcript, index)
        # ("মেনু কার্ডটা দাও" asks for the menu, not a dish — "দাও" alone isn't an order)
        and not _dishes_named(transcript, index, limit=1)
        and (not _orders_now(transcript) or bool(_SEE_MENU.search(transcript)))
        and not _ABOUT_MINE.search(transcript)
        and not re.search(r"নতুন|\bnew\b|\bnotun\b", transcript, re.I)
        and not reco_format.taste_asked(transcript)
        and not period_asked  # "বিকেলের মেনুতে কী আছে?" → suggestions for the afternoon
        and extract_prefs(transcript).summary() == "nothing specific yet"
        and not (AI_FIRST and facts)  # (a question the facts answer — the AI answers it)
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
    # "আমার বাদামে এলার্জি আছে" said on its own — noted, honestly (the model once listed "বাদাম স্যালাড" as a dish to
    # avoid, on a menu without one): the ranking keeps those dishes out from now on; the kitchen confirms
    said_allergy = extract_prefs(transcript).allergies
    if (not small and stage == "none" and not tstate.get("pending") and said_allergy and not _QUESTION.search(transcript)
            and not _orders_now(transcript) and not _names_food(transcript, index) and len(transcript.split()) <= 8
            and not asks_for_recommendation(transcript) and not _WANTS_A_PICK.search(transcript)
            and not re.search(r"সাজেস্ট|রেকমেন্ড|কি খা|কী খা|খেতে পারি|\b(recommend|suggest|what can)\b", transcript, re.I)):
        word = next((m.group(0) for m in [re.search(r"বাদাম|কাজু|চিনাবাদাম|চিংড়ি|চিংড়ি|দুধ|ডিম|গ্লুটেন|গম|তিল|মাছ|সয়া|"
                                                    r"\b(nuts?|peanuts?|shellfish|prawns?|shrimp|dairy|milk|eggs?|gluten|"
                                                    r"wheat|sesame|fish|soy)\b", transcript, re.I)] if m), "")
        # ("বাদামে", "দুধে", but "চিংড়িতে")
        at_word = (word + ("তে" if re.search(r"[িীুূেোা]$", word) else "ে")) if re.search(r"[ঀ-৿]", word) else word
        small = ((f"ঠিক আছে, আপনার {at_word + ' ' if at_word else ''}এলার্জি — মনে রাখলাম। যেসব খাবারে এটা থাকার কথা মেনুতে "
                  "লেখা আছে, সেগুলো আমি সাজেস্ট করব না; তবে রান্নাঘর থেকে নিশ্চিত হতে অর্ডারের সময় স্টাফকে অবশ্যই "
                  "জানাবেন। কী খেতে চান?") if bn else
                 (f"Got it — a {word + ' ' if word else ''}allergy. I won't suggest dishes the menu lists it in, but please "
                  "tell the staff when you order so the kitchen can confirm. What would you like?"))
    # "আর কিছু না" right after the order went in — a goodbye, not "আপনার ট্রে এখনো খালি"
    if (not small and not cart_rows and stage == "none" and not tstate.get("pending") and is_done_ordering(transcript)
            and (ck.get("sig") or (ctx.get("kitchen") or {}).get("myOrders"))):
        small = ("ঠিক আছে! আপনার অর্ডার রান্নাঘরে চলে গেছে — আর কিছু লাগলে যেকোনো সময় বলবেন।" if bn
                 else "Great — your order is with the kitchen. Just tell me if you need anything else.")
    # "কাল সকালে খোলা?" / "আজ রাতে কয়টা পর্যন্ত খোলা?" — from the opening hours ("কাল" is tomorrow, not কালা ভুনা)
    if not small and stage in ("none", "readback") and not tstate.get("pending") and not _dishes_named(transcript, index, limit=1, exact_only=True):
        small = _open_answer(transcript, list((restaurant or {}).get("opening") or []), str((restaurant or {}).get("hours") or ""),
                             int(lt.group(1)) * 60 + int(lt.group(2)) if lt else None, lang)
    # "বিকাশে পেমেন্ট করা যাবে?" / "কার্ড নেন?" — the waiter isn't told how the restaurant takes payment: it says so
    # (it once answered "হ্যাঁ, আমরা কার্ড নেব" and pitched Hot Wings, and invented "কাউন্টারে গিয়ে পেমেন্ট")
    if (not small and stage == "none" and not tstate.get("pending") and _PAY_Q.search(transcript or "")
            and not _orders_now(transcript) and not _names_food(transcript, index)):
        small = (("পেমেন্টের ব্যাপারে আমি নিশ্চিত বলতে পারছি না — অর্ডারের সময় রেস্টুরেন্ট জানিয়ে দেবে।" if online else
                  "পেমেন্টের ব্যাপারে আমি নিশ্চিত বলতে পারছি না — বিল দেওয়ার সময় স্টাফ জানিয়ে দেবেন। দরকার হলে উপরে "
                  "বাঁ দিকের ঘণ্টার বোতাম চাপুন।") if bn else
                 ("I can't say for sure how payment works — the restaurant will tell you when you order." if online else
                  "I can't say for sure which payments are taken — the staff will tell you at the bill. Tap the bell at "
                  "the top left if you'd like to ask now."))
    # a plain "thanks" (after the order, after an answer) → "you're welcome" — no dish pitched (it once answered
    # "thanks" with "I can recommend our Hot Wings…"); with food in the tray it may mean "done", so the usual flow
    if not small and stage == "none" and not cart_rows and _THANKS.match((transcript or "").strip()):
        small = ("আপনাকেও ধন্যবাদ! কিছু লাগলে বলবেন।" if bn else "You're welcome! Just tell me if you need anything.")
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

    # (f2) "মাছের মধ্যে কি কি আছে?" / "কি কি কাবাব আছে?" — a LIST of a kind: every one of them, in menu order (not
    # "here's our menu", and not three picks — the guest asked what there is). "মাছ পটিকিয়া" — the kind and a word
    # that's no dish (speech-to-text) → "which one?" with the same list, never a guess.
    if stage == "none" and kind_scope and not owner_pick and not _a_dish_not_kind(transcript, index, kind_scope) \
            and not _orders_now(transcript) and not _WANTS_A_PICK.search(transcript) and not _PRICE_Q.search(transcript) \
            and not reco_format.taste_asked(transcript) and not reco_format.audience_asked(transcript) \
            and not _ABOUT_MINE.search(transcript) and not profile.allergies and not _CONTENTS_Q.search(transcript):
        listed = _kind_list_reply(transcript, index, orderable, kind_scope, lang,
                                  seen=([i for i in rstate.thread_shown if i not in rstate.last_offered], list(rstate.last_offered))
                                  if rstate.turn - max(rstate.thread_turn, rstate.last_offer_turn) <= 3 else [],
                                  said_before=last_waiter)
        if listed and AI_FIRST:
            facts.append(f"The full list of that kind on the menu: {listed[0]}")
            listed = None
        if listed:
            text, rows, note = listed
            if note == "kind_more":
                rstate.continuing = True  # (one thread: a third "আর কি কি…" never comes back to the first ones)
            m = _base_meta(language=lang, intent="suggestions", topic="recommendation", suggestions=rows,
                           decision={"showSuggestionsModal": True, "showUpsellTray": False}, notes=note, **ids)
            rstate.turn += 1
            rstate.last_offered, rstate.last_offer_turn = [r["itemId"] for r in rows], rstate.turn
            rstate.profile = profile.to_dict()
            m["checkout"], m["tray"] = ck, tstate
            m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, [note]
            if bn:
                m["voiceReplyText"] = text
            text = bread_with_kebabs(text, m, [index.by_id[r["itemId"]] for r in rows if r.get("itemId") in index.by_id])
            print(f"[brain] {note} → {text}")
            return {"replyText": text, "meta": m}

    # (g) a plain recommendation request gets the waiter's fixed shape (reco_format), filled with the ranked picks:
    #   a KIND  — "ঝাল কিছু আছে?", "স্যুপের মধ্যে ভালো কোনটা?", "স্পেশাল কী আছে?", "ভালো কি আছে?"
    #             → "{ঝাল} আইটেমের মধ্যে A, B অথবা C খুবই জনপ্রিয়, এছাড়াও আপনি D কিংবা E-ও নিতে পারেন।"
    #   WHO     — "বাচ্চাদের জন্য কী ভালো?" → "আপনার বাচ্চাদের জন্য A, B অথবা C নিতে পারেন, এছাড়াও D কিংবা E-ও…"
    # The dishes respect the time of day, availability and the guest (the ranking); star-marked ones lead only when
    # they are among them. Anything more (a budget, a head-count, an allergy, a dish named, "which of these") → model.
    # (not while the waiter's own question is open — "স্পাইসি কোনটা বেশি জনপ্রিয়?" after "6 or 10 pcs, which spice?"
    # is about THAT choice: the AI answers it, with the question in view — never a list of other dishes)
    # ("ঝাল কেমন?" right after "সরষে ইলিশের দাম কত?" is about the ইলিশ — never a list of spicy dishes)
    about_focus = bool(recent) and _about_the_dish(transcript, index)
    # "সাথে কি নেওয়া যায়?" / "What goes well with it?" — the partners of THAT dish (the one named, the last added, the
    # one being talked about), from what it is: rice and a bhorta with a bhuna, borhani and a roast with a kacchi…
    # (not with an order in the same breath — "একটা বার্গার দিন, সাথে কী ভালো যাবে?"; "সাথে কি নেব?" is no order)
    # (the order verb outside the ask: "বাটার নানের সাথে কি নেব?" is a question, not an order of naan)
    if stage == "none" and pairing.ASKS.search(transcript) and not (
            _orders_now(pairing.ASKS.sub(" ", transcript))
            and (_dishes_named(transcript, index, limit=1) or not _QUESTION.search(transcript))):
        named_now = _dishes_named(transcript, index, limit=2)
        list_word = ""
        # a KIND said ("কাচ্চির সাথে কি নেবো?", "কফির সাথে কি খাওয়া যায়?") → its first dish on the menu stands for it
        kind_first = sorted((index.by_id[i] for i in kind_scope if i in index.by_id and orderable.get(i, True)),
                            key=lambda x: index.position.get(index.item_id(x), 1 << 20))[:1] if not named_now else []
        if kind_first:
            # every food word said is that kind: "অনিয়ন রিংসের সাথে…" on a menu with no onion rings is not about the
            # Chicken Chili Onion
            _ph, kw = _asked_phrase(re.split(r"সাথে|সঙ্গে|দিয়ে|\bwith\b", transcript)[0], index)
            toks = set().union(*[_guest_tokens(w, _menu_rev(index)) for w in kw]) if kw else set()
            if any(not _guest_tokens(w, _menu_rev(index)) for w in kw):
                toks.add("?")  # a word we don't know ("রিংসের") — not that kind
            theirs = set().union(*[_name_tokens(str(x.get("name") or "")) | _name_tokens(kind_text(x))
                                   for x in (index.by_id[i] for i in kind_scope if i in index.by_id)])
            if toks - theirs:
                kind_first = []
        anchor = ((named_now or kind_first)[0] if (named_now or kind_first)
                  else pairing.anchor(index, [r["itemId"] for r in cart_rows], [], recent))
        if anchor is None and not cart_rows and rstate.last_list and rstate.turn - rstate.last_list_turn <= 1:
            # "কাবাব কি কি আছে?" → the kebabs → "সাথে কি নেব?": what goes with those (they're one kind: the first stands in)
            shown_list = [index.by_id[i] for i in rstate.last_list if i in index.by_id]
            fams = [menu_answers.families(x) for x in shown_list]
            if shown_list and fams and set.intersection(*fams):
                anchor = pairing.anchor(index, [], [shown_list[0]], [])
                prev_ask = next((str(m.get("content") or "") for m in reversed(history or []) if m.get("role") == "user"), "")
                list_word = _kind_word(prev_ask, index, set(rstate.last_list)) if anchor is not None else ""
        # ("ক্লাসিক ফ্রাইজের সাথে কী খাওয়া যায়?" where there are no fries: about THAT, never the tray's kebab)
        if not named_now and not kind_first and _food_word_said(transcript):
            anchor = None
        if anchor is not None:
            shape, groups = pairing.partners(anchor, index, orderable, list(cart_qty), lambda x: not clash(x) and not
                                             violations(x, profile))
            text = pairing.reply(anchor, shape, groups, lang) if groups else ""
            if text and list_word:  # (the kind asked about stands for the list: "কাবাব Naan বা Luchi দিয়ে…")
                text = text.replace(bangla_meal.said_name(anchor), list_word, 1)
            if text:
                rows = [_suggestion_row(x) for _k, xs in groups for x in xs]
                m = _base_meta(language=lang, intent="suggestions", topic="recommendation", suggestions=rows,
                               decision={"showSuggestionsModal": True, "showUpsellTray": False}, notes="pairing", **ids)
                rstate.turn += 1
                rstate.last_offered, rstate.last_offer_turn = [r["itemId"] for r in rows], rstate.turn
                rstate.recent = list(dict.fromkeys(rstate.last_offered + rstate.recent))[:12]
                rstate.profile = profile.to_dict()
                m["checkout"], m["tray"] = ck, tstate
                m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), "complement", ["pairing"]
                m["mentionedItems"] = [{"itemId": index.item_id(anchor), "name": anchor.get("name")}]
                if bn:
                    m["voiceReplyText"] = text
                print(f"[brain] pairing for {anchor.get('name')} ({shape}) → {text}")
                return {"replyText": text, "meta": m}
    # the next suggestion ask after a list — more / narrower / "which one?" (followups.py)
    fixed = None
    if not (tstate.get("pending") or about_focus):
        fixed = _suggest_more(
            transcript, index=index, orderable=orderable, kinds=kinds, profile=profile, stats=stats, rstate=rstate,
            kind_scope=kind_scope, lang=lang, stage=stage, in_tray=in_tray, history=history,
            cart_ids=list(cart_qty) + mentioned_now) or _fixed_reco(
            transcript, index=index, orderable=orderable, kinds=kinds, profile=profile, stats=stats, rstate=rstate,
            kind_scope=kind_scope, lang=lang, stage=stage, mode=mode, about_shown=about_shown,
            cart_ids=list(cart_qty) + mentioned_now, in_tray=in_tray, understood=understood, owner_pick=owner_pick,
        )
    if AI_FIRST:
        fixed = None
    if fixed:
        text, rows, note = fixed
        m = _base_meta(language=lang, intent="suggestions", topic="recommendation", suggestions=rows,
                       decision={"showSuggestionsModal": True, "showUpsellTray": False}, notes=note, **ids)
        rstate.turn += 1
        rstate.last_offered, rstate.last_offer_turn = [r["itemId"] for r in rows], rstate.turn
        if note == "thread_pick":  # ("হ্যাঁ" is yes to the pick; the list it came from stays the thread's)
            rstate.last_offered = [rows[0]["itemId"]]
            m["highlight"] = [rows[0]["itemId"]]
            rstate.continuing = True
        rstate.recent = list(dict.fromkeys(rstate.last_offered + rstate.recent))[:12]
        rstate.profile = profile.to_dict()
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), "full", [note]
        if bn:
            names = sorted({r["title"] for r in rows} | {re.sub(r"\s*\(.*?\)", "", r["title"]).strip() for r in rows},
                           key=len, reverse=True)
            m["voiceReplyText"] = re.sub("|".join(re.escape(n) for n in names), lambda mm: to_bangla_script(mm.group(0)), text)
        text = bread_with_kebabs(text, m, [index.by_id[r["itemId"]] for r in rows if r.get("itemId") in index.by_id])
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
            and not _dishes_named(transcript, index, limit=1) and said_number is None):
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

    # online: "I'll pick it up" / "deliver it" → the form's toggle follows (no model). Only the address question
    # changes with it — and only what's still missing is named.
    said_f = co.fulfillment_from_text(transcript) if online else None
    if said_f and len(transcript.split()) <= 8 and not _dishes_named(transcript, index, limit=1):
        text = co.fulfillment_set_text(said_f, lang)
        flags: Dict[str, Any] = {"fulfillment": said_f}
        if stage == "details":
            text += " " + co.online_details_text(missing_for(said_f), lang)
            flags.update({"showCheckout": True, "askDetails": True, "checkoutStage": "details"})
        elif cart_rows:
            text += " " + ("আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" if bn else "Anything else, or shall I confirm your order?")
        m = _base_meta(language=lang, intent="order", topic="confirm_order",
                       decision={"showSuggestionsModal": False, "showUpsellTray": False, **flags},
                       notes="fulfillment_set", **ids)
        m["checkout"], m["tray"] = ck, tstate
        m["reco"], m["recoMode"], m["guards"] = rstate.to_dict(), mode, ["fulfillment_set"]
        if bn:
            m["voiceReplyText"] = text
        return {"replyText": text, "meta": m}

    # Fast, deterministic checkout moves (no model): "yes" to the read-back, "wait", a table number,
    # "place my order" / "that's all" with nothing else in the sentence.
    # A "না" to "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" is "nothing more" — on to confirming (not "don't place it")
    closing_no = (stage == "none" and bool(cart_rows) and upsell_engine.ends_with_closing(last_waiter)
                  and (bool(upsell_engine._NO.search(transcript)) or is_done_ordering(transcript)))
    action, why = co.decide(
        text="আর কিছু লাগবে না" if closing_no else transcript, stage=stage, stored_signature=str(ck.get("sig") or ""),
        signature_now=sig_now, cart_nonempty=bool(cart_rows), table=ck_table, llm_checkout="none",
        asked_to_confirm=asked_confirm and not closing_no,
        cart_changed_this_turn=False, cleared=False, defer_done=mode == "last_call",
        list_on_screen=bool(shown_ids), direct_pending=bool(ck.get("direct")),
    )
    words = len(transcript.split())
    # we asked "which table?" and heard no number ("মারুক") → ask again, keep waiting — never let the model make
    # a table out of it ("টেবিল মারুক…"). A real question at this point ("what's the wifi?") is still answered.
    if (stage == "table" and action == "stay" and not table and words <= 4 and "?" not in transcript
            and not _dishes_named(transcript, index, limit=1) and not co.wants_to_hold(transcript)):
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
            text = (f"অর্ডার দেওয়ার আগে একটা কথা: {names} এখন পাওয়া যাচ্ছে না{_reason_bn(gone)}। ওটা বাদ দিয়ে দেব?"
                    if bn else f"Before I place it: {names} can't be ordered right now ({gone[0]['reason']}). Shall I remove it?")
            tstate["pending"]["question"] = text
            return tray_done(text, [], False, cart_rows, "unavailable_before_checkout", "other")
    if action == "empty" and not cart_rows and stage == "none":
        about = [i for i in rstate.last_offered if i in index.by_id][:2] if rstate.turn - rstate.last_offer_turn <= 2 else []
        if len(about) != 1 and recent:
            about = [index.item_id(recent[0])]
        # (never a dish that can't be ordered now: "আপনার ট্রে এখনো খালি — মাটন কাচ্চি (শুক্রবার) দেব?" on a Tuesday)
        about = [i for i in about if orderable.get(i, True)]
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
                                             eta_hint=wtalk.eta_hint(cart_est, lang) if kitchen else "", online=online,
                                             contact_missing=contact_missing)
        print(f"[brain] checkout fast path: {action} ({why}) table={table}")
        text = text or co.held_text(lang)
        if action in ("readback", "ask_table") and is_done_ordering(transcript) and last_waiter.rstrip().endswith("?"):
            # "আর কিছু লাগবে, নাকি অর্ডার কনফার্ম করব?" / "…দেব?" → "কিছু লাগবে না" → it follows on from that question
            text = (("ঠিক আছে, তাহলে " + text.replace("অর্ডারটা দিয়ে দেব?", "অর্ডারটা কনফার্ম করব?")) if bn
                    else "Alright — " + text)
        meta = _base_meta(
            language=lang, intent="order", topic="confirm_order" if action != "hold" else "order_review",
            items=_items_payload(index, cart_qty) if action == "place" and not online else [],
            decision={"showSuggestionsModal": False, "showUpsellTray": False, **flags},
            notes=f"checkout_{action}", **ids,
        )
        meta["checkout"] = new_ck
        meta["tray"] = tstate
        if action == "place" and not online:  # (online: the form places it)
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
    # ("ফিরনি আছে — দেব?" → "দুইটা দেন": a number and nothing else is a yes, that many — it once doubled the kacchi)
    qty_yes = bool(said_number and said_number > 0 and len(transcript.split()) <= 4 and not _QUESTION.search(transcript)
                   and not _new_words(transcript, index) and not _food_word_said(transcript)
                   and not _NOT_YET.search(transcript) and not is_decline(transcript))
    if (
        offered_one and stage == "none" and not asked_confirm and (is_affirmative(transcript) or qty_yes)
        and not _dishes_named(transcript, index, limit=1)
    ):
        it = index.by_id[rstate.last_offered[0]]
        yes_ops, yes_problems = _validate_ops(
            [{"op": "add", "item": index.item_id(it), "quantity": said_number if qty_yes else 1}], index, dict(cart_qty),
            orderable, None, guest_words,
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
        {"role": "system", "content": PLAYBOOK_AI_FIRST if AI_FIRST else PLAYBOOK},
        {"role": "system", "content": _knowledge_block(index, {**(restaurant or {}), "bell": bell} if restaurant else None)},
    ]
    # (the knowledge packs go with the AI-first flow only, for now: with it off, the waiter is exactly today's)
    standing_knowledge = knowledge.standing(cuisines, lang) if AI_FIRST else ""
    if standing_knowledge:
        messages.append({"role": "system", "content": "# WAITER KNOWLEDGE (always)\n" + standing_knowledge})
    if AI_FIRST:
        messages.append({"role": "system", "content": FOODS_NAMED_FIELD})
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
                meal_kinds=kinds,
                knowledge_now=knowledge.for_turn(cuisines, lang, f"{transcript}\n{last_waiter}") if AI_FIRST else "",
                checked_facts=facts,
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
    # "…Mint Lemonade অথবা Coca-Cola — কোনটা দেব?" → "কোক": the answer to "which one?" is that one, ordered (it once got
    # a lecture on Coke cans, and then "your tray is empty")
    if (not clean_ops and stage == "none" and not tstate.get("pending") and _WHICH_ASKED.search(last_waiter or "")
            and len(transcript.split()) <= 4 and not _QUESTION.search(transcript) and not is_decline(transcript)
            and not _NOT_YET.search(transcript)):
        clean_ops = _clean_order(f"{transcript} দিন", index, orderable, dict(cart_qty))
        if clean_ops:
            guards.append("picked_from_list")
    # "স্মল না, বড়টা দাও" — a size swap on one tray line, done exactly (the model once claimed it and did nothing)
    if not clean_ops and stage == "none" and not tstate.get("pending") and means("change_order", "order"):
        clean_ops = _size_swap(transcript, index, orderable, cart_rows)
    # "ফ্রেঞ্চ ফ্রাই ডাবল করে দিন" — twice as many of that tray line, done exactly
    if not clean_ops and stage == "none" and not tstate.get("pending") and means("change_order", "order"):
        clean_ops = _double_it(transcript, index, cart_rows)
    # "কোক বাদ" / "ফ্রাইড রাইস টা এগ ফ্রাইড রাইস করে দেন" / "দুইটা করে দেন" / "ওগুলোই দেন" — done exactly, no model
    if not clean_ops and stage == "none" and not tstate.get("pending"):
        clean_ops = (_take_out(transcript, index, cart_rows) or _swap_dish(transcript, index, orderable, cart_rows)
                     or _each_to(transcript, index, cart_rows)
                     or _take_all_listed(transcript, index, orderable, list(just_suggested), dict(cart_qty), last_waiter))
    try:
        if clean_ops:
            print(f"[brain] clean order → no model:{[(o['op'], o['item'], o.get('quantity')) for o in clean_ops]}")
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
        if AI_FIRST and not clean_ops:
            # never a food or drink this menu doesn't have, unless saying so ("we don't have Fanta")
            unknown = _unknown_foods(obj.get("foodsNamed"), index)
            if unknown:
                issues.append(f"No dish on the MENU has the name {', '.join(unknown)}. If you meant a MENU dish, write "
                              "its exact MENU name. If it isn't on the MENU, don't offer, list or describe it — if the "
                              "guest asked for it, say plainly it isn't on the menu and offer the closest dish that IS.")
            # the guest named a version the menu doesn't have ("আলু পরোটা") → never the plain dish added in its place
            if not_this_version:
                asked_as, plain = not_this_version
                if any(isinstance(o, dict) and index.resolve(o.get("item"), o.get("name")) is plain
                       and str(o.get("op") or "") == "add" for o in obj.get("cartOps") or []):
                    issues.append(f'The guest asked for "{asked_as}", which is not on the MENU — don\'t add '
                                  f"{plain.get('name')} in its place. Say \"{asked_as}\" isn't on the menu and offer "
                                  f"{plain.get('name')}; add it only when the guest says yes.")
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
        # …and the other way: "ষোল আনা স্পেশাল কাবাব এখন পাওয়া যাচ্ছে" at lunch, when the kebabs are on from the evening
        wrongly_in = [
            it for it in find_mentions(first_reply, index, limit=12)
            if not orderable.get(index.item_id(it), True) and any(
                _reply_mentions(c, str(it.get("name") or "")) and _SAYS_AVAILABLE.search(c) and not _SAYS_UNAVAILABLE.search(c)
                # ("বিকেল ৫টা থেকে পাওয়া যায়", "শুধু শুক্রবারে" — saying WHEN is right)
                and not re.search(r"(?<![ঀ-৿])(না|নেই|নয়)(?![ঀ-৿])|\bnot\b|n'?t\b|থেকে|পরে|শুধু|বারে|"
                                  r"\b(from|after|only|until)\b", c, re.I)
                for c in re.split(r"(?<=[.!?।])\s+", first_reply))
        ]
        if wrongly_in:
            issues.append(
                ", ".join(f"{it.get('name')} is NOT ORDERABLE NOW ({it.get('unavailableReason') or 'not served at this time'})"
                          for it in wrongly_in)
                + " — never say it's available now; say when it is, and offer what can be ordered now."
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
        # …answering what they ASKED: cheapest / priciest from the prices, mildest / hottest from the heat, "best" from
        # the ranking — and when we can't tell from the facts, no invented answer: the list, and "which one?"
        # (it once said "এগুলোর মধ্যে Hot Wings সবচেয়ে ভালো হবে" to "সবচেয়ে সস্তা কোনটা?")
        guards.append("compare_answer_replaced")
        crit = _compare_criterion(transcript)
        clean = lambda it: re.sub(r"\s*\(.*?\)", "", str(it.get("name") or "")).strip()  # noqa: E731
        pick_it: Optional[Dict[str, Any]] = None
        tied_refs: List[Any] = []  # equal heat: all of them are the answer
        if crit in ("cheap", "pricey"):
            prices = [(_lowest_price(it), it) for it in shown]
            pick_it = (min if crit == "cheap" else max)(prices, key=lambda x: x[0])[1]
            p = _money(_lowest_price(pick_it))
            reply = (f"এগুলোর মধ্যে সবচেয়ে {'কম' if crit == 'cheap' else 'বেশি'} দামের {clean(pick_it)} — {p}। দেব?"
                     if lang == "bn" else
                     f"Of these, the {clean(pick_it)} is the {'most affordable' if crit == 'cheap' else 'priciest'} ({p}). Shall I add it?")
        elif crit in ("mild", "hot"):
            heat = {"spicy": 3, "likely spicy": 2, "": 1, "likely mild": 0}
            scored = [(heat.get(dish_facts(it).get("heat") or "", 1), it) for it in shown]
            if len({s for s, _ in scored}) > 1:
                edge = (min if crit == "mild" else max)(s for s, _ in scored)
                tied = [it for s, it in scored if s == edge]  # equal heat → name them all, never pick one at random
                pick_it = tied[0]
                if len(tied) == 1:
                    reply = (f"এগুলোর মধ্যে {clean(pick_it)} সবচেয়ে {'কম' if crit == 'mild' else 'বেশি'} ঝাল। দেব?" if lang == "bn"
                             else f"Of these, the {clean(pick_it)} is the {'mildest' if crit == 'mild' else 'spiciest'}. Shall I add it?")
                else:
                    both = (" আর " if lang == "bn" else " and ").join(clean(it) for it in tied[:3])
                    reply = (f"এগুলোর মধ্যে {both} {'কম' if crit == 'mild' else 'বেশি'} ঝাল — কোনটা দেব?" if lang == "bn"
                             else f"Of these, the {both} are the {'mildest' if crit == 'mild' else 'spiciest'} — which one shall I add?")
                    tied_refs = [index.ref(it) for it in tied]
        elif crit == "best":
            rank_of = {index.item_id(p.item): n for n, p in enumerate(picks)}
            pick_it = min(shown, key=lambda it: rank_of.get(index.item_id(it), 99))
            why = next((", ".join(p.reasons[:1]) for p in picks if p.item is pick_it), "")
            reply = (f"এগুলোর মধ্যে {clean(pick_it)} সবচেয়ে ভালো হবে। দেব?" if lang == "bn"
                     else f"Of these, I'd go for the {clean(pick_it)}" + (f" — {why}" if why else "") + ". Shall I add it?")
        if pick_it is None:
            names = [clean(it) for it in shown[:4]]
            listed = (", ".join(names[:-1]) + (" আর " if lang == "bn" else " and ") + names[-1]) if len(names) > 1 else names[0]
            reply = (f"এখানে আছে {listed} — কোনটার কথা জানতে চান?" if lang == "bn"
                     else f"On your screen: {listed} — which one would you like to know about?")
        print(f"[brain] 'which of these' answer invalid → answered from the facts ({crit or 'unclear'})")
        voice = reply if lang == "bn" else ""
        obj["answerItems"], obj["suggestions"] = (tied_refs or ([index.ref(pick_it)] if pick_it is not None else [])), []
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
            twin = _orderable_twin(index.by_id.get(o["itemId"]), index, orderable) if o["op"] == "add" else None
            if twin:  # (retargeted onto the lunch copy of a dish whose breakfast copy is on now)
                o["itemId"], o["name"] = index.item_id(twin), twin.get("name")
            if not orderable.get(o["itemId"], True) or (o["op"] != "add" and o["itemId"] not in cart_qty):
                ops.remove(o)
                problems.append(f"{o['name']} can't be changed that way")
        problems.append("retargeted")  # forces the deterministic confirmation line (reply named the wrong dish)
    # a bare "হ্যাঁ, দেন" adds only what the waiter actually offered in its last line (or just before) — never a dish
    # nobody mentioned ("আপনার অর্ডার পাঠানো হয়েছে" → "হ্যাঁ, দেন" once added a Masala Chicken)
    if is_affirmative(transcript) and not _dishes_named(transcript, index, limit=1):
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
    elif (not ops and not clear and not problems and not sure_q and claim_said and cart_rows is not None
          and not (_orders_now(transcript) or take_out or re.search(
              r"বদল|বাদ|কমা|বাড়া|বাড়া|সরা|বড়টা|বড়টা|ছোটটা|\b(change|swap|remove|instead|make it)\b", transcript, re.I))):
        # the guest asked for no tray change ("আবার মাছ দিচ্ছেন কেন?") — the "removed / changed" is about the
        # suggestions, not the tray: that sentence goes, the answer stays (it was "কী বদলাবো বুঝতে পারিনি…")
        kept = [s.strip() for s in re.findall(r"[^।.!?]+[।.!?]?", reply or "")
                if s.strip() and not ((_CLAIMS_ADDED.search(s) or _CLAIMS_CHANGED.search(s)) and not s.rstrip().endswith("?"))]
        reply = " ".join(kept) or ("দুঃখিত! বলুন, কী দেব?" if lang == "bn" else "Sorry about that! What would you like?")
        voice = reply if lang == "bn" else ""
        guards.append("claim_about_suggestions_cut")
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
        signature_now=co.cart_signature(rows_now), cart_nonempty=bool(rows_now), table=ck_table, llm_checkout=llm_ck,
        asked_to_confirm=asked_confirm, cart_changed_this_turn=bool(ops) or clear, cleared=clear,
        defer_done=mode == "last_call", list_on_screen=bool(shown_ids), direct_pending=bool(ck.get("direct")),
    )
    if problems and action in ("place", "readback", "ask_table"):
        # we're asking which dish / size first — the order isn't settled yet
        action, why = ("reset" if stage != "none" else "stay"), "cart change needs a clarification first"
    # "চা আর কিছু নাস্তা" — the guest is still ordering (asking for MORE): never read the order back on the model's word
    if (action == "readback" and stage == "none" and llm_ck in ("start", "confirm")
            and not (is_done_ordering(transcript) or _SAYS_CONFIRM.search(transcript) or is_explicit_confirm(transcript))
            and re.search(r"কিছু|\?|সাজেস্ট|(?<![ঀ-৿])আর(?![ঀ-৿])|\b(some|something|suggest|recommend|what else)\b", transcript, re.I)):
        action, why = "stay", "the guest is still asking for more"
    if sure_q:
        action, why = "stay", "asked the guest to confirm a tray change first"
    if action in ("readback", "place") and rows_now:
        gone = [w for w in _tray.warnings(rows_now, index.by_id, orderable, lambda _it: []) if w["kind"] == "unavailable"]
        if gone:  # sort out what can't be ordered before reading back / placing
            names = ", ".join(w["name"] for w in gone)
            tstate["pending"] = {"kind": "unavailable", "clear": False,
                                 "ops": [{"op": "remove", "itemId": w["itemId"], "name": w["name"], "lineKey": w["lineKey"]} for w in gone]}
            reply = (f"অর্ডার দেওয়ার আগে একটা কথা: {names} এখন পাওয়া যাচ্ছে না{_reason_bn(gone)}। ওটা বাদ দিয়ে দেব?"
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
        online=online, contact_missing=contact_missing,
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
        # (not when they ASKED in the same breath — "একটা বার্গার দিন, সাথে কী ভালো যাবে?" — and never the dishes they
        # named: "…আর ফ্রাইজ কেমন?" is answered)
        asked_too = bool(_WANTS_A_PICK.search(transcript)
                         or re.search(r"সাথে|সঙ্গে|\bwith\b|সাজেস্ট|suggest|recommend", transcript, re.I)
                         or (understood is not None and u_intent in ("recommend", "dish_question")))
        if not checkout_spoke and not asked_too:
            named_ids = {index.item_id(i) for i in _dishes_named(transcript, index, limit=6)}
            cut = _strip_pitches(reply, {o["itemId"] for o in ops} | set(final_qty) | named_ids, index)
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
    # …unless they're ASKING for dishes: "না, অন্য কিছু সাজেস্ট করেন", "something else?", or the AI reads it that way
    asks_for_dishes = bool(
        _WANTS_A_PICK.search(transcript)
        or re.search(r"অন্য|আলাদা|ভিন্ন|বদলে|সাজেস্ট|রেকমেন্ড|something else|anything else|\bother\b|different|instead|"
                     r"suggest|recommend|\b(onno|alada|vinno)\b", transcript, re.I)
        or (understood is not None and u_intent in ("recommend", "menu_overview", "dish_question", "order"))
    )
    # (a dish named is a request, whatever came before: "ফিরনি?" after "কী বদলাবো বুঝতে পারিনি" lost its answer — "এটা
    # খাবার শেষে খেতে দারুণ")
    # ("না দাঁড়ান, একটা ফ্রাইড রাইস ও দেন" got "কোন ফ্রাইড রাইস?" — then lost it to this, as if it were a pitch)
    if not (ops or clear) and not asks_for_dishes and "clarify_instead_of_change" not in guards and not _names_food(
            transcript, index) and not _food_word_said(transcript) and (
            short_no or upsell_engine._NO.search(transcript) or is_decline(transcript)
            # after "what do you mean?": only a short reply (a clarifying sentence is a real request)
            or (_CLARIFY_ASK.search(last_waiter or "") and len(transcript.split()) <= 3)):
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
            and not _WANTS_A_PICK.search(transcript) and topic != "recommendation"
            # the AI's reading agrees it's a question ABOUT the dish (no reading → the words decide)
            and (understood is None or u_intent in ("dish_question", "availability"))
            and orderable.get(index.item_id(asked_dish[0]), True)
            and not [v for v in violations(asked_dish[0], profile) if v.startswith("allergy") or v in _DIET_CLASH]):
        keep = set(cart_qty) | {index.item_id(asked_dish[0])}
        cut = _strip_pitches(reply, keep, index)
        # only a trim: what stays must still be the answer about the dish — never an empty "কোনটা অর্ডার করবেন?"
        still_about_it = any(index.item_id(i) == index.item_id(asked_dish[0]) for i in _dishes_named(cut, index, limit=4))
        if cut != reply and cut and still_about_it:
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
    # a question about THE dish ("সরষে ইলিশের দাম কত?", then "কয় পিস থাকে?") shows that dish — two strangers beside it
    # read as "we recommend these"
    # "ওয়াশরুম কোথায়?" / "পার্কিং আছে?" — answered, and nothing more: no dishes pitched after it (it once added
    # "এখন ভাত খেতে পারেন। ভাতের সাথে গরুর লাল ভুনা…" and three cards)
    if _INFO_Q.search(transcript or "") and not (ops or clear) and not _names_food(transcript, index):
        cut = _strip_pitches(reply, set(cart_qty), index)
        cut = " ".join(s.strip() for s in re.findall(r"[^।.!?]+[।.!?]?", cut)
                       if s.strip() and not re.search(r"খেতে পারেন|অর্ডার কর|(?<![ঀ-৿])ভাত|\border\b", s))
        # the waiter doesn't know the building: never "ওয়াশরুম পিছনের দিকে" made up — the staff show the way
        if re.search(r"ওয়াশরুম|ওয়াশরুম|টয়লেট|বাথরুম|washroom|toilet|restroom|bathroom", transcript, re.I) and not re.search(
                r"স্টাফ|ঘণ্টা|ঘন্টা|ওয়েটার|staff|bell|waiter", cut or "", re.I):
            cut = ("ওয়াশরুমটা আমাদের স্টাফ দেখিয়ে দেবেন — উপরে বাঁ দিকের ঘণ্টার বোতামে চাপ দিলেই কেউ চলে আসবেন।" if lang == "bn"
                   else "Our staff will show you the way — tap the bell at the top left and someone will come over.")
        if cut and cut != reply:
            reply = cut
            voice = reply if lang == "bn" else ""
            guards.append("info_answered_only")
        suggestions, recommending = [], False
    about_ids = set(mentioned_now) | {index.item_id(it) for it in _dishes_named(transcript, index)} | {
        index.item_id(it) for it in recent[:1]}
    only_the_dish = bool(suggestions) and all(s.get("itemId") in about_ids for s in suggestions) and not (
        asks_for_recommendation(transcript) or _WANTS_A_PICK.search(transcript))
    if (recommending and (suggestions or scoped_out) and len(suggestions) < 3 and not only_the_dish
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
    # the model's stock filler — "এটা গরম গরম প্লেটে আসে" about a ফিরনি (only a sizzling comes on a hot plate)
    if not re.search(r"sizzl|সিজলিং", reply, re.I):
        reply = re.sub(r"[^।.!?]*গরম গরম প্লেটে[^।.!?]*[।.!?]\s*", "", reply).strip() or reply
        if voice:
            voice = re.sub(r"[^।.!?]*গরম গরম প্লেটে[^।.!?]*[।.!?]\s*", "", voice).strip() or voice
    # the 🌶 / ✓ marks on a dish name are for the menu card — never said ("ষোল আনা স্পেশাল চা 🌶🌶")
    reply = re.sub(r"[ \t]*[🌶✓✔★☆🔥⭐]+️?", "", reply).strip()
    if voice:
        voice = re.sub(r"[ \t]*[🌶✓✔★☆🔥⭐]+️?", "", voice).strip()
    # "এটা খেতে চান? অর্ডার করতে চান?" / "ভাতও অর্ডার করতে চান? অর্ডার অর্ডার করবেন?" — one question at a time: the last
    # "একটা বাটার চিকেন দিন, সাথে কী ভালো যাবে?" — added, and its partners from the pairing rules (the model once put
    # Tandoori Chicken and a biryani with the butter chicken)
    if ops and pairing.ASKS.search(transcript or ""):
        added = [index.by_id.get(str(o.get("itemId"))) for o in ops if o.get("op") == "add"]
        added = [a for a in added if a]
        if len(added) == 1:
            shape, groups = pairing.partners(added[0], index, orderable, list(final_qty), may_recommend)
            if any(v for _k, v in groups):
                done = " ".join(s.strip() for s in re.findall(r"[^।.!?]+[।.!?]?", reply)
                                if re.search(r"যোগ করলাম|যোগ করেছি|\badded\b", s))
                told = pairing.reply(added[0], shape, groups, lang)
                if not done:
                    q = next((int(o.get("quantity") or 1) for o in ops if o.get("op") == "add"), 1)
                    nm = bangla_meal.said_name(added[0])
                    done = f"{q}টা {nm} যোগ করলাম।" if lang == "bn" else f"Added {q} × {nm}."
                reply = (done + " " + told).strip()
                voice = reply if lang == "bn" else ""
                suggestions = [_suggestion_row(x) for _k, v in groups for x in v][:5]
                guards.append("pairing_after_add")
    reply = _one_last_question(reply)
    if voice:
        voice = _one_last_question(voice)
    # "ভাত" is plain rice — on a menu that has none, the model meant the fried rice ("ভাত আর সবজি" → Fried Rice & Vegetable)
    if lang == "bn" and not _HAS_PLAIN_RICE(index):
        reply = _no_bhat(reply)
        if voice:
            voice = _no_bhat(voice)
    # an allergy at this table: never "this one is nut-free / safe" (the kitchen can't promise it — a brownie was called
    # "বাদাম মুক্ত"), and always the note to tell the staff
    if profile.allergies:
        # ("বাটার চিকেনে বাদাম আছে?" asks it: the claim WAS the answer — said plainly as not known for sure)
        asked_in = bool(re.search(r"(এ|তে|য়|য়)\s+.{0,12}(আছে|থাকে)\s*\??\s*$|\b(contain|have)\b.*\?|\bis there\b",
                                  transcript or "", re.I))
        reply = _no_free_claims(reply, lang, asked_in)
        if voice:
            voice = _no_free_claims(voice, lang, asked_in)
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
            if o.type in offers.MEAL_COMPLETING:
                # the offer asks it — the model's own "এখন ভাত খেতে পারেন।" would say it twice
                reply = _drop_sentences(reply, _RICE_BREAD_TALK)
                if voice:
                    voice = _drop_sentences(voice, _RICE_BREAD_TALK)
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
    # a diet only when the guest said one: "হেলদি কিছু আছে?" was read as vegetarian, and from then on every
    # suggestion went to the model's "safety" path (and "সবচেয়ে জনপ্রিয়" got invented popularity)
    if learned.diet and not re.search(r"ভেজ|নিরামিষ|ভেজিটেরিয়ান|ভেগান|মাংস খাই না|মাছ মাংস|\b(veg|vegetarian|vegan|"
                                      r"veggie|no meat|halal|pork)\b|গরু|বিফ|beef|শুকর", transcript or "", re.I):
        learned.diet = []
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
            tip = " " + _gone_from_tray(w, index, orderable, set(final_qty), lang)
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
