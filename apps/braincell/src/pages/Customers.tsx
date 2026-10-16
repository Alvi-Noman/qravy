// apps/braincell/src/pages/Customers.tsx — Customers: everyone who ordered online. Delivery guests with their name,
// phone and address; pickup guests with name and phone. One row per phone number, newest order first, with how many
// orders and how much they've spent (cancelled orders don't count). Dine-in guests give no details and aren't listed.
import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowPathIcon, MagnifyingGlassIcon, PhoneIcon, UsersIcon } from '@heroicons/react/24/outline';
import PageFrame, { HEADER_BUTTON } from '../components/PageFrame';
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
    <PageFrame
      title="Customers"
      badge={
        data.data ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{total}</span>
        ) : null
      }
      actions={
        <button type="button" onClick={() => void data.refetch()} className={HEADER_BUTTON} aria-label="Refresh">
          <ArrowPathIcon className={`h-4 w-4 ${data.isFetching ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#6b6b70]">Everyone who ordered online — delivery and pickup. Saved automatically with every order.</p>
        <label className="relative w-full max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9a9aa0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone or address"
            aria-label="Search customers"
            className="w-full rounded-md border border-[#e2e2e2] bg-white py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      {data.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-[#f6f6f6]" />
      ) : data.isError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load customers.</p>
      ) : !items.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#e2e2e2] bg-white px-6 py-16 text-center">
          <UsersIcon className="mb-3 h-10 w-10 text-slate-300" />
          <div className="font-semibold text-[#2e2e30]">{query ? 'No customer matches' : 'No customers yet'}</div>
          <p className="mt-1 max-w-sm text-sm text-[#6b6b70]">
            {query
              ? 'Try a name, a phone number or part of an address.'
              : 'Guests who order for delivery or pickup are saved here with their first order — name and phone, and the address for delivery.'}
          </p>
        </div>
      ) : (
        <>
          {/* one row per customer — wraps on a narrow screen instead of cutting columns off */}
          <ul className="divide-y divide-[#f0f0f0] overflow-hidden rounded-lg border border-[#ececec] bg-white">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3">
                <div className="min-w-[170px] flex-1">
                  <div className="font-medium text-[#2e2e30]">{c.name}</div>
                  <a href={`tel:${c.phone}`} className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-xs text-[#6b6b70] hover:underline">
                    <PhoneIcon className="h-3 w-3" />
                    {c.phone}
                  </a>
                </div>
                <div className="min-w-[200px] flex-[1.4] text-[#4a4a4f]">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa0]">Delivery address</div>
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
                    <div className="text-xs text-[#9a9aa0]">Pickup only</div>
                  )}
                </div>
                <div className="flex gap-6">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa0]">Orders</div>
                    <div className="font-medium text-[#2e2e30]">{c.orders}</div>
                    <Kind c={c} />
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa0]">Spent</div>
                    <div className="whitespace-nowrap font-medium text-[#2e2e30]">{money(c.spent)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa0]">Last order</div>
                    <div className="whitespace-nowrap text-[#2e2e30]">{day(c.lastOrderAt)}</div>
                    <div className="whitespace-nowrap text-xs text-[#9a9aa0]">since {day(c.firstOrderAt)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between text-sm text-[#6b6b70]">
            <span>
              {page * PAGE + 1}–{page * PAGE + items.length} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-[#cecece] bg-white px-3 py-1.5 text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={(page + 1) * PAGE >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-[#cecece] bg-white px-3 py-1.5 text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </PageFrame>
  );
}
