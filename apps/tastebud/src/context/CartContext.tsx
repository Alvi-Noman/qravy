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

type CartState = { items: CartItem[] };

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

function deriveSubdomain(pathname: string): string | null {
  const m = pathname.match(/^\/t\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : (window as any).__STORE__?.subdomain ?? null;
}

function deriveBranch(pathname: string): string | null {
  const m = pathname.match(/^\/t\/[^/]+\/branch\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : (window as any).__STORE__?.branch ?? null;
}

function deriveChannel(pathname: string): Channel {
  if (/^\/t\/[^/]+\/dine-in/.test(pathname) || /^\/t\/[^/]+\/branch\/[^/]+\/dine-in/.test(pathname)) {
    return 'dine-in';
  }
  return (window as any).__STORE__?.channel === 'dine-in' ? 'dine-in' : 'online';
}

function cartStorageKey(subdomain: string | null, branch: string | null) {
  return `tastebud:cart:${subdomain ?? 'anon'}:${branch ?? 'default'}`;
}

/* -------------------------------------------------------------------------- */
/*                                   Reducer                                  */
/* -------------------------------------------------------------------------- */

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

    case 'DEL':
      return { items: state.items.filter((it) => !sameLine(it, action.payload)) };

    case 'SET_QTY': {
      const { id, variation, qty } = action.payload;
      const next = state.items.map((it) =>
        sameLine(it, { id, variation }) ? { ...it, qty: Math.max(0, qty) } : it
      );
      return { items: next.filter((it) => it.qty > 0) };
    }

    case 'CLEAR':
      return { items: [] };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Provider                                   */
/* -------------------------------------------------------------------------- */

export function CartProvider({ children }: PropsWithChildren<{}>) {
  const location = useLocation();
  const pathname = location.pathname;

  const isRestaurantRoute = isRestaurantRoutePath(pathname);
  const subdomain = deriveSubdomain(pathname);
  const branch = deriveBranch(pathname);

  const derivedChannel = deriveChannel(pathname);
  const [freeChannel, setFreeChannel] = useState<Channel>(
    (window as any).__STORE__?.channel ?? 'online'
  );
  const channel: Channel = isRestaurantRoute ? derivedChannel : freeChannel;

  const storageKey = cartStorageKey(subdomain, branch);

  const initialLoaded = useRef(false);
  const [state, dispatch] = useReducer(reducer, { items: [] });

  /* --------------------------- Load from storage --------------------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CartState;
        if (parsed?.items) {
          dispatch({ type: 'CLEAR' });
          for (const it of parsed.items) {
            dispatch({
              type: 'ADD',
              payload: { ...it, qty: it.qty ?? 1 },
            });
          }
        }
      }
    } catch {
      /* ignore parse errors */
    }
    initialLoaded.current = true;
  }, [storageKey]);

  /* --------------------------- Persist to storage -------------------------- */
  useEffect(() => {
    if (!initialLoaded.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state, storageKey]);

  /* ------------------------------- API methods ----------------------------- */

  const addItem = useCallback((input: AddItemInput) => {
    const qty = Math.max(1, input.qty ?? 1);
    dispatch({ type: 'ADD', payload: { ...input, qty } });
  }, []);

  const updateQty = useCallback(
    (id: string, delta: number, variation?: string) => {
      const line = state.items.find((it) => sameLine(it, { id, variation }));
      const nextQty = Math.max(0, (line?.qty ?? 0) + delta);
      dispatch({ type: 'SET_QTY', payload: { id, variation, qty: nextQty } });
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

  /* --------------------------- Derived computations ------------------------ */

  const subtotal = useMemo(
    () => state.items.reduce((sum, it) => sum + it.price * it.qty, 0),
    [state.items]
  );

  const count = useMemo(
    () => state.items.reduce((n, it) => n + it.qty, 0),
    [state.items]
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
