import { createContext, useContext, useMemo, useState } from 'react';
import type { v1 } from '../../../../packages/shared/src/types';
import type { Channel } from '../api/storefront';

type CartLine = { item: v1.MenuItemDTO; qty: number; variationName?: string };
type CartState = {
  channel: Channel;
  lines: CartLine[];
  setChannel: (c: Channel) => void;
  add: (i: v1.MenuItemDTO, qty?: number, variationName?: string) => void;
  remove: (id: string, variationName?: string) => void;
  clear: () => void;
  subtotal: number;
};

const CartCtx = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [channel, setChannel] = useState<Channel>('dine-in');
  const [lines, setLines] = useState<CartLine[]>([]);

  const add: CartState['add'] = (item, qty = 1, variationName) => {
    setLines((prev) => {
      // do not allow mixing channels with baseline-excluded items
      const visible = channel === 'dine-in' ? item.visibility?.dineIn !== false : item.visibility?.online !== false;
      if (!visible) return prev;
      const key = (l: CartLine) => l.item.id + '|' + (l.variationName ?? '');
      const idx = prev.findIndex((l) => key(l) === item.id + '|' + (variationName ?? ''));
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + qty };
        return copy;
      }
      return [...prev, { item, qty, variationName }];
    });
  };

  const remove: CartState['remove'] = (id, variationName) =>
    setLines((prev) => prev.filter((l) => !(l.item.id === id && (l.variationName ?? '') === (variationName ?? ''))));

  const clear = () => setLines([]);

  const subtotal = useMemo(() => {
    const priceOf = (mi: v1.MenuItemDTO, varName?: string) => {
      if (varName) {
        const v = mi.variations.find((x) => x.name === varName);
        if (typeof v?.price === 'number') return v.price;
      }
      return mi.price ?? 0;
    };
    return lines.reduce((s, l) => s + priceOf(l.item, l.variationName) * l.qty, 0);
  }, [lines]);

  const value = useMemo(() => ({ channel, setChannel, lines, add, remove, clear, subtotal }), [channel, lines, subtotal]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
};
