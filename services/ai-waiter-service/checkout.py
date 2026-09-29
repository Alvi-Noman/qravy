"""
Checkout for the virtual waiter: "wants to order / wants to check out" understanding, the read-back,
and the rules for placing an order. Pure functions — the brain wires them up, the server places.

Stages (kept per session):
  none      normal conversation
  table     guest wants to order but we don't know their table yet → ask
  readback  we read the order back (items, add-ons, total, table, pay at counter) and wait for YES

Placing needs a table number and the guest's own clear words, either:
  - an explicit "send it" command with a filled tray ("এগুলো দেন", "অর্ডারটা কনফার্ম করেন", "খাবারগুলো পাঠায় দেন",
    "খাবার সার্ভ করেন", "send it to the kitchen") → placed straight away, no read-back, no prices read out; or
  - a yes to the short read-back ("2 × X, 1 × Y — shall I place it?") that softer signals get ("that's all",
    the model's reading), with the cart unchanged since (signature).
A question, a negation, or the model's reading alone never places an order.

Intent is decided from several signals, not one keyword list:
  - the LLM's reading of the utterance (`checkout`: start | confirm | cancel | none)
  - multilingual phrase rules (English, Bangla, Banglish), with negation / question handling
  - context: current stage, whether the waiter just asked to confirm, what's in the cart
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from bn_translit import _N99
from waiter_knowledge import _money, is_affirmative, is_done_ordering, is_explicit_confirm

STAGES = ("none", "table", "readback")
_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

# ------------------------------------------------------------------ "I want to order / check out"

_WANTS_CHECKOUT = re.compile(
    # English
    r"\b(place|put in|send|submit|finali[sz]e|complete|process|confirm)\s+(my |the |our |this |that )?order\b"
    r"|\bcheck\s*-?\s*out\b|\b(i'?m|we'?re|i am|we are) ready (to order|to check out)\b|\bready to order\b"
    r"|\blet'?s order\b|\b(go ahead|go on) (and )?(order|place)\b|\border (it|them|this|that|everything) (now|please)\b"
    r"|\b(i'?m|we'?re|i am|we are) (done|finished) ordering\b|\bdone ordering\b|\bwe'?d like to order now\b"
    # Bangla
    r"|অর্ডার\s*(টা|টি)?\s*(দিয়ে দিন|দিয়ে দেন|দিয়ে দাও|করে দিন|করে দেন|প্লেস|দেব|দিব|দিতে চাই|কনফার্ম|ফাইনাল|পাঠিয়ে দিন|কমপ্লিট)"
    r"|চেক\s*আউট|অর্ডার শেষ"
    # Banglish
    r"|\border\s+(diye den|diye dao|kore den|kore dao|dibo|debo|place|confirm|pathiye den)\b",
    re.I,
)
# "send it now" — an explicit command to place what's in the tray: placed at once, no read-back
_SEND_NOW = re.compile(
    # English
    r"\b(place|send|submit|confirm|finali[sz]e|put in)\s+(my |the |our |this |that )?order\b"
    r"|\bsend (it|them|everything|it all|the food|the order)( to the kitchen| in| now)?\b|\bserve (it|them|the food|everything)\b"
    r"|\bbring (it|them|the food|everything)( out)?\b|\bgo ahead and (order|place)\b|\bcheck\s*-?\s*out\b"
    # Bangla
    r"|অর্ডার\s*(টা|টি|গুলো)?\s*(কনফার্ম|প্লেস|দিয়ে দিন|দিয়ে দেন|দিয়ে দাও|করে দিন|করে দেন|করেন|করুন|পাঠিয়ে দিন|পাঠিয়ে দেন|পাঠায় দেন|পাঠাই দেন|ফাইনাল)"
    r"|খাবার\s*(গুলো|গুলা|গুলি|টা|টুকু)?\s*(পাঠায় দেন|পাঠাই দেন|পাঠিয়ে দিন|পাঠিয়ে দেন|পাঠিয়ে দাও|পাঠান|পাঠাও|সার্ভ কর|দিয়ে যান|দিয়ে দিন|দিয়ে দেন|নিয়ে আসেন|নিয়ে আসুন|নিয়ে আসো|আনেন|আনুন)"
    r"|সার্ভ (করেন|করুন|করে দিন|করে দেন|কর)|কিচেনে (পাঠান|পাঠিয়ে দিন|পাঠিয়ে দেন|দিয়ে দিন|দিয়ে দেন)"
    # Banglish
    r"|\border ?(ta|ti)? (confirm|place|diye den|diye din|kore den|koren|korun|pathiye den|pathay den|pathai den)\b"
    r"|\bkhabar ?(gulo|gula|ta)? (pathay den|pathai den|pathiye den|pathan|serve koren|serve korun|diye jan|niye ashen|anen)\b"
    r"|\bserve (koren|korun|kore den)\b",
    re.I,
)
# "এগুলো দেন" — the tray, unless a list of dishes is on the screen (then it means "add those")
_THESE_PLEASE = re.compile(
    r"(এগুলো|এগুলা|এগুলি|এইগুলো|এইগুলা|এই গুলো|সবগুলো|সব গুলো)\s*ই?\s*(দেন|দিন|দাও|দিয়ে দেন|দিয়ে দিন|পাঠান|পাঠিয়ে দিন|পাঠায় দেন)"
    r"|\b(ei ?gula|egula|egulo|ei ?gulo|shob ?gula)i? (den|din|dao|diye den|pathay den|pathan)\b"
    r"|\b(send|order) (these|all of these|all this|all of it)\b",
    re.I,
)


def wants_send_now(text: str, list_on_screen: bool = False) -> bool:
    """An explicit, unhedged command to place the tray now — never a question, never negated."""
    t = (text or "").strip()
    if not t or "?" in t or _CHECKOUT_NEGATED.search(t) or wants_to_hold(t):
        return False
    return bool(_SEND_NOW.search(t)) or (bool(_THESE_PLEASE.search(t)) and not list_on_screen)


# "that's all / nothing else" — the guest is done choosing; it answers "anything else?" (checkout follows,
# but a last-call drink offer may come first)
_DONE = re.compile(
    r"\b(that'?s|that is) (all|it|everything)\b|\bnothing (else|more)\b|\b(i'?m|we'?re) (done|finished|good)\b"
    r"|\bthat('?ll| will) be all\b|এটুকুই|এইটুকুই|এগুলোই|এই গুলোই|আর কিছু (লাগবে না|না|চাই না)|ব্যস|হয়ে গেছে"
    r"|\b(ar kichu lagbe na|eitukui?|eiguloi?|hoye geche)\b",
    re.I,
)


def is_done(text: str) -> bool:
    t = (text or "").strip()
    return bool(t) and "?" not in t and (bool(_DONE.search(t)) or is_done_ordering(t))
_CHECKOUT_NEGATED = re.compile(
    r"\b(don'?t|do not|not yet|not now|wait|hold on|later|before (i|we) order)\b.{0,20}\b(order|check\s*out|place)"
    r"|অর্ডার.{0,12}(দেব না|দিব না|করব না|এখন না|পরে)|\border\s+(dibo na|korbo na|pore)\b",
    re.I,
)
# payment/bill talk is NOT placing an order (pay at the counter is handled as info / service)
_BILL_ONLY = re.compile(r"\b(bill|check please|pay|payment)\b|বিল|পেমেন্ট|টাকা দেব", re.I)


def wants_checkout(text: str) -> bool:
    t = (text or "").strip()
    if not t or _CHECKOUT_NEGATED.search(t):
        return False
    if _BILL_ONLY.search(t) and not re.search(r"order|অর্ডার|check\s*out|চেক\s*আউট", t, re.I):
        return False
    return bool(_WANTS_CHECKOUT.search(t)) or is_explicit_confirm(t)


# ------------------------------------------------------------------ "no / wait" during the read-back

_CANCEL_CHECKOUT = re.compile(
    r"^\s*(no|nope|nah|wait|hold on|hang on|not yet|one (sec|second|moment|minute)|let me (think|check)|stop|cancel|don'?t)\b"
    r"|\b(don'?t (place|order|send)|not yet|wait|hold (it|on|off)|hang on)\b"
    r"|^\s*(না|নাহ|দাঁড়ান|দাড়ান|এখন না|একটু পরে|পরে|থামুন|ওয়েট|না থাক|থাক)(\s|,|।|$)"
    r"|\b(ekhon na|pore|wait koren|na thak|thak)\b",
    re.I,
)


def wants_to_hold(text: str) -> bool:
    t = (text or "").strip()
    return bool(t) and bool(_CANCEL_CHECKOUT.search(t)) and not is_explicit_confirm(t)


def says_yes(text: str) -> bool:
    """An explicit yes to 'shall I place it?' — never a question, never negated."""
    t = (text or "").strip()
    if not t or "?" in t or wants_to_hold(t):
        return False
    return is_affirmative(t) or is_explicit_confirm(t) or bool(
        re.match(r"^\s*(yes|yeah|yep|sure|ok(ay)?|go ahead|place it|send it|please do|do it|হ্যাঁ|হ্যা|জি|জ্বি|ঠিক আছে|দিন|দিয়ে দিন|হ্যাঁ দিন)\b", t, re.I)
    )


# ------------------------------------------------------------------ table number

_WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
             "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
             "eighteen": 18, "nineteen": 19, "twenty": 20, "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6,
             "সাত": 7, "আট": 8, "নয়": 9, "দশ": 10}
# Bangla 1–99 ("বারো নম্বর টেবিল" was missed: the list stopped at দশ) + common spellings
_WORD_NUM.update({w: n for n, w in enumerate(_N99) if n})
_WORD_NUM.update({"চোদ্দ": 14, "চৌদ্দ": 14, "ষোল": 16, "উনত্রিশ": 29})
_EN_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_NUM_WORD_RE = r"((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+[a-z]+|[a-zঀ-৿]+)"


def _word_number(w: str) -> Optional[int]:
    """'বারো' → 12, 'twelve' → 12, 'twenty one' → 21; None if it isn't a number word."""
    w = (w or "").strip().lower()
    if w in _WORD_NUM:
        return _WORD_NUM[w]
    parts = re.split(r"[\s-]+", w)
    if len(parts) == 2 and parts[0] in _EN_TENS and _WORD_NUM.get(parts[1], 99) < 10:
        return _EN_TENS[parts[0]] + _WORD_NUM[parts[1]]
    return _EN_TENS.get(w)


