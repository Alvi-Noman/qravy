// apps/tastebud/src/utils/checkout-flow.ts
// What the storefront does with the waiter's checkout decisions (shared by every mic on the site):
//   showCheckout / askTable  → open the checkout page (read-back + Confirm button + mic for "yes")
//   orderPlaced              → clear the cart, remember the order, open its live status page
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { rememberOrder } from '../api/orders';

function storeHint(k: 'subdomain' | 'branch'): string | null {
  return typeof window !== 'undefined' ? ((window as any).__STORE__?.[k] ?? null) : null;
}

/** Base path for this restaurant: "/t/<sub>(/<branch>)" in dev, "" (or "/<branch>") on its own host. */
export function storeBasePath(sub?: string | null, branch?: string | null): string {
  const onTenantHost =
    typeof window !== 'undefined' && !window.location.pathname.startsWith('/t/') && !!storeHint('subdomain');
  const b = branch ? `/${encodeURIComponent(branch)}` : '';
  if (onTenantHost) return b;
  return `/t/${encodeURIComponent(sub || storeHint('subdomain') || 'demo')}${b}`;
}

export const checkoutPath = (sub?: string | null, branch?: string | null) =>
  `${storeBasePath(sub, branch)}/checkout`;

export const orderPath = (token: string, sub?: string | null, branch?: string | null) =>
  `${storeBasePath(sub, branch)}/order/${encodeURIComponent(token)}`;

export function useCheckoutFlow(
  sub?: string | null,
  branch?: string | null,
  opts?: { openTray?: (askTable: boolean) => void },
) {
  const navigate = useNavigate();
  const { clear } = useCart();

  /** Returns true when the reply was a checkout step and has been handled (skip the other routing). */
  return useCallback(
    (meta: any): boolean => {
      const d = meta?.decision || {};
      const order = meta?.order;
      if (d.orderPlaced && order?.token) {
        clear({ silent: true });
        rememberOrder(sub, order);
        navigate(orderPath(order.token, sub, branch), { state: { justPlaced: true } });
        return true;
      }
      if (d.showCheckout || d.askTable) {
        // the tray is the checkout: open it (and point at the table field when the waiter asked for it)
        if (opts?.openTray) {
          opts.openTray(!!d.askTable);
          return true;
        }
        const target = checkoutPath(sub, branch);
        if (typeof window === 'undefined' || window.location.pathname !== target) {
          navigate(target + (typeof window !== 'undefined' ? window.location.search : ''));
        }
        return true;
      }
      return false;
    },
    [branch, clear, navigate, sub, opts],
  );
}
