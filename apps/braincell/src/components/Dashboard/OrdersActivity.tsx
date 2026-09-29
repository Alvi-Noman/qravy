import { ClockIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toastError, toastSuccess } from '../Toaster';
import { useOrdersLiveOptional } from '../../context/OrdersLiveContext';
import { usePermissions } from '../../context/PermissionsContext';
import { orderWhere, type AdminOrder, type OrderStatus } from '../../api/orders';

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  placed: { to: 'accepted', label: 'Accept' },
  accepted: { to: 'preparing', label: 'Preparing' },
  preparing: { to: 'ready', label: 'Ready' },
  ready: { to: 'completed', label: 'Complete' },
};

const LABEL: Record<OrderStatus, string> = {
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const CHIP: Record<OrderStatus, string> = {
  placed: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  accepted: 'bg-sky-50 text-sky-700 border-sky-200',
  preparing: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-slate-50 text-slate-600 border-slate-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
};

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/** The latest open orders (live). `interactive` adds a one-tap "next step" button. */
export default function OrdersActivity({ interactive = false }: { interactive?: boolean }) {
  const live = useOrdersLiveOptional();
  const { has } = usePermissions();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const orders: AdminOrder[] = [...(live?.orders ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  const advance = async (o: AdminOrder) => {
    const next = NEXT[o.status];
    if (!next || !live) return;
    try {
      await live.setStatus(o.id, next.to);
      toastSuccess(`Order #${o.orderNumber} → ${LABEL[next.to]}`);
    } catch {
      toastError('Could not update the order');
    }
  };

  return (
    <div className="rounded-lg border border-[#ececec] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-[#2e2e30]">Orders Activity</h3>
        <Link to="/orders" className="text-xs text-[#6b6b70] hover:text-[#2e2e30]">
          Open board →
        </Link>
      </div>
      {!orders.length ? (
        <p className="py-6 text-center text-sm text-[#6b6b70]">
          {live?.loading ? 'Loading…' : 'No open orders right now. New dine-in orders appear here instantly.'}
        </p>
      ) : (
        <ul className="divide-y divide-[#f0f0f0]">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 ring-1 ring-[#ececec]">
                  <ShoppingBagIcon className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <div className="font-medium text-[#2e2e30]">
                    #{order.orderNumber} · {orderWhere(order)}
                  </div>
                  <div className="text-xs text-[#6b6b70]">
                    {order.items.reduce((n, l) => n + l.qty, 0)} items — ৳{order.total}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs px-2 py-1 rounded-md border ${CHIP[order.status]}`}>{LABEL[order.status]}</span>

                {interactive && has('orders:update') && NEXT[order.status] && (
                  <button
                    onClick={() => advance(order)}
                    className="text-xs rounded-md border border-[#cecece] px-2 py-1 hover:bg-[#f5f5f5]"
                  >
                    {NEXT[order.status]!.label}
                  </button>
                )}

                <span className="flex items-center text-xs text-[#9ca3af]">
                  <ClockIcon className="mr-1 h-4 w-4" />
                  {ago(order.createdAt, now)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