def table_from_text(text: str, *, expecting: bool = False) -> Optional[str]:
    """'table 12', 'টেবিল ১২', '12 number table', 'we're at table A3' — or a bare number when we just asked."""
    t = (text or "").translate(_BN_DIGITS).lower()
    m = re.search(r"(?:table|টেবিল|tebil)\s*(?:no\.?|number|নম্বর|নং)?\s*[:#-]?\s*([a-z]?\d{1,3}[a-z]?)\b", t)
    if not m:
        m = re.search(r"\b([a-z]?\d{1,3}[a-z]?)\s*(?:no\.?|number|নম্বর|নং)?\s*(?:table|টেবিল|tebil)", t)
    if m:
        return m.group(1).upper()
    # spelled out: "table twelve", "টেবিল বারো", "বারো নম্বর টেবিলে", "twelve number table"
    for pat in (rf"(?:table|টেবিল|tebil)\s*(?:no\.?|number|নম্বর|নং)?\s*{_NUM_WORD_RE}",
                rf"{_NUM_WORD_RE}\s*(?:no\.?|number|নম্বর|নং)?\s*(?:table|টেবিল|tebil)"):
        for m in re.finditer(pat, t):
            n = _word_number(m.group(1))
            if n:
                return str(n)
    if expecting:
        m = re.fullmatch(r"\s*(?:it'?s|its|we'?re at|at|আমরা)?\s*#?\s*([a-z]?\d{1,3}[a-z]?)\s*(?:নম্বর|নং|number)?\s*[.।!]?\s*", t)
        if m:
            return m.group(1).upper()
        w = re.sub(r"\s*(?:নম্বর|নং|number)$", "", t.strip(" .।!"))
        n = _word_number(w)
        if n:
            return str(n)
    return None


