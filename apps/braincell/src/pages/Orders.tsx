/**
 * Orders — the live board for dine-in orders (pay at the counter).
 * New → Accepted → Preparing → Ready → Completed, or Cancelled. Updates arrive live; the guest's
 * order page follows every change.
 */
import { useEffect, useMemo, useState } from 'react';
import { BellAlertIcon, BellSlashIcon, ArrowPathIcon, ClockIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { useTenant } from '../hooks/useTenant';
import { useBuzzerAlert } from '../hooks/useBuzzerAlert';
import {
  loadPrintSettings,
  printOrder,
  savePrintSettings,
  type PrintSettings,
  type TicketKind,
} from '../utils/thermalPrint';
import { useOrdersLive } from '../context/OrdersLiveContext';
import { useAuthContext } from '../context/AuthContext';
import { usePermissions } from '../context/PermissionsContext';
import { useScope } from '../context/ScopeContext';
import { listOrders, orderWhere, type AdminOrder, type OrderStatus } from '../api/orders';
import { toastError, toastSuccess } from '../components/Toaster';

const COLUMNS: { status: OrderStatus; title: string; empty: string }[] = [
  { status: 'placed', title: 'New', empty: 'No new orders' },
  { status: 'accepted', title: 'Accepted', empty: 'Nothing accepted' },
  { status: 'preparing', title: 'Preparing', empty: 'Nothing cooking' },
  { status: 'ready', title: 'Ready', empty: 'Nothing waiting' },
];

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  placed: { to: 'accepted', label: 'Accept' },
  accepted: { to: 'preparing', label: 'Start preparing' },
  preparing: { to: 'ready', label: 'Mark ready' },
  ready: { to: 'completed', label: 'Complete' },
};

const STATUS_CHIP: Record<OrderStatus, string> = {
  placed: 'bg-amber-50 text-amber-700 ring-amber-200',
  accepted: 'bg-sky-50 text-sky-700 ring-sky-200',
  preparing: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  completed: 'bg-slate-50 text-slate-600 ring-slate-200',
  cancelled: 'bg-red-50 text-red-600 ring-red-200',
};

const SOURCE_LABEL: Record<AdminOrder['source'], string> = {
  'ai-waiter': 'Virtual waiter',
  menu: 'Menu',
  staff: 'Staff',
};

const money = (n: number) => `৳${new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(n)}`;

