// apps/braincell/src/components/orders/OrderDetail.tsx — one order in full, for the order history and a customer's
// history: what was ordered (with choices and notes), the totals, who it was for, how it's paid, and every status
// change with its time.
import { orderWhere, type AdminOrder, type OrderStatus } from '../../api/orders';

const money = (n: number) => `৳${new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(n)}`;
const when = (d: string) =>
  new Date(d).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = (d: string) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const SOURCE_LABEL: Record<AdminOrder['source'], string> = { 'ai-waiter': 'AI waiter', menu: 'Menu', staff: 'Staff' };

export default function OrderDetail({ order: o, branch }: { order: AdminOrder; branch?: string | null }) {
  return (
    <div className="space-y-5 text-sm">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[#6b6b70]">For</dt>
          <dd className="font-medium text-[#2e2e30]">{orderWhere(o)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#6b6b70]">Placed</dt>
          <dd className="font-medium text-[#2e2e30]">{when(o.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#6b6b70]">Status</dt>
          <dd className="font-medium text-[#2e2e30]">{STATUS_LABEL[o.status]}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#6b6b70]">Payment</dt>
          <dd className="font-medium text-[#2e2e30]">
            {o.payment.method === 'cod' ? 'Cash on delivery' : 'At the counter'} · {o.payment.status === 'paid' ? 'paid' : 'unpaid'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#6b6b70]">Ordered through</dt>
          <dd className="font-medium text-[#2e2e30]">{SOURCE_LABEL[o.source] ?? o.source}</dd>
        </div>
        {branch && (
          <div>
            <dt className="text-xs text-[#6b6b70]">Branch</dt>
            <dd className="font-medium text-[#2e2e30]">{branch}</dd>
          </div>
        )}
      </dl>

      {o.customer && (
        <div className="rounded-lg bg-[#fafafa] p-3">
          <p className="font-medium text-[#2e2e30]">{o.customer.name}</p>
          <p className="text-[#6b6b70]">{o.customer.phone}</p>
          {o.customer.address && <p className="text-[#6b6b70]">{o.customer.address}</p>}
        </div>
      )}

      {/* who delivered it (the restaurant's own rider), when, and the cash they took */}
      {o.delivery && (
        <div className="flex items-start gap-3 rounded-lg border border-[#ececf0] p-3">
          {o.delivery.rider.photoUrl ? (
            <img src={o.delivery.rider.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#efe9df] text-sm font-semibold text-[#6b5e44]">
              {o.delivery.rider.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-[#2e2e30]">
              Delivered by {o.delivery.rider.name} <span className="font-normal text-[#6b6b70]">· {o.delivery.rider.phone}</span>
            </p>
            <p className="text-[#6b6b70]">
              Assigned {clock(o.delivery.assignedAt)}
              {o.delivery.pickedUpAt ? ` · picked up ${clock(o.delivery.pickedUpAt)}` : ''}
              {o.delivery.deliveredAt ? ` · delivered ${clock(o.delivery.deliveredAt)}` : ' · not delivered'}
            </p>
            {o.delivery.cashCollected > 0 && (
              <p className="text-[#6b6b70]">
                Took ৳{o.delivery.cashCollected.toLocaleString('en-BD')} cash ·{' '}
                {o.delivery.cashSettledAt ? `handed in ${clock(o.delivery.cashSettledAt)}` : <b className="text-amber-700">not handed in yet</b>}
              </p>
            )}
            {o.delivery.problem && <p className="text-red-600">Reported a problem: {o.delivery.problem.reason.replace('-', ' ')}{o.delivery.problem.note ? ` — “${o.delivery.problem.note}”` : ''}</p>}
          </div>
        </div>
      )}

      <table className="w-full">
        <tbody className="divide-y divide-[#f0f0f0]">
          {o.items.map((l, i) => (
            <tr key={`${l.itemId}-${i}`}>
              <td className="py-2 pr-3 align-top font-medium text-[#2e2e30]">{l.qty}×</td>
              <td className="py-2 pr-3">
                <span className="text-[#2e2e30]">{l.name}</span>
                {l.variation && <span className="text-[#6b6b70]"> · {l.variation}</span>}
                {!!l.modifiers.length && <p className="text-xs text-[#6b6b70]">{l.modifiers.map((m) => m.name).join(', ')}</p>}
                {l.notes && <p className="text-xs text-amber-700">Note: {l.notes}</p>}
              </td>
              <td className="py-2 text-right align-top text-[#2e2e30]">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {o.subtotal !== o.total && (
            <tr>
              <td colSpan={2} className="pt-3 text-[#6b6b70]">Subtotal</td>
              <td className="pt-3 text-right text-[#6b6b70]">{money(o.subtotal)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={2} className="pt-2 font-semibold text-[#2e2e30]">Total</td>
            <td className="pt-2 text-right font-semibold text-[#2e2e30]">{money(o.total)}</td>
          </tr>
        </tfoot>
      </table>

      {o.notes && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">Order note: {o.notes}</p>}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b6b70]">Timeline</h3>
        <ol className="space-y-1">
          {o.statusHistory.map((h, i) => (
            <li key={i} className="flex justify-between gap-3 text-[#2e2e30]">
              <span>
                {STATUS_LABEL[h.status]}
                {h.by && <span className="text-xs text-[#9a9aa0]"> · {h.by}</span>}
              </span>
              <span className="text-[#6b6b70]">{when(h.at)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