# ------------------------------------------------------------------ cart fingerprint & read-back


def cart_signature(rows: List[Dict[str, Any]]) -> str:
    """Stable fingerprint of what's being ordered — 'yes' only places the exact cart that was read back."""
    # names (not option ids), no notes: the waiter's view of a line and the storefront's must agree
    agg: Dict[Tuple[str, str, Tuple[str, ...]], int] = {}
    for r in rows:
        q = int(r.get("quantity") or 0)
        if q <= 0:
            continue
        key = (
            str(r.get("itemId")),
            str(r.get("variation") or "").strip().lower(),
            tuple(sorted(str(m.get("name") or m.get("optionId") or "").strip().lower() for m in r.get("modifiers") or [])),
        )
        agg[key] = agg.get(key, 0) + q
    norm = sorted([*k, q] for k, q in agg.items())
    return hashlib.sha1(json.dumps(norm, ensure_ascii=False).encode()).hexdigest()[:16]


def _line_label(r: Dict[str, Any]) -> str:
    extras = [x for x in [r.get("variation"), *[m.get("name") for m in r.get("modifiers") or []]] if x]
    label = f"{r['quantity']} × {r['name']}" + (f" ({', '.join(extras)})" if extras else "")
    if r.get("notes"):
        label += f" [note: {r['notes']}]"
    return label


