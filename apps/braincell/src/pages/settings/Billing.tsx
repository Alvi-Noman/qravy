// apps/braincell/src/pages/settings/Billing.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  XMarkIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  getUpcomingInvoiceEstimate,
  listInvoices,
  type Invoice,
} from '../../api/billing';
import { usePlanQuery } from '../../features/billing/hooks/usePlan';
import { getMyTenant } from '../../api/auth';
import api from '../../api/auth';

import BillingProfileModal from '../../components/billing/BillingProfileModal';
import AddCardModal from '../../components/billing/AddCardModal';
import type { BillingProfilePayload } from '../../api/tenant';

type Tab = 'all' | 'paid' | 'unpaid';

type TenantResp = {
  item: {
    hasCardOnFile?: boolean;
    payment?: {
      brand?: string;
      last4?: string;
      expMonth?: number;
      expYear?: number;
    };
  };
};

// Brand helpers for display
const brandIconMap: Record<string, string | null> = {
  visa: '/brands/visa.svg',
  visa_electron: '/brands/visa-electron.svg',
  amex: '/brands/american-express.svg',
  mastercard: '/brands/mastercard.svg',
  discover: '/brands/discover.svg',
  jcb: '/brands/jcb.svg',
  maestro: '/brands/maestro.svg',
  diners: '/brands/cb.svg',
  unionpay: null,
  unknown: null,
};
function brandLabel(brand?: string) {
  const b = (brand || 'unknown').toLowerCase();
  if (b === 'amex') return 'American Express';
  if (b === 'diners') return 'Diners Club';
  if (b === 'jcb') return 'JCB';
  if (b === 'visa_electron') return 'Visa';
  return b.charAt(0).toUpperCase() + b.slice(1);
}
function pad2(n?: number) {
  const v = Number(n || 0);
  return v < 10 ? `0${v}` : String(v);
}

export default function SettingsBilling(): JSX.Element {
  const { data: plan } = usePlanQuery();

  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<{ amountDue: number; currency: string } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tenantPM, setTenantPM] = useState<{ brand?: string; last4?: string; expMonth?: number; expYear?: number } | null>(null);

  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [profileOpen, setProfileOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [inv, tenant] = await Promise.all([listInvoices(), getMyTenant<TenantResp>()]);
      if (!mounted) return;

      setInvoices(inv.sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt)));
      setTenantPM(tenant?.item?.payment ?? null);

      if (plan) {
        const est = await getUpcomingInvoiceEstimate(plan);
        if (!mounted) return;
        setEstimate({ amountDue: est.amountDue, currency: est.currency });
      }

      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [plan]);

  const canRemoveTenantCard = Boolean(tenantPM?.last4);

  const daysUntilRenewal = useMemo(() => {
    if (!plan) return null;
    const ms = new Date(plan.renewsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }, [plan]);

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
    setPage(1);
  }, [tab, query]);

  const refreshTenantPM = async () => {
    const t = await getMyTenant<TenantResp>();
    setTenantPM(t?.item?.payment ?? null);
  };

  const handleRemoveCard = async () => {
    await api.delete('/api/v1/auth/tenants/payment-method');
    await refreshTenantPM();
    setRemoveOpen(false);
  };

  if (loading || !plan) {
    return (
      <div className="grid gap-4 pb-8">
        <div className="h-12 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-56 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-96 animate-pulse rounded-xl border border-[#ececec] bg-white" />
      </div>
    );
  }

  const cardBrand = (tenantPM?.brand || 'unknown').toLowerCase();
  const brandIcon = brandIconMap[cardBrand] || null;
  const prettyBrand = brandLabel(tenantPM?.brand);
  const expText =
    tenantPM?.expMonth && tenantPM?.expYear
      ? `Exp ${pad2(tenantPM.expMonth)}/${String(tenantPM.expYear).slice(-2)}`
      : null;

  return (
    <div className="grid gap-4 pb-8">
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
              <div className="pb-1 text-[12px] font-medium text-slate-500">
                {estimate?.currency?.toUpperCase() || 'USD'}
              </div>
            </div>
            <div className="text-[13px] text-slate-600">
              Next bill in {daysUntilRenewal ?? '—'} days or when your $200 USD threshold is reached. You have $200 remaining.
            </div>
          </div>
          <a href="#" className="text-[12px] text-slate-700 underline">
            View bill
          </a>
        </div>

        {/* Payment method card — strictly tenant card or empty state */}
        <div className="mt-4 rounded-md border border-[#e2e2e2] bg-white p-3">
          {tenantPM?.last4 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex items-center gap-3">
                {brandIcon && (
                  <img
                    src={brandIcon}
                    alt=""
                    aria-hidden="true"
                    className="h-5 w-auto"
                    loading="eager"
                    draggable={false}
                  />
                )}
                {prettyBrand.toLowerCase() !== 'unknown' && (
                  <span className="inline-flex items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                    {prettyBrand.toUpperCase()}
                  </span>
                )}
                <div className="text-[13px] text-slate-800">
                  •••• {tenantPM.last4} {expText ? <span className="text-slate-500">({expText})</span> : null}
                </div>
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-[#e2e2e2] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
                  onClick={() => setCardOpen(true)}
                  title="Change card"
                >
                  Change card
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-[#e2e2e2] bg-white px-2 py-1 text-[12px] text-rose-700 hover:bg-rose-50"
                  onClick={() => setRemoveOpen(true)}
                  disabled={!canRemoveTenantCard}
                  title={canRemoveTenantCard ? 'Remove card' : 'This card is not saved on file'}
                >
                  <TrashIcon className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[13px] text-slate-700">
                No card on file. Add a payment method to keep your service running without interruption.
              </div>
              <button
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[12px] hover:bg-slate-50"
                onClick={() => setCardOpen(true)}
              >
                Add payment method
              </button>
            </div>
          )}
        </div>

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

      {/* Modals */}
      <AddCardModal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        onSaved={async () => {
          await refreshTenantPM();
          setCardOpen(false);
        }}
      />

      <ConfirmRemoveCardModal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={handleRemoveCard}
      />

      <BillingProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={(p: BillingProfilePayload) => {
          void p;
        }}
      />
    </div>
  );
}

/* Remove card confirm modal */
function ConfirmRemoveCardModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e: any) {
      setError(e?.message || 'Failed to remove card. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1120]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#ececec] px-5 py-4">
            <div className="text-[15px] font-semibold text-slate-900">Remove payment method</div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-slate-50">
              <XMarkIcon className="h-5 w-5 text-slate-600" />
            </button>
          </div>
          <div className="px-5 py-5">
            <p className="text-[13px] text-slate-700">
              This will remove the saved card on file for your account. Future charges will fail until you add a new card.
            </p>
            {error && (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                {error}
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-[13px] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirm}
                className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                <TrashIcon className="h-4 w-4" />
                {busy ? 'Removing…' : 'Remove card'}
              </button>
            </div>
          </div>
        </div>
      </div>
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