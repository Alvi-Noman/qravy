// apps/tastebud/src/context/CartContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  PropsWithChildren,
} from 'react';
import { useLocation } from 'react-router-dom';
import { loadCart as apiLoadCart, saveCart as apiSaveCart } from '../api/cart';
import { getStableSessionId } from '../utils/ws';

/* -------------------------------------------------------------------------- */
/*                                Type Definitions                            */
/* -------------------------------------------------------------------------- */

export type Channel = 'dine-in' | 'online';

/** A chosen add-on on a cart line (snapshot of name/price at add time). */
export type CartModifier = {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  price: number;
};

export type CartItem = {
  id: string;
  name: string;
  /** Unit price, including any add-ons */
  price: number;
  qty: number;
  variation?: string;
  modifiers?: CartModifier[];
  notes?: string;
  imageUrl?: string;
};

/** Stable key for the chosen add-ons (order-independent). */
export function modifiersKey(mods?: CartModifier[]): string {
  if (!mods?.length) return '';
  return mods
    .map((m) => `${m.groupId}:${m.optionId}`)
    .sort()
    .join('|');
}

/** Identity of a cart line: same item + variation + add-ons merge into one line. */
export function cartLineKey(it: { id: string; variation?: string; modifiers?: CartModifier[] }): string {
  return `${it.id}::${it.variation ?? ''}::${modifiersKey(it.modifiers)}`;
}

export type AddItemInput = Omit<CartItem, 'qty'> & { qty?: number };

export type CartWarning = {
  lineKey: string;
  itemId: string;
  name: string;
  kind: 'unavailable' | 'diet';
  reason: string;
};

/** What one change did — lines added/changed (keys after) and removed (as they were). */
export type CartChange = {
  id: number;
  at: number;
  added: CartItem[];
  changed: { before: CartItem; after: CartItem }[];
  removed: CartItem[];
  before: CartItem[];
};

/** Diff two trays line by line (null = nothing changed). */
export function diffCart(before: CartItem[], after: CartItem[]): Omit<CartChange, 'id' | 'at'> | null {
  const b = new Map(before.map((it) => [cartLineKey(it), it]));
  const a = new Map(after.map((it) => [cartLineKey(it), it]));
  const added: CartItem[] = [];
  const changed: { before: CartItem; after: CartItem }[] = [];
  const removed: CartItem[] = [];
  a.forEach((it, k) => {
    const old = b.get(k);
    if (!old) added.push(it);
    else if (old.qty !== it.qty || (old.notes ?? '') !== (it.notes ?? '')) changed.push({ before: old, after: it });
  });
  b.forEach((it, k) => {
    if (!a.has(k)) removed.push(it);
  });
  if (!added.length && !changed.length && !removed.length) return null;
  return { added, changed, removed, before };
}

/**
 * CartState is persisted.
 * `updatedAt` is used as TTL marker so voice/cart stays short-lived (~10 minutes).
 */
type CartState = {
  items: CartItem[];
  updatedAt: number | null;
};

export type CartContextValue = {
  items: CartItem[];
  subtotal: number;
  count: number;

  addItem: (item: AddItemInput) => void;
  updateQty: (id: string, delta: number, variation?: string) => void;
  setQty: (id: string, qty: number, variation?: string) => void;
  removeItem: (id: string, variation?: string) => void;
  /** Kitchen note on a line ("less spicy"); empty string clears it */
  setNotes: (id: string, notes: string, variation?: string) => void;
  /** Line-key based updates (needed for lines with add-ons) */
  setLineQty: (lineKey: string, qty: number) => void;
  removeLine: (lineKey: string) => void;
  /** Note on one exact line; empty string clears it */
  setLineNotes: (lineKey: string, notes: string) => void;
  /** Swap one line for an edited version (new size / add-ons / note), keeping its place in the tray */
  replaceLine: (lineKey: string, next: CartItem) => void;
  /** `silent`: no "changed" record / undo offer (e.g. the tray empties because the order was placed) */
  clear: (opts?: { silent?: boolean }) => void;

  /** The last change to the tray (by voice or by tapping) — drives the highlight and the Undo toast */
  lastChange: CartChange | null;
  /** Put the tray back exactly as it was before `lastChange` */
  undoLast: () => void;
  dismissChange: () => void;

  /** Lines the waiter flagged (sold out, allergy/diet clash) — keyed by line key */
  warnings: Record<string, CartWarning>;
  setWarnings: (list: CartWarning[] | undefined | null) => void;

  channel: Channel;
  setChannel: (ch: Channel) => void;
  isRestaurantRoute: boolean;

  subdomain: string | null;
  branch: string | null;
};

