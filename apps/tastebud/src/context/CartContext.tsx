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

/* -------------------------------------------------------------------------- */
/*                                Type Definitions                            */
/* -------------------------------------------------------------------------- */

export type Channel = 'dine-in' | 'online';

export type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  variation?: string;
  notes?: string;
  imageUrl?: string;
};

export type AddItemInput = Omit<CartItem, 'qty'> & { qty?: number };

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
  clear: () => void;

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

function getCartSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const key = 'tastebud:cartSessionId';
  let sid = window.localStorage.getItem(key);
  if (!sid) {
    sid = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(key, sid);
  }
  return sid;
}

/* -------------------------------------------------------------------------- */
/*                                   Reducer                                  */
/* -------------------------------------------------------------------------- */

type Action =
  | { type: 'HYDRATE'; payload: CartItem[]; now: number }
  | { type: 'ADD'; payload: AddItemInput & { qty: number }; now: number }
  | { type: 'DEL'; payload: { id: string; variation?: string }; now: number }
  | { type: 'SET_QTY'; payload: { id: string; qty: number; variation?: string }; now: number }
  | { type: 'CLEAR'; now: number };

function sameLine(a: CartItem, b: { id: string; variation?: string }) {
  return a.id === b.id && (a.variation ?? '') === (b.variation ?? '');
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
      const { id, variation, qty } = action.payload;
      const idx = state.items.findIndex((it) => sameLine(it, { id, variation }));
      if (idx >= 0) {
        const next = [...state.items];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
        return withUpdatedAt(next.filter((it) => it.qty > 0), action.now);
      }
      return withUpdatedAt([...state.items, { ...action.payload, qty }], action.now);
    }

    case 'DEL': {
      const next = state.items.filter((it) => !sameLine(it, action.payload));
      return withUpdatedAt(next, action.now);
    }

    case 'SET_QTY': {
      const { id, variation, qty } = action.payload;
      const next = state.items.map((it) =>
        sameLine(it, { id, variation })
          ? { ...it, qty: Math.max(0, qty) }
          : it,
      );
      return withUpdatedAt(
        next.filter((it) => it.qty > 0),
        action.now,
      );
    }

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

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR', now: Date.now() });
  }, []);

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
    clear,

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