def readback_text(rows: List[Dict[str, Any]], table: str, lang: str, vat_hint: str = "", eta_hint: str = "") -> str:
    """A short check for softer signals ("that's all"): what's being ordered, then the question. No prices, total or
    payment talk — the tray on screen shows them. (vat_hint / eta_hint are kept for callers; the ETA is said once
    the order is placed.)"""
    lines = ", ".join(_line_label(r) for r in rows)
    if lang == "bn":
        return f"{lines} — অর্ডারটা দিয়ে দেব?"
    return f"{lines} — shall I place the order?"


def online_checkout_text(rows: List[Dict[str, Any]], lang: str, vat_hint: str = "", eta_hint: str = "") -> str:
    """Online (pickup / delivery): no table and no voice placing — read the order back and point at the form,
    where the guest picks pickup or delivery and types name, phone and address."""
    lines = "; ".join(f"{_line_label(r)} — {_money(float(r['price'] or 0) * r['quantity'])}" for r in rows)
    total = sum(float(r["price"] or 0) * r["quantity"] for r in rows)
    if lang == "bn":
        return (f"আপনার অর্ডার: {lines}। মোট {_money(total)}{vat_hint}।{eta_hint} "
                "পিকআপ না ডেলিভারি বেছে নিন, নাম আর ফোন নম্বর দিয়ে 'অর্ডার দিন' চাপুন।")
    return (f"Here's your order: {lines}. Total {_money(total)}{vat_hint}.{eta_hint} "
            "Choose pickup or delivery, add your name and phone, then tap Place order.")


def table_again_text(lang: str) -> str:
    """We asked for the table and heard something that isn't a number ("মারুক" for "বারো") — ask again, never guess."""
    return ("দুঃখিত, টেবিল নম্বরটা ঠিক বুঝতে পারিনি। আবার বলবেন? যেমন: বারো নম্বর টেবিল।" if lang == "bn"
            else "Sorry, I didn't catch the table number. Could you say it again? For example: table twelve.")


def ask_table_text(lang: str) -> str:
    return ("অর্ডার দেওয়ার আগে বলবেন, আপনি কোন টেবিলে বসেছেন? টেবিলের নম্বরটা বলুন।" if lang == "bn"
            else "Before I place it — which table are you at? Just tell me the table number.")


def held_text(lang: str) -> str:
    return ("ঠিক আছে, এখনই দিচ্ছি না। কিছু বদলাতে বা নিতে চাইলে বলবেন।" if lang == "bn"
            else "No problem — I won't place it yet. Would you like to change or add anything?")


def empty_cart_text(lang: str) -> str:
    return ("আপনার ট্রে এখনো খালি — কী খেতে চান বলুন, আমি যোগ করে দিই।" if lang == "bn"
            else "Your order is empty right now — tell me what you'd like and I'll add it.")


def placed_text(order: Dict[str, Any], lang: str, eta_hint: str = "") -> str:
    # short and simple — the number, table and total are on the screen (reading "#1" aloud sounded odd)
    if order.get("status") == "placed":  # sent — the restaurant hasn't accepted it yet, so don't call it confirmed
        return ("আপনার অর্ডার রেস্টুরেন্টে পাঠানো হয়েছে।" if lang == "bn" else "Your order has been sent to the restaurant.") + eta_hint
    if eta_hint:  # the real ETA auth-service gave this order
        return ("আপনার অর্ডার কনফার্ম করা হয়েছে।" if lang == "bn" else "Your order is confirmed.") + eta_hint
    if lang == "bn":
        return "আপনার অর্ডার কনফার্ম করা হয়েছে। একটু অপেক্ষা করুন, খুব শীঘ্রই আপনার ফুড সার্ভ করা হবে।"
    return "Your order is confirmed. Please sit back — it'll be served to you very soon."


