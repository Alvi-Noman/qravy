/**
 * Intent & message types shared across the AI Waiter UI.
 * Keep this file dependency-free so it can be imported everywhere (pages, utils, components).
 */

export type WaiterIntent = 'suggestions' | 'order' | 'menu' | 'chitchat';

/** Optional structured suggestion item sent by the brain. */
export type WaiterSuggestion = {
  /** Human-readable title, e.g. "Chicken Masala" or "Spicy combo for two". */
  title: string;
  /** Optional short reason or teaser. */
  subtitle?: string;
  /** (If applicable) Primary menu item id from your catalog. */
  itemId?: string;
  /** Optional category id for grouping. */
  categoryId?: string;
  /** Optional price (minor units or number in BDT — keep consistent app-wide). */
  price?: number;
  /** Arbitrary metadata passthrough from the brain. */
  meta?: Record<string, unknown>;
};

/** ✅ Structured order item coming from the brain. */
export type AiOrderItem = {
  name: string;
  itemId?: string;
  quantity?: number;
  price?: number;
};

/** Meta shape that the server attaches to `ai_reply`. */
export type AiReplyMeta = {
  /** Classified intent for client-side routing. */
  intent?: WaiterIntent;
  /** When intent === 'suggestions', optional list of suggested items. */
  suggestions?: WaiterSuggestion[];
  /** When intent === 'order', optional list of ordered items. */
  items?: AiOrderItem[];
  /** Language hint used by brain (kept loose). */
  lang?: 'bn' | 'en' | string;
  /** Debug/trace fields (pass-throughs). */
  model?: string;
  tenant?: string | null;
  branch?: string | null;
  channel?: string | null;
  conversationId?: string | null;
  userId?: string | null;
  /** Timing/debug fields. */
  timing?: { timeout_s?: number } & Record<string, unknown>;
  /** If brain fell back with an error. */
  error?: string;
  /** Whether the reply is a fallback/apology. */
  fallback?: boolean;
  /** Allow future-safe passthroughs without type errors. */
  [key: string]: unknown;
};

/** WS → Client messages (subset we care about in the waiter flow). */
export type WsInboundMessage =
  | { t: 'ack' }
  | { t: 'stt_partial'; text: string; ts?: number }
  | {
      t: 'stt_final';
      text: string;
      ts?: number;
      segmentStart?: number | null;
      segmentEnd?: number | null;
    }
  | { t: 'ai_reply_pending' }
  | { t: 'ai_reply'; replyText: string; meta?: AiReplyMeta }
  | { t: 'ai_reply_error'; message?: string };

/** Client → WS control messages (hello/end). */
export type WsOutboundMessage =
  | {
      t: 'hello';
      sessionId?: string;
      userId?: string;
      rate?: number;
      ch?: number;
      /** 'bn' | 'en' | 'auto' — the server respects this as an initial hint. */
      lang?: string;
      tenant?: string | null;
      branch?: string | null;
      channel?: string | null;
    }
  | { t: 'end' };

/** UI contexts we can be in on the client. */
export type WaiterUiContext = 'home' | 'suggestions' | 'tray' | 'menu';

/** Actions our state machine can decide for the UI. */
export type WaiterUiAction =
  | 'stay' // remain where we are
  | 'openSuggestions' // show SuggestionsModal
  | 'openTray' // show TrayModal (order/cart)
  | 'goMenu'; // navigate to /menu

/** Convenience: a normalized payload after parsing an ai_reply. */
export type ParsedAiReply = {
  text: string;
  intent: WaiterIntent;
  suggestions: WaiterSuggestion[];
  meta: AiReplyMeta;
};