/* -------------------------------------------------------------------------- */
/*                                Context Setup                               */
/* -------------------------------------------------------------------------- */

const CartContext = createContext<CartContextValue | undefined>(undefined);

/* ------------------------------- URL Helpers ------------------------------ */

function isRestaurantRoutePath(pathname: string): boolean {
  return /^\/t\/[^/]+/.test(pathname);
}

function deriveSubdomain(pathname: string, search: string): string | null {
  // 1) /t/:subdomain/...
  const m = pathname.match(/^\/t\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);

  // 2) ?subdomain=...
  if (search) {
    try {
      const params = new URLSearchParams(search);
      const fromQuery = params.get('subdomain');
      if (fromQuery) return decodeURIComponent(fromQuery);
    } catch {
      // ignore malformed search
    }
  }

  // 3) window.__STORE__
  if (typeof window !== 'undefined') {
    return (window as any).__STORE__?.subdomain ?? null;
  }

  return null;
}

function deriveBranch(pathname: string, search: string): string | null {
  // 1) /t/:subdomain/branch/:branch
  const m = pathname.match(/^\/t\/[^/]+\/branch\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);

  // 2) ?branch=...
  if (search) {
    try {
      const params = new URLSearchParams(search);
      const fromQuery = params.get('branch');
      if (fromQuery) return decodeURIComponent(fromQuery);
    } catch {
      // ignore malformed search
    }
  }

  // 3) window.__STORE__
  if (typeof window !== 'undefined') {
    return (window as any).__STORE__?.branch ?? null;
  }

  return null;
}

function deriveChannel(pathname: string): Channel {
  if (
    /^\/t\/[^/]+\/dine-in/.test(pathname) ||
    /^\/t\/[^/]+\/branch\/[^/]+\/dine-in/.test(pathname)
  ) {
    return 'dine-in';
  }
  if (typeof window !== 'undefined') {
    return (window as any).__STORE__?.channel === 'dine-in' ? 'dine-in' : 'online';
  }
  return 'online';
}

function cartStorageKey(subdomain: string | null, branch: string | null) {
  return `tastebud:cart:${subdomain ?? 'anon'}:${branch ?? 'default'}`;
}

/* TTL: 10 minutes (in ms) */
const CART_TTL_MS = 10 * 60 * 1000;

/* --------------------------- Session ID helper ---------------------------- */

/** The same id the voice waiter uses, so the waiter's saved-cart fallback sees this cart. */
function getCartSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return getStableSessionId();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Reducer                                  */
/* -------------------------------------------------------------------------- */

type Action =
  | { type: 'HYDRATE'; payload: CartItem[]; now: number }
  | { type: 'ADD'; payload: AddItemInput & { qty: number }; now: number }
  | { type: 'DEL'; payload: { id: string; variation?: string } | { lineKey: string }; now: number }
  | {
      type: 'SET_QTY';
      payload: ({ id: string; variation?: string } | { lineKey: string }) & { qty: number };
      now: number;
    }
  | { type: 'SET_NOTES'; payload: { id: string; variation?: string; notes: string }; now: number }
  | { type: 'SET_LINE_NOTES'; payload: { lineKey: string; notes: string }; now: number }
  | { type: 'REPLACE_LINE'; payload: { lineKey: string; next: CartItem }; now: number }
  | { type: 'REPLACE_ALL'; payload: CartItem[]; now: number }
  | { type: 'CLEAR'; now: number };

/**
 * Matches by line key, by full identity (id + variation + add-ons), or — for voice/legacy
 * callers that only know (id, variation) — any line of that item regardless of add-ons.
 */
