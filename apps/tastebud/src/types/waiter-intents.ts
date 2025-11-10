/**
 * Intent & message types shared across the AI Waiter UI.
 * Keep this file dependency-free so it can be imported everywhere (pages, utils, components).
 */

/* -------------------------------------------------------------------------- */
/*                                    Core                                    */
/* -------------------------------------------------------------------------- */

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
  /** Human-readable resolved name. */
  name: string;
  /** Canonical menu item id (preferred). */
  itemId?: string;
  /** Quantity requested (defaults to 1 if missing). */
  quantity?: number;
  /** Optional price hint for this item. */
  price?: number;
};

/* -------------------------------------------------------------------------- */
/*                          Voice-driven cart controls                        */
/* -------------------------------------------------------------------------- */

/**
 * Allowed cart operation types from the brain.
 *
 * - add    → add or increment line
 * - set    → set absolute quantity (0 → remove)
 * - inc    → increment quantity
 * - dec    → decrement quantity
 * - remove → remove specific line
 * - clear  → clear all items
 */
export type VoiceCartOpType = 'add' | 'set' | 'remove' | 'inc' | 'dec' | 'clear';

/**
 * One voice cart operation; interpreted client-side by voice-cart.ts.
 * This is intentionally duck-typed & tolerant.
 */
export type VoiceCartOp = {
  type?: VoiceCartOpType;

  /** Target by id (preferred) */
  itemId?: string;
  id?: string;

  /** Or by name/alias (resolved via menu index) */
  name?: string;

  /** Optional variation key for line-level granularity. */
  variation?: string;

  /** Quantity for add/set/inc/dec (defaults depend on op). */
  quantity?: number;

  /** Optional price hint; UI may ignore in favor of catalog. */
  price?: number;
};

/* -------------------------------------------------------------------------- */
/*                              Upsell & decisions                            */
/* -------------------------------------------------------------------------- */

/** Single upsell candidate item. */
export type AiUpsellItem = {
  /** Preferred canonical reference. */
  itemId?: string;
  id?: string;

  /** Display label (title/name). */
  title?: string;
  name?: string;

  /** Optional price hint (same units as menu). */
  price?: number;

  /** Arbitrary passthrough metadata. */
  meta?: Record<string, unknown>;
};

/**
 * Minimal decision contract for UI behaviors the brain can trigger.
 * Extendable; extra keys are allowed via index signature in AiReplyMeta.
 */
export type AiDecision = {
  /** If true, UI should show the upsell tray/modal. */
  showUpsellTray?: boolean;
};

/* -------------------------------------------------------------------------- */
/*                                Reply metadata                              */
/* -------------------------------------------------------------------------- */

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

  /* ---------------------- Voice cart: structured ops ---------------------- */

  /**
   * Fine-grained cart operations for voice-controlled tray/cart.
   * These are interpreted by `applyVoiceCartOps` on the client.
   */
  cartOps?: VoiceCartOp[];

  /**
   * Shortcut: if true, client should clear the whole cart/tray.
   * (Also respected if any `cartOps` entry has type === 'clear'.)
   */
  clearCart?: boolean;

  /* --------------------------- Upsell & decisions ------------------------- */

  /**
   * Optional upsell candidates used by Tray/Suggestions UI.
   * Backends may send either `upsell` or `Upsell`; clients can read both.
   */
  upsell?: AiUpsellItem[];
  Upsell?: AiUpsellItem[];

  /**
   * Optional UI decision bundle (e.g. showUpsellTray).
   * Extend as needed; unknown keys are allowed.
   */
  decision?: AiDecision & Record<string, unknown>;

  /** Allow future-safe passthroughs without type errors. */
  [key: string]: unknown;
};

/* -------------------------------------------------------------------------- */
/*                             WebSocket message IO                           */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*                              UI context machine                            */
/* -------------------------------------------------------------------------- */

/** UI contexts we can be in on the client. */
export type WaiterUiContext = 'home' | 'suggestions' | 'tray' | 'menu';

/** Actions our state machine can decide for the UI. */
export type WaiterUiAction =
  | 'stay'            // remain where we are
  | 'openSuggestions' // show SuggestionsModal
  | 'openTray'        // show TrayModal (order/cart)
  | 'goMenu';         // navigate to /menu

/** Convenience: a normalized payload after parsing an ai_reply. */
export type ParsedAiReply = {
  text: string;
  intent: WaiterIntent;
  suggestions: WaiterSuggestion[];
  meta: AiReplyMeta;
};