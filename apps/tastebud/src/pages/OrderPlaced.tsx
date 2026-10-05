// apps/tastebud/src/pages/OrderPlaced.tsx
// Legacy "/order/placed" → the guest's latest order (or the waiter if there is none).
import { Navigate, useParams } from 'react-router-dom';
import { recentOrders } from '../api/orders';
import { orderPath, storeBasePath } from '../utils/checkout-flow';
import { withTable } from '../utils/table';

export default function OrderPlaced() {
  const { subdomain, branchSlug, branch } = useParams<{ subdomain?: string; branchSlug?: string; branch?: string }>();
  const sub = subdomain ?? (typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : null);
  const br = branchSlug ?? branch ?? null;
  const last = recentOrders(sub)[0];
  return <Navigate replace to={withTable(last ? orderPath(last.token, sub, br) : storeBasePath(sub, br) || '/', sub)} />;
}