function sameLine(
  a: CartItem,
  b: { id: string; variation?: string; modifiers?: CartModifier[] } | { lineKey: string },
) {
  if ('lineKey' in b) return cartLineKey(a) === b.lineKey;
  if (b.modifiers === undefined) {
    // no size given ("remove the kacchi") → any line of that item; a size given → exactly that size
    return a.id === b.id && (b.variation === undefined || (a.variation ?? '') === b.variation);
  }
  return cartLineKey(a) === cartLineKey(b);
}

function withUpdatedAt(items: CartItem[], now: number): CartState {
  return {
    items,
    updatedAt: items.length ? now : null,
  };
}

function reducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case 'HYDRATE': {
      const safeItems = (action.payload || []).filter(
        (it) => it && typeof it.id === 'string' && (it.qty ?? 0) > 0,
      );
      return withUpdatedAt(safeItems, action.now);
    }

    case 'ADD': {
      const { qty } = action.payload;
      // an ADD is a full line identity: no add-ons means "the plain line", not "any line"
      const identity = { ...action.payload, modifiers: action.payload.modifiers ?? [] };
      const idx = state.items.findIndex((it) => sameLine(it, identity));
      if (idx >= 0) {
        const next = [...state.items];
        next[idx] = {
          ...next[idx],
          qty: next[idx].qty + qty,
          ...(action.payload.notes ? { notes: action.payload.notes } : {}),
        };
        return withUpdatedAt(next.filter((it) => it.qty > 0), action.now);
      }
      return withUpdatedAt([...state.items, { ...action.payload, qty }], action.now);
    }

    case 'DEL': {
      const next = state.items.filter((it) => !sameLine(it, action.payload));
      return withUpdatedAt(next, action.now);
    }

    case 'SET_QTY': {
      const { qty } = action.payload;
      const next = state.items.map((it) =>
        sameLine(it, action.payload)
          ? { ...it, qty: Math.max(0, qty) }
          : it,
      );
      return withUpdatedAt(
        next.filter((it) => it.qty > 0),
        action.now,
      );
    }

    case 'SET_NOTES': {
      const { notes } = action.payload;
      const next = state.items.map((it) =>
        sameLine(it, action.payload) ? { ...it, notes: notes.trim() || undefined } : it,
      );
      return withUpdatedAt(next, action.now);
    }

    case 'SET_LINE_NOTES': {
      const { lineKey, notes } = action.payload;
      const next = state.items.map((it) =>
        cartLineKey(it) === lineKey ? { ...it, notes: notes.trim() || undefined } : it,
      );
      return withUpdatedAt(next, action.now);
    }

    case 'REPLACE_LINE': {
      const { lineKey, next } = action.payload;
      const idx = state.items.findIndex((it) => cartLineKey(it) === lineKey);
      if (idx < 0) return state;
      const items = [...state.items];
      // the edited line may now equal another line (Full → Half when a Half exists) → merge them
      const dup = items.findIndex((it, i) => i !== idx && cartLineKey(it) === cartLineKey(next));
      if (dup >= 0) {
        items[dup] = { ...items[dup], qty: items[dup].qty + next.qty };
        items.splice(idx, 1);
      } else {
        items[idx] = next;
      }
      return withUpdatedAt(items.filter((it) => it.qty > 0), action.now);
    }

    case 'REPLACE_ALL':
      return withUpdatedAt(action.payload.filter((it) => it && it.qty > 0), action.now);

    case 'CLEAR':
      return withUpdatedAt([], action.now);

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Provider                                   */
/* -------------------------------------------------------------------------- */

