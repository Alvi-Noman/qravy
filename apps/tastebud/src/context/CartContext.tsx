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

export type Channel = 'dine-in' | 'online';

type CartItem = {
  id: string;
  name: string;
  price: number; // unit price in smallest currency unit or decimal (match your API)
  qty: number;
  variation?: string; // e.g., "Large", or "Large | Extra Cheese"
  notes?: string;
  imageUrl?: string;
};

type CartState = {
  items: CartItem[];
};

type AddItemInput = Omit<CartItem, 'qty'> & { qty?: number };

type CartContextValue = {
  items: CartItem[];
  subtotal: number;
  count: number;

  addItem: (item: AddItemInput) => void;
  updateQty: (id: string, delta: number, variation?: string) => void;
  setQty: (id: string, qty: number, variation?: string) => void;
  removeItem: (id: string, variation?: string) => void;
  clear: () => void;

  // Channel handling
  channel: Channel;
  setChannel: (ch: Channel) => void;
  isRestaurantRoute: boolean;

  // Optional restaurant identity (from URL or runtime injection)
  subdomain: string | null;
  branch: string | null;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

/* ------------------------------- URL Helpers ------------------------------ */

function isRestaurantRoutePath(pathname: string): boolean {
  // We consider anything under /t/:subdomain as a restaurant route
  return /^\/t\/[^/]+/.test(pathname);
}

function deriveSubdomain(pathname: string): string | null {
  const m = pathname.match(/^\/t\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : window.__STORE__?.subdomain ?? null;
}

function deriveBranch(pathname: string): string | null {
  const m = pathname.match(/^\/t\/[^/]+\/branch\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : window.__STORE__?.branch ?? null;
}

function deriveChannel(pathname: string): Channel {
  // If path has /dine-in anywhere after /t/:subdomain we treat it as dine-in
  if (/^\/t\/[^/]+\/dine-in/.test(pathname) || /^\/t\/[^/]+\/branch\/[^/]+\/dine-in/.test(pathname)) {
    return 'dine-in';
  }
  // Fallback to runtime injection or default "online"
  return window.__STORE__?.channel === 'dine-in' ? 'dine-in' : 'online';
}

function cartStorageKey(subdomain: string | null, branch: string | null) {
  const sub = subdomain ?? 'anon';
  const br = branch ?? 'default';
  return `tastebud:cart:${sub}:${br}`;
}

/* --------------------------------- Reducer -------------------------------- */

type Action =
  | { type: 'ADD'; payload: AddItemInput & { qty: number } }
  | { type: 'DEL'; payload: { id: string; variation?: string } }
  | { type: 'SET_QTY'; payload: { id: string; qty: number; variation?: string } }
  | { type: 'CLEAR' };

function sameLine(a: CartItem, b: { id: string; variation?: string }) {
  return a.id === b.id && (a.variation ?? '') === (b.variation ?? '');
}

function reducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case 'ADD': {
      const { id, variation, qty } = action.payload;
      const idx = state.items.findIndex((it) => sameLine(it, { id, variation }));
      if (idx >= 0) {
        const next = [...state.items];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
        return { items: next.filter((it) => it.qty > 0) };
      }
      return { items: [...state.items, { ...action.payload, qty }] };
    }
    case 'DEL': {
      return { items: state.items.filter((it) => !sameLine(it, action.payload)) };
    }
    case 'SET_QTY': {
      const { id, variation, qty } = action.payload;
      const next = state.items.map((it) =>
        sameLine(it, { id, variation }) ? { ...it, qty } : it
      );
      return { items: next.filter((it) => it.qty > 0) };
    }
    case 'CLEAR':
      return { items: [] };
    default:
      return state;
  }
}

/* ------------------------------- Provider --------------------------------- */

export function CartProvider({ children }: PropsWithChildren<{}>) {
  const location = useLocation();
  const pathname = location.pathname;

  const isRestaurantRoute = isRestaurantRoutePath(pathname);
  const subdomain = deriveSubdomain(pathname);
  const branch = deriveBranch(pathname);

  // Channel: derived on restaurant route, locally mutable elsewhere
  const derivedChannel = deriveChannel(pathname);
  const [freeChannel, setFreeChannel] = useState<Channel>(
    window.__STORE__?.channel ?? 'online'
  );
  const channel: Channel = isRestaurantRoute ? derivedChannel : freeChannel;

  // Storage key scoped by tenant/branch to avoid cross-bleed
  const storageKey = cartStorageKey(subdomain, branch);

  const initialLoaded = useRef(false);
  const [state, dispatch] = useReducer(reducer, { items: [] });

  // Load from storage once (on key change)
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as CartState;
        if (parsed && Array.isArray(parsed.items)) {
          dispatch({ type: 'CLEAR' });
          // Rehydrate in one pass
          for (const it of parsed.items) {
            dispatch({
              type: 'ADD',
              payload: {
                id: it.id,
                name: it.name,
                price: it.price,
                variation: it.variation,
                notes: it.notes,
                imageUrl: it.imageUrl,
                qty: it.qty,
              },
            });
          }
        }
      } catch {
        // ignore bad JSON
      }
    }
    initialLoaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist to storage
  useEffect(() => {
    if (!initialLoaded.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state, storageKey]);

  /* ------------------------------- API ------------------------------- */

  const addItem = useCallback((input: AddItemInput) => {
    const qty = Math.max(1, input.qty ?? 1);
    dispatch({ type: 'ADD', payload: { ...input, qty } });
  }, []);

  const updateQty = useCallback(
    (id: string, delta: number, variation?: string) => {
      const line = state.items.find((it) => sameLine(it, { id, variation }));
      const next = Math.max(0, (line?.qty ?? 0) + delta);
      dispatch({ type: 'SET_QTY', payload: { id, variation, qty: next } });
    },
    [state.items]
  );

  const setQty = useCallback((id: string, qty: number, variation?: string) => {
    dispatch({ type: 'SET_QTY', payload: { id, variation, qty: Math.max(0, qty) } });
  }, []);

  const removeItem = useCallback((id: string, variation?: string) => {
    dispatch({ type: 'DEL', payload: { id, variation } });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const subtotal = useMemo(
    () => state.items.reduce((sum, it) => sum + it.price * it.qty, 0),
    [state.items]
  );

  const count = useMemo(
    () => state.items.reduce((n, it) => n + it.qty, 0),
    [state.items]
  );

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
      // Only allow manual set outside restaurant routes;
      // inside restaurant routes channel follows the URL.
      if (!isRestaurantRoute) setFreeChannel(ch);
    },
    isRestaurantRoute,

    subdomain,
    branch,
  };

  return <CartContext.Provider value={ctx}>{children}</CartContext.Provider>;
}

/* ---------------------------------- Hook ---------------------------------- */

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
