"""UNDERSTAND FIRST. One small model call reads what the guest just said — in its context (the waiter's last line, the
tray, this menu) — and returns what they MEAN as data. The brain then picks the answer's shape from that meaning
(the menu tour, a kind / taste / audience recommendation, an order, "please say it again"…), instead of letting a
word pattern decide. The word patterns stay as the fallback when this call is off, slow or fails.

    {"intent": "recommend", "kind": "", "taste": "spicy", "audience": "", "count": 0, "dishes": [], "confident": true}
    {"intent": "order", "dishes": [{"name": "Won Thon Noodle Soup", "qty": 2, "size": "", "change": "add"}], ...}
"""
import hashlib
import json
import os
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

INTENTS = [
    "order",          # wants dishes added ("দুইটা স্যুপ দিন", "I'll have the kacchi")
    "change_order",   # change something already in the tray: more / less / size / swap / note
    "remove",         # take something out of the tray / cancel it
    "recommend",      # wants suggestions — general, or within a kind / taste / for someone
    "menu_overview",  # "what do you have?" in general — the restaurant's kinds of food
    "see_menu",       # wants to SEE / open the menu itself
    "dish_question",  # asks about a dish: price, taste, spicy, ingredients, size, how it's made
    "availability",   # "do you have X?" (a dish or a kind)
    "tray_review",    # "what's in my order / tray?", "how much is it so far?"
    "checkout",       # confirm / place the order, "that's all, send it"
    "hold",           # not yet / wait, don't place it
    "wait_time",      # how long will it take, where is my food
    "service",        # the bill, call a waiter, water to the table, napkins, a complaint
    "small_talk",     # greetings, how are you, thanks
    "not_wanting",    # doesn't want anything (now)
    "yes",            # a bare yes / okay to the waiter's last question
    "no",             # a bare no to the waiter's last question
    "unclear",        # the words can't be understood (garbled speech-to-text)
    "other",
]
TASTES = ["", "spicy", "mild", "sweet", "sour", "light", "filling", "special"]

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["intent", "kind", "taste", "audience", "count", "dishes", "confident"],
    "properties": {
        "intent": {"type": "string", "enum": INTENTS},
        "kind": {"type": "string", "description": "a kind/category of food the guest means, in English (soup, drinks, dessert, sizzling, rice…); '' if none"},
        "taste": {"type": "string", "enum": TASTES},
        "audience": {"type": "string", "description": "who the food is for, in English (kids, family, friends, wife, parents…); '' if none"},
        "count": {"type": "integer", "description": "how many dishes they want to hear about ('top three' = 3); 0 if not said"},
        "dishes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "qty", "size", "change"],
                "properties": {
                    "name": {"type": "string", "description": "the EXACT menu name when you are sure which dish; otherwise the words as heard"},
                    "qty": {"type": "integer", "description": "the number the guest said (half a dozen = 6); 0 if none"},
                    "size": {"type": "string", "description": "the size/option they said (half, full, large…); '' if none"},
                    "change": {"type": "string", "enum": ["add", "more", "total", "less", "remove", "swap_to", "about"]},
                },
            },
        },
        "confident": {"type": "boolean"},
    },
}

PROMPT = """You read what a restaurant guest in Bangladesh just said to the AI waiter (Bangla, English or mixed; it comes from speech-to-text, so words may be misheard) and return what they MEAN. You never answer them.

Read it in context: the waiter's last line (a bare "হ্যাঁ"/"না"/"দিন" answers THAT), the guest's tray, and this restaurant's menu.

INTENTS
- order: wants dishes added. change_order: more/less/size/swap of something ALREADY in the tray. remove: take it out.
- recommend: wants suggestions — "ভালো কী আছে?", "কী খাওয়া যায় / যেতে পারে?", "আমি আজ কী খাবো?", "নতুন কী আছে?", "what's good?", "what should I eat?", "কিছু সাজেস্ট করেন". Fill kind (e.g. "স্যুপের মধ্যে কী ভালো?" → kind "soup"; "ড্রিংকসের মধ্যে কী আছে?" → kind "drinks"), taste ("ঝাল কিছু", "ঝাল খাবারের মধ্যে কী আছে?" → taste "spicy"), audience ("বাচ্চাদের জন্য" → "kids"), count ("টপ থ্রি" → 3).
- menu_overview: ONLY a general "what do you have / what kinds of food do you serve?" with no kind, taste or audience ("কি কি আছে আপনাদের?", "মেনুতে কী কী আছে?"). Asking what's GOOD or what to eat is recommend. With a kind/taste/audience it is recommend.
- taste / kind / audience / count are only for recommend (and availability of a kind). "ঝাল কম দিয়ে একটা মশলা চিকেন দিন" is an order with a note — taste stays "".
- see_menu: wants to see/open the menu. dish_question: asks ABOUT a dish (price, spicy?, what's in it). availability: "X আছে?".
- tray_review: about THEIR order — "অর্ডারে / ট্রেতে কি কি আছে?", "আমার কী কী নেওয়া হলো?", "মোট কত হলো?" (never the menu tour).
- remove also covers "ক্যান্সেল করেন", "বাদ দিন", "লাগবে না". change_order "less" covers "কমান / কমাও / কমা / একটা কম".
- checkout (confirm/place/send the order, "that's all"), hold (not yet), wait_time, service, small_talk.
- not_wanting: doesn't want anything ("আজকে কিছু খেতে চাই না"). yes / no: a bare answer to the waiter's question.
- unclear: you can't tell what they want (garbled words). Never guess a dish from garbled words. But a short misheard word right after the waiter's yes/no question that sounds like yes or no ("হেয়" = হ্যাঁ) is yes / no. And a SHORT ANSWER to the waiter's question is never unclear: after "ছোটটা নাকি বড়টা?" → "ছোটোটা" / "বড়টা" is order (that dish, that size); after "কোনটা দেব?" → a dish name or "প্রথমটা" is order; after "কয়টা?" → "দুইটা" is order with that qty.

- Saying what they like or can eat ("আমি একটু কম ঝাল খাবার খাই", "I'm vegetarian") with no dish named is recommend (taste mild / etc.).

DISHES (for order / change_order / remove / dish_question / availability): each dish they actually NAMED — a kind word alone ("ড্রিংকস", "স্যুপ") is not a dish. A dish that is NOT on this menu ("চা" when there's no tea) stays as heard ("tea") — never swap in a different menu dish. name = the exact MENU name only when you are sure (misheard spellings are fine: "ওয়ান্টন স্যুপ" = Won Thon Noodle Soup, not Fried Won Thon); a generic word that fits several dishes ("সিজলিং") stays as heard. qty = the number they said (হাফ ডজন = 6, এক জোড়া = 2, "দুইটা করে" = that number for EACH dish), else 0. size = only a size they SAID; when a dish comes in sizes (Mineral Water small / large) and they didn't say one, keep the plain name ("Mineral Water") and size "". change: add (new), more ("আরও/আরেকটা"), total ("মোট দুইটা করে দিন"), less ("একটা কমান"), remove, swap_to (the new one in a swap), about (asked about, not ordering). "পরে হয়তো নেব" (maybe later) is not an order.

confident: false when the words are unclear or could mean two different things.
Return ONLY the JSON."""