export function CartProvider({ children }: PropsWithChildren<{}>) {
  const location = useLocation();
  const { pathname, search } = location;

  const isRestaurantRoute = isRestaurantRoutePath(pathname);
  const subdomain = deriveSubdomain(pathname, search);
  const branch = deriveBranch(pathname, search);

  const derivedChannel = deriveChannel(pathname);
  const [freeChannel, setFreeChannel] = useState<Channel>(() => {
    if (typeof window !== 'undefined') {
      return (window as any).__STORE__?.channel === 'dine-in' ? 'dine-in' : 'online';
    }
    return 'online';
  });

  const channel: Channel = isRestaurantRoute ? derivedChannel : freeChannel;

  const storageKey = cartStorageKey(subdomain, branch);

  const initialLoaded = useRef(false);
  const cartSessionIdRef = useRef<string | null>(null);

  const [state, dispatch] = useReducer(reducer, {
    items: [],
    updatedAt: null,
  });

  // every change to the tray (voice or tap) is recorded: what was added / changed / removed, and the tray before
  const [lastChange, setLastChange] = useState<CartChange | null>(null);
  const lastChangeRef = useRef<CartChange | null>(null);
  lastChangeRef.current = lastChange;
  const prevItemsRef = useRef<CartItem[] | null>(null);
  const suppressRef = useRef(false);
  const changeIdRef = useRef(0);
  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = state.items;
    if (prev === null || !initialLoaded.current) return; // loading the saved tray isn't a change
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    const d = diffCart(prev, state.items);
    if (d) setLastChange({ ...d, id: ++changeIdRef.current, at: Date.now() });
  }, [state.items]);

  /* --------------------------- Load from storage + API -------------------- */

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const now = Date.now();

      // Ensure we have a stable per-device/session id
      if (typeof window !== 'undefined') {
        cartSessionIdRef.current = getCartSessionId();
      }

      // 1) Local storage baseline
      let localItems: CartItem[] = [];
      let localUpdatedAt: number | null = null;

      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<CartState> | { items: CartItem[] };

          const items = Array.isArray((parsed as any).items)
            ? ((parsed as any).items as CartItem[])
            : [];

          const updatedAt =
            typeof (parsed as any).updatedAt === 'number'
              ? (parsed as any).updatedAt
              : null;

          const isFresh =
            updatedAt !== null ? now - updatedAt <= CART_TTL_MS : true;

          if (items.length && isFresh) {
            localItems = items;
            localUpdatedAt = updatedAt ?? now;
            if (!cancelled) {
              dispatch({
                type: 'HYDRATE',
                payload: items,
                now: localUpdatedAt,
              });
            }
          } else if (!cancelled) {
            dispatch({ type: 'CLEAR', now });
          }
        } else if (!cancelled) {
          dispatch({ type: 'CLEAR', now });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: 'CLEAR', now });
        }
      }

      // 2) Remote cart (Mongo via ai-waiter-service) – only for public restaurant routes with subdomain
      const sessionId = cartSessionIdRef.current;
      if (!subdomain || !sessionId) {
        if (!cancelled) {
          initialLoaded.current = true;
        }
        return;
      }

      try {
        const remote = await apiLoadCart(subdomain, sessionId);

        if (!remote || !Array.isArray(remote.items) || !remote.items.length) {
          if (!cancelled) {
            initialLoaded.current = true;
          }
          return;
        }

        const now2 = Date.now();

        const useRemote =
          remote.items.length > 0 &&
          (localUpdatedAt === null || !localItems.length);

        if (!cancelled && useRemote) {
          const normalized = remote.items as CartItem[];
          // restoring the saved tray isn't a change to show / offer undo for
          // (initialLoaded flips true below, before the change-record effect sees this render)
          suppressRef.current = true;
          dispatch({
            type: 'HYDRATE',
            payload: normalized,
            now: now2,
          });
        }
      } catch {
        // ignore remote errors
      } finally {
        if (!cancelled) {
          initialLoaded.current = true;
        }
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [storageKey, subdomain, branch]);

  /* --------------------------- Persist to storage + API ------------------- */

  useEffect(() => {
    if (!initialLoaded.current) return;

    // Local storage
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // ignore quota / serialization errors
    }

    // Remote (Mongo via ai-waiter-service) – best-effort, only if we have identifiers
    const sessionId =
      cartSessionIdRef.current || getCartSessionId();
    if (!sessionId || !subdomain) {
      return;
    }

    const items = state.items || [];

    // fire-and-forget
    apiSaveCart(subdomain, sessionId, items).catch(() => {
      // ignore errors
    });
  }, [state, storageKey, subdomain, branch]);

  /* ------------------------------- API methods ----------------------------- */

  const addItem = useCallback((input: AddItemInput) => {
    const qty = Math.max(1, input.qty ?? 1);
    dispatch({
      type: 'ADD',
      payload: { ...input, qty },
      now: Date.now(),
    });
  }, []);

  const updateQty = useCallback(
    (id: string, delta: number, variation?: string) => {
      const line = state.items.find((it) => sameLine(it, { id, variation }));
      const nextQty = Math.max(0, (line?.qty ?? 0) + delta);
      dispatch({
        type: 'SET_QTY',
        payload: { id, variation, qty: nextQty },
        now: Date.now(),
      });
    },
    [state.items],
  );

  const setQty = useCallback(
    (id: string, qty: number, variation?: string) => {
      dispatch({
        type: 'SET_QTY',
        payload: { id, variation, qty: Math.max(0, qty) },
        now: Date.now(),
      });
    },
    [],
  );

  const removeItem = useCallback((id: string, variation?: string) => {
    dispatch({
      type: 'DEL',
      payload: { id, variation },
      now: Date.now(),
    });
  }, []);

  const setNotes = useCallback((id: string, notes: string, variation?: string) => {
    dispatch({ type: 'SET_NOTES', payload: { id, variation, notes }, now: Date.now() });
  }, []);

  const setLineQty = useCallback((lineKey: string, qty: number) => {
    dispatch({ type: 'SET_QTY', payload: { lineKey, qty: Math.max(0, qty) }, now: Date.now() });
  }, []);

  const removeLine = useCallback((lineKey: string) => {
    dispatch({ type: 'DEL', payload: { lineKey }, now: Date.now() });
  }, []);

  const clear = useCallback((opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      suppressRef.current = true;
      setLastChange(null);
    }
    dispatch({ type: 'CLEAR', now: Date.now() });
  }, []);

  const setLineNotes = useCallback((lineKey: string, notes: string) => {
    dispatch({ type: 'SET_LINE_NOTES', payload: { lineKey, notes }, now: Date.now() });
  }, []);

  const replaceLine = useCallback((lineKey: string, next: CartItem) => {
    dispatch({ type: 'REPLACE_LINE', payload: { lineKey, next }, now: Date.now() });
  }, []);

  /* ------------------------ change record, undo, warnings ------------------ */

  const undoLast = useCallback(() => {
    const change = lastChangeRef.current;
    if (!change) return;
    suppressRef.current = true; // restoring isn't a new change to offer undo for
    dispatch({ type: 'REPLACE_ALL', payload: change.before, now: Date.now() });
    setLastChange(null);
  }, []);

  const dismissChange = useCallback(() => setLastChange(null), []);

  const [warningList, setWarningList] = useState<CartWarning[]>([]);
  const setWarnings = useCallback((list: CartWarning[] | undefined | null) => {
    if (Array.isArray(list)) setWarningList(list.filter((w) => w && typeof w.lineKey === 'string'));
  }, []);
  const warnings = useMemo(() => {
    const keys = new Set(state.items.map((it) => cartLineKey(it)));
    const out: Record<string, CartWarning> = {};
    for (const w of warningList) if (keys.has(w.lineKey)) out[w.lineKey] = w;
    return out;
  }, [warningList, state.items]);

  /* --------------------------- Derived computations ------------------------ */

  const subtotal = useMemo(
    () => state.items.reduce((sum, it) => sum + it.price * it.qty, 0),
    [state.items],
  );

  const count = useMemo(
    () => state.items.reduce((n, it) => n + it.qty, 0),
    [state.items],
  );

  /* ------------------------------- Context obj ----------------------------- */

  const ctx: CartContextValue = {
    items: state.items,
    subtotal,
    count,

    addItem,
    updateQty,
    setQty,
    removeItem,
    setNotes,
    setLineQty,
    removeLine,
    setLineNotes,
    replaceLine,
    clear,

    lastChange,
    undoLast,
    dismissChange,
    warnings,
    setWarnings,

    channel,
    setChannel: (ch) => {
      if (!isRestaurantRoute) setFreeChannel(ch);
    },
    isRestaurantRoute,

    subdomain,
    branch,
  };

  return <CartContext.Provider value={ctx}>{children}</CartContext.Provider>;
}

/* -------------------------------------------------------------------------- */
/*                                  Hook                                      */
/* -------------------------------------------------------------------------- */

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
