// apps/braincell/src/components/customers/CustomerProfile.tsx — one customer, opened from the Customers list: their
// numbers (orders, spend, average order), what they order most, their addresses, and every order of theirs — each one
// opens in full right there.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon, PhoneIcon } from '@heroicons/react/24/outline';
import { getCustomer } from '../../api/customers';
import { orderWhere } from '../../api/orders';
import { useBranchLabel } from '../../hooks/useBranchLabel';
import OrderDetail, { STATUS_LABEL } from '../orders/OrderDetail';

const money = (n: number) => `৳${n.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-[#fafafa] p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa0]">{label}</div>
      <div className="mt-0.5 font-semibold text-[#2e2e30]">{value}</div>
      {sub && <div className="text-xs text-[#6b6b70]">{sub}</div>}
    </div>
  );
}

export default function CustomerProfile({ id }: { id: string }) {
  const branchOf = useBranchLabel();
  const [open, setOpen] = useState<string | null>(null);
  const data = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id) });
  const c = data.data;

  if (data.isLoading) return <div className="h-60 animate-pulse rounded-lg bg-[#f6f6f6]" />;
  if (data.isError || !c) return <p className="text-sm text-red-700">Could not load this customer.</p>;

  return (
    <div className="space-y-5 text-sm">
      <div>
        <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-[#6b6b70] hover:underline">
          <PhoneIcon className="h-3.5 w-3.5" />
          {c.phone}
        </a>
        <p className="text-xs text-[#9a9aa0]">Customer since {day(c.firstOrderAt)}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Orders" value={String(c.orders)} sub={[c.deliveries ? `${c.deliveries} delivery` : '', c.pickups ? `${c.pickups} pickup` : ''].filter(Boolean).join(' · ')} />
        <Stat label="Spent" value={money(c.spent)} />
        <Stat label="Average order" value={money(c.averageOrder)} />
        <Stat label="Last order" value={day(c.lastOrderAt)} sub={c.cancelled ? `${c.cancelled} cancelled` : undefined} />
      </div>

      {!!c.favourites.length && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b6b70]">Orders most</h3>
          <div className="flex flex-wrap gap-2">
            {c.favourites.map((f) => (
              <span key={f.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {f.name} <span className="text-slate-500">× {f.qty}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!!c.addresses.length && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b6b70]">Delivery addresses</h3>
          <ul className="space-y-1 text-[#4a4a4f]">
            {c.addresses.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b6b70]">Order history</h3>
        {!c.history.length ? (
          <p className="text-[#6b6b70]">No orders to show.</p>
        ) : (
          <ul className="divide-y divide-[#f0f0f0] rounded-lg border border-[#ececec]">
            {c.history.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === o.id ? null : o.id)}
                  aria-expanded={open === o.id}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[#fafafa]"
                >
                  {open === o.id ? <ChevronDownIcon className="h-4 w-4 shrink-0 text-[#9a9aa0]" /> : <ChevronRightIcon className="h-4 w-4 shrink-0 text-[#9a9aa0]" />}
                  <span className="w-14 shrink-0 font-semibold text-[#2e2e30]">#{o.orderNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[#6b6b70]">
                    {day(o.createdAt)} · {orderWhere(o)} · {o.items.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                  </span>
                  <span className="shrink-0 text-[#2e2e30]">{money(o.total)}</span>
                  <span className={`shrink-0 text-xs ${o.status === 'cancelled' ? 'text-red-600' : 'text-[#9a9aa0]'}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </button>
                {open === o.id && (
                  <div className="border-t border-[#f0f0f0] bg-white px-4 py-4">
                    <OrderDetail order={o} branch={branchOf(o.locationId)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