# server/validation wording a guest should never hear ("Validation failed", "HTTP 500", field names…)
_TECHNICAL = re.compile(r"validation|http \d|failed|error|invalid|expected|received|undefined|null|subdomain|\bitems?\b\.", re.I)


def failed_text(message: str, lang: str) -> str:
    if not message or _TECHNICAL.search(message):
        return ("দুঃখিত, এই মুহূর্তে অর্ডারটা পাঠানো গেল না। একটু পরে আবার বলবেন, অথবা একজন স্টাফকে ডাকুন।" if lang == "bn"
                else "Sorry, I couldn't send your order just now. Please try again in a moment, or ask a staff member.")
    if lang == "bn":
        return f"দুঃখিত, অর্ডারটা দেওয়া গেল না: {message} একটু বদলে নেবেন?"
    return f"Sorry, I couldn't place the order: {message} Would you like to change something?"


# ------------------------------------------------------------------ the decision


def decide(
    *,
    text: str,
    stage: str,
    stored_signature: str,
    signature_now: str,
    cart_nonempty: bool,
    table: Optional[str],
    llm_checkout: str,
    asked_to_confirm: bool,
    cart_changed_this_turn: bool,
    cleared: bool,
    defer_done: bool = False,
    list_on_screen: bool = False,
    direct_pending: bool = False,
) -> Tuple[str, str]:
    """(action, reason). Actions:
      place      → place the order now
      readback   → read the order back and ask "shall I place it?"
      ask_table  → ask which table
      hold       → leave checkout ("no / wait"), keep the cart
      empty      → wants to order but the cart is empty
      stay       → nothing checkout-related to do this turn (keep the stage)
      reset      → leave checkout silently (cart cleared, etc.)"""
    llm = llm_checkout if llm_checkout in ("start", "confirm", "cancel") else "none"
    question = "?" in (text or "")

    if cleared:
        return "reset", "cart cleared"

    if stage == "readback":
        if cart_changed_this_turn or (stored_signature and signature_now != stored_signature):
            return ("readback", "order changed during read-back") if cart_nonempty else ("reset", "cart emptied")
        if wants_to_hold(text) or (llm == "cancel" and not says_yes(text)):
            return "hold", "guest said no / wait"
        if says_yes(text) or wants_send_now(text, list_on_screen) or (
            llm == "confirm" and not question and not wants_to_hold(text) and len(text) <= 60
        ):
            if not table:
                return "ask_table", "confirmed but no table"
            return "place", "explicit yes to the read-back"
        return "stay", "question or other talk during read-back"

    if stage == "table":
        if table:
            if not cart_nonempty:
                return "empty", "table given, nothing to order"
            # they already said "send it" — the table was the only thing missing
            return ("place", "got the table after send now") if direct_pending else ("readback", "got the table")
        if wants_to_hold(text) or llm == "cancel":
            return "hold", "guest backed out"
        return "stay", "still waiting for the table number"

    # stage none: "send it" with a filled tray → place now (a tray just changed by voice gets a quick check first)
    if wants_send_now(text, list_on_screen) and not cart_changed_this_turn:
        if not cart_nonempty:
            return "empty", "send now, but the cart is empty"
        if not table:
            return "ask_table", "send now, table unknown"
        return "place", "send now — explicit command"

    # stage none: does the guest want to order / check out now?
    done = is_done(text)
    if asked_to_confirm and wants_to_hold(text) and not wants_checkout(text) and not (done and len(text.split()) > 1):
        return "stay", "said no to 'shall I place it?'"
    strong = wants_checkout(text) or (asked_to_confirm and says_yes(text)) or (
        llm in ("start", "confirm") and not question and not wants_to_hold(text) and not cart_changed_this_turn
    )
    if done and not strong and (defer_done or not cart_nonempty):
        return "stay", "done choosing — last-call offer first" if cart_nonempty else "nothing ordered"
    if not (strong or done):
        return "stay", "no checkout intent"
    if not cart_nonempty:
        return "empty", "wants to order but the cart is empty"
    if not table:
        return "ask_table", "wants to order, table unknown"
    return "readback", "wants to order"