_CACHE: Dict[str, Any] = {}


def _menu_block(items: List[Dict[str, Any]]) -> str:
    cats: Dict[str, List[str]] = {}
    for it in items:
        cats.setdefault(str(it.get("category") or "Other"), []).append(str(it.get("name") or ""))
    return "\n".join(f"{c}: {', '.join(n for n in names if n)}" for c, names in cats.items())


def messages(transcript: str, *, items: List[Dict[str, Any]], last_waiter: str, tray: List[str]) -> List[Dict[str, str]]:
    # the menu goes in the SYSTEM message: it never changes between turns, so the provider caches that prefix
    system = PROMPT + "\n\nMENU (category: dishes)\n" + _menu_block(items)
    user = (f"Waiter's last line: {last_waiter or '(none — the conversation just started)'}\n"
            f"Guest's tray: {', '.join(tray) if tray else '(empty)'}\n"
            f"Guest said: \"{transcript}\"")
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _clean(obj: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(obj, dict) or obj.get("intent") not in INTENTS:
        return None
    out = {
        "intent": obj["intent"],
        "kind": str(obj.get("kind") or "").strip().lower()[:40],
        "taste": obj.get("taste") if obj.get("taste") in TASTES else "",
        "audience": str(obj.get("audience") or "").strip().lower()[:30],
        "count": max(0, min(int(obj.get("count") or 0), 10)),
        "dishes": [],
        "confident": bool(obj.get("confident", True)),
    }
    for d in obj.get("dishes") or []:
        if isinstance(d, dict) and str(d.get("name") or "").strip():
            out["dishes"].append({"name": str(d["name"]).strip()[:80], "qty": max(0, min(int(d.get("qty") or 0), 99)),
                                  "size": str(d.get("size") or "").strip()[:30],
                                  "change": d.get("change") if d.get("change") in SCHEMA["properties"]["dishes"]["items"]["properties"]["change"]["enum"] else "add"})
    return out


async def understand(
    transcript: str,
    *,
    items: List[Dict[str, Any]],
    last_waiter: str,
    tray: List[str],
    post: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]],
    model: str,
) -> Optional[Dict[str, Any]]:
    """The guest's meaning, or None (off / failed / too slow — the caller falls back to its word patterns)."""
    if not (transcript or "").strip():
        return None
    key = hashlib.sha1(json.dumps([transcript, last_waiter, tray, len(items), model], ensure_ascii=False).encode()).hexdigest()
    if key in _CACHE:
        return _CACHE[key]
    body = {
        "model": model,
        "messages": messages(transcript, items=items, last_waiter=last_waiter, tray=tray),
        "max_tokens": 300,
        "temperature": 0,
        "response_format": {"type": "json_schema", "json_schema": {"name": "guest_meaning", "strict": True, "schema": SCHEMA}},
    }
    t0 = time.monotonic()
    try:
        data = await post(body)
        text = data["choices"][0]["message"]["content"]
        out = _clean(json.loads(text))
    except Exception as e:  # noqa: BLE001 — any failure → the word patterns decide, as before
        print(f"[intent] failed ({type(e).__name__}: {str(e)[:120]}) → word patterns")
        return None
    usage = data.get("usage") or {}
    print(f"[intent] {out} ms={int((time.monotonic() - t0) * 1000)} in={usage.get('prompt_tokens')} "
          f"cached={(usage.get('prompt_tokens_details') or {}).get('cached_tokens')} out={usage.get('completion_tokens')}")
    if len(_CACHE) > 2000:
        _CACHE.clear()
    _CACHE[key] = out
    return out


ENABLED = os.environ.get("INTENT_AI", "1").strip().lower() not in ("0", "false", "no", "off")
MODEL = os.environ.get("INTENT_MODEL", "gpt-4.1-mini").strip()
TIMEOUT_S = float(os.environ.get("INTENT_TIMEOUT_S", "3.5"))
