import { ClockIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { toastSuccess } from '../Toaster';

// Dummy starting feed
const initialOrders = [
  { id: 'ORD-1001', time: '5m ago', customer: 'John Doe', items: 3, channel: 'Dine-In', status: 'Pending' },
  { id: 'ORD-1002', time: '12m ago', customer: 'Sarah Miller', items: 2, channel: 'Online', status: 'Preparing' },
  { id: 'ORD-1003', time: '20m ago', customer: 'Mike Adams', items: 4, channel: 'Dine-In', status: 'Ready' },
];

type Order = typeof initialOrders[number];

export default function OrdersActivity({ interactive = false }: { interactive?: boolean }) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);

  const advanceStatus = (id: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: o.status === 'Pending' ? 'Preparing' : o.status === 'Preparing' ? 'Ready' : 'Ready',
            }
          : o
      )
    );
    toastSuccess(`Order ${id} status updated`);
  };

  return (
    <div className="rounded-lg border border-[#ececec] bg-white p-5 shadow-sm">
      <h3 className="mb-4 font-semibold text-[#2e2e30]">Orders Activity</h3>
      <ul className="divide-y divide-[#f0f0f0]">
        {orders.map((order) => (
          <li key={order.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 ring-1 ring-[#ececec]">
                <ShoppingBagIcon className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <div className="font-medium text-[#2e2e30]">{order.customer}</div>
                <div className="text-xs text-[#6b6b70]">
                  {order.items} items — {order.channel}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Status badge */}
              <span
                className={`text-xs px-2 py-1 rounded-md border ${
                  order.status === 'Pending'
                    ? 'bg-yellow-50 text-yellow-600 border-yellow-200'
                    : order.status === 'Preparing'
                    ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {order.status}
              </span>

              {interactive && order.status !== 'Ready' && (
                <button
                  onClick={() => advanceStatus(order.id)}
                  className="text-xs rounded-md border border-[#cecece] px-2 py-1 hover:bg-[#f5f5f5]"
                >
                  Next
                </button>
              )}

              <span className="flex items-center text-xs text-[#9ca3af]">
                <ClockIcon className="mr-1 h-4 w-4" />
                {order.time}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}