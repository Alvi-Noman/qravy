/**
 * Intent routing helpers for the AI Waiter.
 * Encodes the “no voice back to chitchat” rule and safe fallbacks.
 */

import type {
  AiReplyMeta,
  ParsedAiReply,
  WaiterIntent,
  WaiterSuggestion,
  WaiterUiAction,
  WaiterUiContext,
  WsInboundMessage,
} from '../types/waiter-intents';

/* ----------------------------- Normalization ------------------------------ */

/** Sanitize any raw string into a supported WaiterIntent. */
export function normalizeIntent(raw?: unknown): WaiterIntent {
  const v = String(raw ?? '').trim().toLowerCase();

  // existing canonical intents
  if (v === 'suggestions') return 'suggestions';
  if (v === 'order' || v === 'ordering' || v === 'cart' || v === 'checkout') return 'order';
  if (v === 'menu' || v === 'see_menu' || v === 'browse') return 'menu';
  if (v === 'chitchat' || v === 'smalltalk' || v === 'general') return 'chitchat';

  // 🔧 map backend variants → canonical intents
  // deterministic server path (treat availability like chitchat so it doesn't open tray)
  if (v === 'availability_check' || v === 'availability') return 'chitchat';

  // model variants
  if (v === 'menu_inquiry' || v === 'menuinquiry' || v === 'menu_query') return 'menu';
  if (v === 'recommendation' || v === 'recommendations' || v === 'recommend' || v === 'recs')
    return 'suggestions';

  // unknown → safe default
  return 'chitchat';
}

/**
 * Heuristic local intent (only used if the server meta.intent is missing).
 * Keep lightweight and language-agnostic where possible.
 */
export function localHeuristicIntent(text: string): WaiterIntent {
  const t = (text || '').toLowerCase();

  // Ordering cues
  if (
    /\b(order|add|buy|cart|checkout)\b/.test(t) ||
    /\b(\d+|one|two|three)\b\s*(pcs|piece|burger|pizza|drink|biriyani|biryani|kebab|shawarma)/.test(t)
  ) {
    return 'order';
  }

  // Menu browse cues
  if (
    /\b(menu|what.?s in your menu|show.*menu|see.*menu|browse)\b/.test(t) ||
    /মেনু/.test(t) // "menu" in Bangla script
  ) {
    return 'menu';
  }

  // Suggestion cues
  if (
    /\b(suggest|recommend|special|best|popular|signature|combo)\b/.test(t) ||
    /সাজেস্ট|সাজেশন|রেকমেন্ড/.test(t)
  ) {
    return 'suggestions';
  }

  return 'chitchat';
}

/** Parse an `ai_reply` WS message into a strongly-typed structure. */
export function parseAiReply(msg: WsInboundMessage): ParsedAiReply | null {
  if (msg.t !== 'ai_reply') return null;
  const meta: AiReplyMeta = msg.meta ?? {};
  const replyText = (msg.replyText || '').trim();

  // 🔒 Safety net: if items[] present, treat as 'order' even if intent is missing/odd.
  const hasItems =
    Array.isArray((meta as any).items) && ((meta as any).items as unknown[]).length > 0;

  const intent = normalizeIntent(meta.intent ?? (hasItems ? 'order' : localHeuristicIntent(replyText)));

  const suggestions = Array.isArray(meta.suggestions)
    ? (meta.suggestions as WaiterSuggestion[])
    : [];

  return {
    text: replyText,
    intent,
    suggestions,
    meta,
  };
}

/* --------------------------------- Rules ---------------------------------- */

/**
 * The “no voice back to chitchat” rule is enforced here.
 * We also allow escalation (suggestions → order/menu) and redirection to menu.
 *
 * Context transitions (voice-driven):
 * - home:
 *    suggestions → openSuggestions
 *    order       → openTray
 *    menu        → goMenu
 *    chitchat    → stay
 * - suggestions:
 *    suggestions → stay (update within modal)
 *    order       → openTray
 *    menu        → goMenu
 *    chitchat    → stay (NO voice-back to home)
 * - tray:
 *    order       → stay (cart interactions continue)
 *    suggestions → openSuggestions (user might ask for recs mid-checkout)
 *    menu        → goMenu
 *    chitchat    → stay (NO voice-back to home)
 * - menu:
 *    menu        → stay (already there)
 *    order       → openTray (ordering from menu details)
 *    suggestions → openSuggestions (ask for recs while browsing)
 *    chitchat    → stay (NO voice-back to home)
 */
export function decideNextAction(
  current: WaiterUiContext,
  intent: WaiterIntent,
): WaiterUiAction {
  switch (current) {
    case 'home': {
      if (intent === 'suggestions') return 'openSuggestions';
      if (intent === 'order') return 'openTray';
      if (intent === 'menu') return 'goMenu';
      return 'stay'; // chitchat
    }
    case 'suggestions': {
      if (intent === 'order') return 'openTray';
      if (intent === 'menu') return 'goMenu';
      return 'stay'; // suggestions | chitchat
    }
    case 'tray': {
      if (intent === 'menu') return 'goMenu';
      if (intent === 'suggestions') return 'openSuggestions';
      return 'stay'; // order | chitchat
    }
    case 'menu': {
      if (intent === 'order') return 'openTray';
      if (intent === 'suggestions') return 'openSuggestions';
      return 'stay'; // menu | chitchat
    }
  }
}

/**
 * Helper that applies both parsing & routing to an inbound message.
 * Returns `null` if the message is not ai_reply; otherwise an action decision.
 */
export function routeFromAiReply(
  msg: WsInboundMessage,
  current: WaiterUiContext,
): { action: WaiterUiAction; parsed: ParsedAiReply } | null {
  const parsed = parseAiReply(msg);
  if (!parsed) return null;
  return {
    action: decideNextAction(current, parsed.intent),
    parsed,
  };
}

/* ------------------------------ Convenience ------------------------------- */

/** True if we should keep responding inside a modal (no voice pop-back). */
export function lockContextForVoice(current: WaiterUiContext): boolean {
  // Only "home" is allowed to float; modals and /menu are voice-locked.
  return current === 'suggestions' || current === 'tray' || current === 'menu';
}

/** Simple priority comparator you can use if multiple intents are inferred locally. */
export function compareIntentPriority(a: WaiterIntent, b: WaiterIntent): number {
  const order: WaiterIntent[] = ['menu', 'order', 'suggestions', 'chitchat'];
  return order.indexOf(a) - order.indexOf(b);
}