function age(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

/** Print what this order needs: the kitchen ticket or the guest's receipt. */
type PrintFn = (o: AdminOrder, kind: TicketKind) => void;

function PrintMenu({ order, onPrint, compact }: { order: AdminOrder; onPrint: PrintFn; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Print order ${order.orderNumber}`}
        title="Print"
        className={`rounded-md border border-[#e2e2e2] text-[#2e2e30] hover:bg-[#fafafa] ${compact ? 'p-1.5' : 'px-2.5 py-2'}`}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-[#ececec] bg-white py-1 text-sm shadow-lg">
          {(
            [
              ['kitchen', 'Kitchen ticket'],
              ['receipt', 'Customer receipt'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onPrint(order, kind);
              }}
              className="block w-full px-3 py-2 text-left text-[#2e2e30] hover:bg-[#f6f6f6]"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-device printer settings: paper width and auto-print for the kitchen screen. */
function PrintSettingsButton({ value, onChange, onTest }: { value: PrintSettings; onChange: (s: PrintSettings) => void; onTest: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-[#fafafa] ${
          value.autoPrint ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-[#e2e2e2] bg-white text-[#2e2e30]'
        }`}
      >
        <PrinterIcon className="h-4 w-4" />
        {value.autoPrint ? 'Auto-print on' : 'Printing'}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-[#ececec] bg-white p-3 text-sm shadow-xl">
          <div className="font-semibold text-[#2e2e30]">Thermal printer</div>
          <p className="mt-0.5 text-xs text-[#6b6b70]">Settings for this device. Pick your thermal printer in the print dialog.</p>
          <div className="mt-3 text-xs font-medium text-[#6b6b70]">Paper width</div>
          <div className="mt-1 flex gap-1 rounded-md bg-[#f1f2f4] p-1" role="radiogroup" aria-label="Paper width">
            {(['80', '58'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={value.paper === p}
                onClick={() => onChange({ ...value, paper: p })}
                className={`flex-1 rounded px-2 py-1 ${value.paper === p ? 'bg-white shadow-sm text-[#2e2e30]' : 'text-[#6b6b70]'}`}
              >
                {p} mm
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.autoPrint}
              onChange={(e) => onChange({ ...value, autoPrint: e.target.checked })}
            />
            <span>
              <span className="font-medium text-[#2e2e30]">Auto-print new orders</span>
              <span className="block text-xs text-[#6b6b70]">A kitchen ticket prints the moment an order comes in.</span>
            </span>
          </label>
          {value.autoPrint && (
            <label className="mt-2 flex items-start gap-2 pl-5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.autoPrintReceipt}
                onChange={(e) => onChange({ ...value, autoPrintReceipt: e.target.checked })}
              />
              <span className="text-[#2e2e30]">Also print the customer receipt</span>
            </label>
          )}
          <p className="mt-3 rounded-md bg-[#f6f6f6] p-2 text-[11px] text-[#6b6b70]">
            To print without the dialog on a kitchen computer, open Chrome with <code>--kiosk-printing</code> and set the
            thermal printer as the default.
          </p>
          <div className="mt-3 flex justify-between">
            <button type="button" onClick={onTest} className="text-xs text-[#2e2e30] underline-offset-2 hover:underline">
              Print a test ticket
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-[#2e2e30] px-3 py-1 text-xs text-white">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Wait-time strip: when this ticket is due, a bar that fills as time runs out, and ±5 min for the kitchen
 * (the guest's countdown moves with it). Before the order is accepted there's no clock — just how long it
 * will take once it is.
 */
function EtaStrip({
  order,
  now,
  canUpdate,
  onAdjust,
}: {
  order: AdminOrder;
  now: number;
  canUpdate: boolean;
  onAdjust: (o: AdminOrder, minutes: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const eta = order.eta;
  if (order.status === 'ready') {
    const readyAt = order.statusHistory.find((h) => h.status === 'ready')?.at;
    const mins = readyAt ? Math.floor((now - new Date(readyAt).getTime()) / 60000) : 0;
    return (
      <div className={`mt-3 rounded-md px-2.5 py-1.5 text-xs ${mins >= 5 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
        {order.channel === 'online'
          ? order.fulfillment === 'delivery'
            ? mins < 1 ? 'Ready — send it out now' : `Ready ${mins} min ago — waiting to go out`
            : mins < 1 ? 'Ready — waiting for pickup' : `Ready ${mins} min ago — waiting for pickup`
          : mins < 1 ? 'Ready — serve it now' : `Ready ${mins} min ago — waiting to be served`}
      </div>
    );
  }
  if (!eta) return null;

  const waiting = order.status === 'placed';
  const estimate = eta.estimateMinutes ?? eta.prepMinutes + eta.queueMinutes + Math.max(0, eta.adjustedMinutes);
  const due = new Date(eta.readyAt).getTime();
  // the clock started when the order was accepted (or went straight to cooking), and cooking restarts it
  const startIso =
    order.statusHistory.find((h) => h.status === order.status && (h.status === 'accepted' || h.status === 'preparing'))?.at ??
    order.createdAt;
  const start = new Date(startIso).getTime();
  const left = waiting ? estimate : Math.ceil((due - now) / 60000);
  const late = !waiting && left < 0;
  const pct = Math.min(100, Math.max(4, ((now - start) / Math.max(1, due - start)) * 100));
  const adjust = async (m: number) => {
    setBusy(true);
    try {
      await onAdjust(order, m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 font-medium ${late ? 'text-red-600' : left <= 3 ? 'text-amber-700' : 'text-[#2e2e30]'}`}>
          <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {waiting ? (
            <>
              ~{estimate} min
              <span className="font-normal text-[#6b6b70]">· clock starts when accepted</span>
            </>
          ) : (
            <>
              {late ? `${-left} min late` : left <= 0 ? 'Due now' : `Due in ${left} min`}
              <span className="font-normal text-[#6b6b70]">· {clock(eta.readyAt)}</span>
            </>
          )}
        </span>
        {canUpdate && (
          <span className="inline-flex overflow-hidden rounded-md border border-[#e2e2e2]">
            <button
              type="button"
              disabled={busy || left <= 1}
              onClick={() => adjust(-5)}
              className="px-2 py-0.5 text-[#6b6b70] hover:bg-[#fafafa] disabled:opacity-40"
              aria-label={`Order ${order.orderNumber}: 5 minutes sooner`}
            >
              −5
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => adjust(5)}
              className="border-l border-[#e2e2e2] px-2 py-0.5 text-[#2e2e30] hover:bg-[#fafafa] disabled:opacity-40"
              aria-label={`Order ${order.orderNumber}: 5 more minutes`}
              title="Needs longer — the guest's countdown updates"
            >
              +5
            </button>
          </span>
        )}
      </div>
      {!waiting && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f0f0f0]" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${late ? 'bg-red-500' : left <= 3 ? 'bg-amber-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {eta.adjustedMinutes !== 0 && !waiting && (
        <div className="mt-1 text-[11px] text-[#6b6b70]">
          {eta.adjustedMinutes > 0 ? `+${eta.adjustedMinutes}` : eta.adjustedMinutes} min by staff · promised {clock(eta.promisedReadyAt)}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  now,
  canUpdate,
  onMove,
  onAdjust,
  onPrint,
}: {
  order: AdminOrder;
  now: number;
  canUpdate: boolean;
  onMove: (o: AdminOrder, to: OrderStatus) => Promise<void>;
  onAdjust: (o: AdminOrder, minutes: number) => Promise<void>;
  onPrint: PrintFn;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const next = NEXT[order.status];
  const waitingMins = (now - new Date(order.createdAt).getTime()) / 60000;
  const isNew = order.status === 'placed';

  const move = async (to: OrderStatus) => {
    setBusy(true);
    try {
      await onMove(order, to);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  return (
    <article
      className={`rounded-lg border bg-white p-4 shadow-sm ${
        isNew ? 'border-amber-300 ring-2 ring-amber-100' : 'border-[#ececec]'
      }`}
      aria-label={`Order ${order.orderNumber}, ${orderWhere(order)}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold text-[#2e2e30]">#{order.orderNumber}</div>
          {order.channel === 'online' ? (
            <div className="text-sm text-[#2e2e30]">
              <span
                className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  order.fulfillment === 'delivery' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'
                }`}
              >
                {orderWhere(order)}
              </span>
              <span className="font-semibold">{order.customer?.name}</span>
              {order.customer?.phone && (
                <a href={`tel:${order.customer.phone}`} className="block text-xs text-[#6b6b70] hover:underline">
                  {order.customer.phone}
                </a>
              )}
              {order.fulfillment === 'delivery' && order.customer?.address && (
                <div className="mt-0.5 text-xs text-[#6b6b70]">{order.customer.address}</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-[#2e2e30]">
              Table <span className="font-semibold">{order.table}</span>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-xs ${isNew && waitingMins >= 5 ? 'font-semibold text-red-600' : 'text-[#6b6b70]'}`}>
            {age(order.createdAt, now)}
          </div>
          <div className="mt-1 text-[11px] text-[#6b6b70]">{SOURCE_LABEL[order.source] ?? order.source}</div>
        </div>
      </header>
      <div className="mt-2 flex justify-end">
        <PrintMenu order={order} onPrint={onPrint} compact />
      </div>

      <ul className="mt-3 space-y-1.5 text-sm">
        {order.items.map((l, i) => {
          const extras = [l.variation, ...l.modifiers.map((m) => m.name)].filter(Boolean).join(', ');
          return (
            <li key={i}>
              <div className="flex justify-between gap-2">
                <span className="text-[#2e2e30]">
                  <span className="font-semibold">{l.qty}×</span> {l.name}
                </span>
              </div>
              {extras && <div className="pl-5 text-xs text-[#6b6b70]">{extras}</div>}
              {l.notes && <div className="pl-5 text-xs font-medium text-amber-700">Note: {l.notes}</div>}
            </li>
          );
        })}
      </ul>
      {order.notes && <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Order note: {order.notes}</div>}

      <EtaStrip order={order} now={now} canUpdate={canUpdate} onAdjust={onAdjust} />

      <div className="mt-3 flex items-center justify-between border-t border-[#f0f0f0] pt-3 text-sm">
        <span className="text-[#6b6b70]">
          {order.payment.status === 'paid'
            ? 'Paid'
            : order.payment.method === 'cod'
            ? 'Cash on delivery'
            : order.channel === 'online'
            ? 'Pay on pickup'
            : 'Pay at counter'}
        </span>
        <span className="font-semibold text-[#2e2e30]">{money(order.total)}</span>
      </div>

      {canUpdate && (
        <div className="mt-3 flex gap-2">
          {confirmCancel ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => move('cancelled')}
                className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                Yes, cancel
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="flex-1 rounded-md border border-[#e2e2e2] px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#fafafa]"
              >
                Keep order
              </button>
            </>
          ) : (
            <>
              {next && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => move(next.to)}
                  className="flex-1 rounded-md bg-[#2e2e30] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? 'Saving…' : next.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm text-[#6b6b70] hover:bg-[#fafafa]"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function History({ token, onPrint }: { token: string | null; onPrint: PrintFn }) {
  const [rows, setRows] = useState<AdminOrder[] | null>(null);
  const { activeLocationId } = useScope();

  const load = async () => {
    if (!token) return;
    setRows(null);
    try {
      setRows(await listOrders(token, 'history'));
    } catch {
      setRows([]);
      toastError('Could not load order history');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const visible = (rows ?? []).filter((o) => !activeLocationId || !o.locationId || o.locationId === activeLocationId);

  if (rows === null) return <div className="h-40 animate-pulse rounded-lg bg-[#f6f6f6]" />;
  if (!visible.length) return <p className="py-10 text-center text-sm text-[#6b6b70]">No orders in the last 48 hours.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-[#ececec] bg-white">
      <table className="w-full text-sm">
        <thead className="bg-[#fafafa] text-left text-xs uppercase tracking-wide text-[#6b6b70]">
          <tr>
            <th className="px-4 py-3">Order</th>
            <th className="px-4 py-3">For</th>
            <th className="px-4 py-3">Items</th>
            <th className="px-4 py-3">Total</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Placed</th>
            <th className="px-4 py-3"><span className="sr-only">Print</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f0f0]">
          {visible.map((o) => (
            <tr key={o.id}>
              <td className="px-4 py-3 font-semibold text-[#2e2e30]">#{o.orderNumber}</td>
              <td className="px-4 py-3">
                {o.channel === 'online' ? `${orderWhere(o)} · ${o.customer?.name ?? ''}` : o.table}
              </td>
              <td className="px-4 py-3 text-[#6b6b70]">{o.items.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
              <td className="px-4 py-3">{money(o.total)}</td>
              <td className="px-4 py-3">
                <span className={`rounded-md px-2 py-0.5 text-xs ring-1 ${STATUS_CHIP[o.status]}`}>{o.status}</span>
              </td>
              <td className="px-4 py-3 text-[#6b6b70]">
                {new Date(o.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </td>
              <td className="px-4 py-3 text-right">
                <PrintMenu order={o} onPrint={onPrint} compact />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Orders() {
  const { orders, loading, connected, soundOn, setSoundOn, refresh, setStatus, adjustEta } = useOrdersLive();
  const { token } = useAuthContext();
  const { has } = usePermissions();
  const canUpdate = has('orders:update');
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [now, setNow] = useState(() => Date.now());
  const { data: tenant } = useTenant();
  const tenantSubdomain = (tenant as { subdomain?: string } | undefined)?.subdomain;
  const { active: buzzerActive, dismiss: dismissBuzzer } = useBuzzerAlert(tenantSubdomain);
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const updatePrintSettings = (s: PrintSettings) => {
    setPrintSettings(s);
    savePrintSettings(s);
  };
  const onPrint: PrintFn = (o, kind) => {
    void printOrder(o, kind, {
      paper: printSettings.paper,
      restaurant: (tenant as { name?: string } | undefined)?.name,
      timezone: (tenant as { timezone?: string } | undefined)?.timezone,
      reprint: kind === 'kitchen' ? o.status !== 'placed' : o.status === 'completed',
    });
  };
  const testPrint = () => {
    const at = new Date().toISOString();
    onPrint(
      {
        id: 'test',
        orderNumber: 0,
        status: 'placed',
        statusHistory: [{ status: 'placed', at }],
        table: 'TEST',
        items: [
          { itemId: 't1', name: 'Test item — কাচ্চি বিরিয়ানি', qty: 2, variation: 'Full', modifiers: [{ name: 'Extra raita', price: 30 }], unitPrice: 450, lineTotal: 900, notes: 'less spicy' },
          { itemId: 't2', name: 'Mineral Water', qty: 1, modifiers: [], unitPrice: 30, lineTotal: 30 },
        ],
        subtotal: 930,
        total: 930,
        currency: 'BDT',
        payment: { method: 'counter', status: 'unpaid' },
        source: 'staff',
        businessDay: '',
        createdAt: at,
        updatedAt: at,
      },
      'kitchen'
    );
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const byStatus = useMemo(() => {
    const m = new Map<OrderStatus, AdminOrder[]>();
    for (const o of orders) m.set(o.status, [...(m.get(o.status) ?? []), o]);
    return m;
  }, [orders]);

  const onMove = async (o: AdminOrder, to: OrderStatus) => {
    try {
      await setStatus(o.id, to);
      toastSuccess(to === 'cancelled' ? `Order #${o.orderNumber} cancelled` : `Order #${o.orderNumber} → ${to}`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not update the order');
      void refresh();
    }
  };

  const onAdjust = async (o: AdminOrder, minutes: number) => {
    try {
      await adjustEta(o.id, minutes);
      toastSuccess(`Order #${o.orderNumber}: ${minutes > 0 ? `+${minutes}` : minutes} min — the guest sees the new time`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not change the ready time');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[#2e2e30]">Orders</h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ${
              connected ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-500 ring-slate-200'
            }`}
            title={connected ? 'New orders appear instantly' : 'Reconnecting…'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {connected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PrintSettingsButton value={printSettings} onChange={updatePrintSettings} onTest={testPrint} />
          <button
            type="button"
            onClick={() => setSoundOn(!soundOn)}
            aria-pressed={soundOn}
            className="inline-flex items-center gap-2 rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#fafafa]"
          >
            {soundOn ? <BellAlertIcon className="h-4 w-4" /> : <BellSlashIcon className="h-4 w-4" />}
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#fafafa]"
            aria-label="Refresh"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {buzzerActive && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
            </span>
            <span className="text-sm font-medium text-amber-800">
              🔔 New order — counter buzzer is ringing
            </span>
          </div>
          <button
            type="button"
            onClick={() => void dismissBuzzer()}
            className="rounded-md bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-200 active:scale-95"
          >
            Silence buzzer
          </button>
        </div>
      )}

      <div className="flex gap-1 rounded-md bg-[#f1f2f4] p-1 w-fit" role="tablist">
        {(['active', 'history'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm ${tab === t ? 'bg-white text-[#2e2e30] shadow-sm' : 'text-[#6b6b70]'}`}
          >
            {t === 'active' ? `Active (${orders.length})` : 'Last 48 hours'}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <History token={token} onPrint={onPrint} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = byStatus.get(col.status) ?? [];
            return (
              <section key={col.status} className="rounded-lg bg-[#f6f6f6] p-3" aria-label={col.title}>
                <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-[#2e2e30]">
                  {col.title}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[#6b6b70] ring-1 ring-[#ececec]">{list.length}</span>
                </h2>
                <div className="space-y-3">
                  {list.length ? (
                    list.map((o) => <OrderCard key={o.id} order={o} now={now} canUpdate={canUpdate} onMove={onMove} onAdjust={onAdjust} onPrint={onPrint} />)
                  ) : (
                    <p className="py-6 text-center text-xs text-[#9a9aa0]">{col.empty}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
