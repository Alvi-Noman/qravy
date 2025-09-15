// apps/client-dashboard/src/pages/settings/Billing.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PencilSquareIcon,
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import {
  getPlan,
  getUpcomingInvoiceEstimate,
  listPaymentMethods,
  listInvoices,
  type PlanState,
  type PaymentMethod,
  type Invoice,
  type BillingProfile,
} from '../../api/billing';

// IMPORTANT: Match the actual folder casing on disk to satisfy
// forceConsistentCasingInFileNames. Here we use "components/billing".
import AddCardModal from '../../components/billing/AddCardModal';
import BillingProfileModal from '../../components/billing/BillingProfileModal';

type Tab = 'all' | 'paid' | 'unpaid';

export default function SettingsBilling(): JSX.Element {
  const [loading, setLoading] = useState(true);

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [estimate, setEstimate] = useState<{ amountDue: number; currency: string } | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Popups
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [{ plan }, m, inv] = await Promise.all([getPlan(), listPaymentMethods(), listInvoices()]);
      if (!mounted) return;

      setPlan(plan);
      setMethods(m);
      // newest first
      setInvoices(inv.sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt)));

      const est = await getUpcomingInvoiceEstimate(plan);
      if (!mounted) return;
      setEstimate({ amountDue: est.amountDue, currency: est.currency });
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const defaultPM = useMemo(
    () => methods.find((m) => m.isDefault) || methods[0] || null,
    [methods]
  );

  const daysUntilRenewal = useMemo(() => {
    if (!plan) return null;
    const ms = new Date(plan.renewsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }, [plan]);

  // Filter rows for table
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = invoices;
    if (tab === 'paid') rows = rows.filter((i) => i.status === 'paid');
    if (tab === 'unpaid') rows = rows.filter((i) => i.status === 'open' || i.status === 'uncollectible');

    if (q) {
      rows = rows.filter(
        (i) =>
          i.number.toLowerCase().includes(q) ||
          new Date(i.issuedAt).toLocaleDateString().toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [invoices, tab, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    // reset to page 1 on filter/search change
    setPage(1);
  }, [tab, query]);

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="h-12 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-56 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-96 animate-pulse rounded-xl border border-[#ececec] bg-white" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold text-slate-900">Billing</div>
        <button
          onClick={() => setProfileOpen(true)}
          className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
        >
          Billing profile
        </button>
      </div>

      {/* Upcoming bill */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="text-[13px] font-medium text-slate-900">Upcoming bill</div>
            <div className="flex items-end gap-1">
              <div className="text-2xl font-semibold text-slate-900">
                {estimate ? formatCurrency(estimate.amountDue, estimate.currency) : '$0.00'}
              </div>
              <div className="pb-1 text-[12px] font-medium text-slate-500">{estimate?.currency?.toUpperCase() || 'USD'}</div>
            </div>
            <div className="text-[13px] text-slate-600">
              Next bill in {daysUntilRenewal ?? '—'} days or when your $200 USD threshold is reached. You have $200 remaining.
            </div>
          </div>
          <a href="#" className="text-[12px] text-slate-700 underline">
            View bill
          </a>
        </div>

        {/* Default payment method card */}
        <div className="mt-4 rounded-md border border-[#e2e2e2] bg-white p-3">
          {defaultPM ? (
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-3">
                <span className="inline-flex items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                  {defaultPM.brand.toUpperCase()}
                </span>
                <div className="text-[13px] text-slate-800">
                  {defaultPM.brand.charAt(0).toUpperCase() + defaultPM.brand.slice(1)} •••• {defaultPM.last4}
                </div>
              </div>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-[#e2e2e2] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
                onClick={() => setAddOpen(true)}
              >
                <PencilSquareIcon className="h-4 w-4" />
                Edit
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-slate-700">No default payment method.</div>
              <button
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[12px] hover:bg-slate-50"
                onClick={() => setAddOpen(true)}
              >
                Add card
              </button>
            </div>
          )}
        </div>

        {/* Tinted footer row inside the card */}
        <div className="mt-4 -mx-4 -mb-4 rounded-b-xl border-t border-[#e5e5e5] bg-[#f6f6f6] px-4 py-3 text-[13px] text-slate-700">
          To make changes to your plan,{' '}
          <Link to="/settings/plan" className="text-slate-900 underline">
            visit plan settings
          </Link>
          .
        </div>
      </div>

      {/* Past bills */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="text-[13px] font-medium text-slate-900">Past bills</div>
        <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-40 rounded-md border border-[#e2e2e2] pl-7 pr-2 py-1.5 text-[12px] focus:outline-none"
              />
            </div>
            <button className="rounded-md border border-[#e2e2e2] bg-white p-1.5 hover:bg-slate-50" title="Filters">
              <AdjustmentsHorizontalIcon className="h-4 w-4 text-slate-600" />
            </button>
            <button
              className="rounded-md border border-[#e2e2e2] bg-white p-1.5 hover:bg-slate-50"
              onClick={async () => {
                const inv = await listInvoices();
                setInvoices(inv.sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt)));
              }}
              title="Refresh"
            >
              <ArrowPathIcon className="h-4 w-4 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 inline-flex rounded-lg border border-[#e2e2e2] p-0.5">
          {([
            { key: 'all', label: 'All' },
            { key: 'paid', label: 'Paid' },
            { key: 'unpaid', label: 'Unpaid' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-[12px] ${
                tab === t.key ? 'bg-[#2e2e30] text-white' : 'text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[12px] text-slate-600">
              <tr>
                <th className="w-8 py-2 pl-2">
                  <input type="checkbox" aria-label="Select all" />
                </th>
                <th className="py-2">Bill number</th>
                <th className="py-2">Date issued</th>
                <th className="py-2">Bill reason</th>
                <th className="py-2">Bill total</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[13px]">
              {pageRows.map((inv) => (
                <tr key={inv.id}>
                  <td className="w-8 py-2 pl-2">
                    <input type="checkbox" aria-label={`Select ${inv.number}`} />
                  </td>
                  <td className="py-2">{inv.number}</td>
                  <td className="py-2">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                  <td className="py-2">Billing cycle ended</td>
                  <td className="py-2">{formatCurrency(inv.amountDue, inv.currency)}</td>
                  <td className="py-2">
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[13px] text-slate-600">
                    No bills found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[12px] text-slate-600">
            Showing {(filtered.length === 0 ? 0 : (page - 1) * pageSize + 1)}–
            {Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </div>
          <div className="inline-flex items-center gap-2">
            <button
              className="rounded-md border border-[#e2e2e2] bg-white px-2 py-1.5 text-[12px] disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              ‹
            </button>
            <button
              className="rounded-md border border-[#e2e2e2] bg-white px-2 py-1.5 text-[12px] disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* Popups */}
      <AddCardModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(pm) => setMethods((prev) => [...prev, pm])}
      />
      <BillingProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={(p: BillingProfile) => {
          // Surface profile data on page if needed
          void p;
        }}
      />
    </div>
  );
}

/* Helpers */

function formatCurrency(cents: number, currency = 'usd'): string {
  const code = currency.toUpperCase();
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format((cents || 0) / 100);
}

function StatusBadge({ status }: { status: Invoice['status'] }) {
  const label =
    status === 'paid' ? 'Paid' : status === 'open' ? 'Open' : status === 'uncollectible' ? 'Failed' : 'Void';
  const cls =
    status === 'paid'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'open'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : status === 'uncollectible'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}