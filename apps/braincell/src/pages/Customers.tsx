// apps/braincell/src/pages/Customers.tsx — Customers: everyone who ordered online. Delivery guests with their name,
// phone and address; pickup guests with name and phone. One row per phone number, newest order first, with how many
// orders and how much they've spent (cancelled orders don't count). Dine-in guests give no details and aren't listed.
import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { MagnifyingGlassIcon, PhoneIcon } from '@heroicons/react/24/outline';
import { listCustomers, type Customer } from '../api/customers';
import { useScope } from '../context/ScopeContext';

const PAGE = 50;
const money = (n: number) => `৳${n.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

function Kind({ c }: { c: Customer }) {
  const parts = [c.deliveries ? `${c.deliveries} delivery` : '', c.pickups ? `${c.pickups} pickup` : ''].filter(Boolean);
  return <span className="text-xs text-[#6b6b70]">{parts.join(' · ') || '—'}</span>;
}

export default function Customers() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const { activeLocationId } = useScope();
  useEffect(() => {
    const id = window.setTimeout(() => (setQuery(q.trim()), setPage(0)), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const data = useQuery({
    queryKey: ['customers', query, page, activeLocationId],
    queryFn: () => listCustomers({ q: query || undefined, limit: PAGE, skip: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#2e2e30]">Customers</h1>
          <p className="mt-0.5 text-sm text-[#6b6b70]">
            Everyone who ordered online — delivery and pickup. Saved automatically with every order.
          </p>
        </div>
        <label className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9a9aa0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone or address"
            aria-label="Search customers"
            className="w-72 rounded-md border border-[#e2e2e2] bg-white py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      {data.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-[#f6f6f6]" />
      ) : data.isError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load customers.</p>
      ) : !items.length ? (
        <p className="rounded-lg border border-dashed border-[#e2e2e2] p-10 text-center text-sm text-[#6b6b70]">
          {query ? 'No customer matches.' : 'No customers yet — they appear here with their first delivery or pickup order.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[#ececec] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] text-left text-xs uppercase tracking-wide text-[#6b6b70]">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Delivery address</th>
                  <th className="px-4 py-3">Orders</th>
                  <th className="px-4 py-3 text-right">Spent</th>
                  <th className="px-4 py-3">Last order</th>
                  <th className="px-4 py-3">Customer since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {items.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#2e2e30]">{c.name}</div>
                      <a href={`tel:${c.phone}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-[#6b6b70] hover:underline">
                        <PhoneIcon className="h-3 w-3" />
                        {c.phone}
                      </a>
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-[#4a4a4f]">
                      {c.addresses[0] ? (
                        <>
                          <div className="line-clamp-2">{c.addresses[0]}</div>
                          {c.addresses.length > 1 && (
                            <div className="mt-0.5 text-xs text-[#9a9aa0]" title={c.addresses.slice(1).join('\n')}>
                              +{c.addresses.length - 1} other address{c.addresses.length > 2 ? 'es' : ''}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-[#9a9aa0]">Pickup only</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#2e2e30]">{c.orders}</div>
                      <Kind c={c} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[#2e2e30]">{money(c.spent)}</td>
                    <td className="px-4 py-3 text-[#6b6b70]">{day(c.lastOrderAt)}</td>
                    <td className="px-4 py-3 text-[#6b6b70]">{day(c.firstOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-[#6b6b70]">
            <span>
              {page * PAGE + 1}–{page * PAGE + items.length} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={(page + 1) * PAGE >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
