// apps/braincell/src/components/orders/RiderPanel.tsx — a delivery order's rider, on its card on the order board
// (only for restaurants with riders — pages/Riders.tsx). Not assigned: "Assign rider" (riders on duty, free ones
// first). Assigned: who, the WhatsApp message to send them (WhatsApp opens with it written — staff press send),
// change rider, and their steps for them if they forget to tap (Picked up, Delivered). A rider's "couldn't deliver"
// shows here in red.
import { useState } from 'react';
import type { AdminOrder } from '../../api/orders';
import { REASON_LABEL, VEHICLE_LABEL, assignOrderRider, orderTrip, riderLink, whatsappTo, type Rider } from '../../api/riders';
import { RiderAvatar } from '../../pages/Riders';
import { toastError, toastSuccess } from '../Toaster';

const money = (n: number) => `৳${new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(n)}`;
const clock = (d: string) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const errText = (e: unknown) => (e as any)?.response?.data?.message || 'Could not update the order';

/** What the rider gets on WhatsApp for this order. */
export function orderMessage(o: AdminOrder, restaurant: string, link: string) {
  const collect =
    o.payment.method === 'cod' && o.payment.status === 'unpaid' ? `Collect ${money(o.total)} cash` : 'Paid — collect nothing';
  return [
    `Order #${o.orderNumber} · ${restaurant}`,
    [o.customer?.name, o.customer?.phone].filter(Boolean).join(' · '),
    o.customer?.address ?? '',
    collect,
    `Open: ${link}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export default function RiderPanel({
  order,
  riders,
  restaurant,
  canUpdate,
  onChanged,
}: {
  order: AdminOrder;
  riders: Rider[];
  restaurant: string;
  canUpdate: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const d = order.delivery;
  const rider = d ? riders.find((r) => r.id === d.riderId) : undefined;
  // riders for this order's branch, on duty, free ones first
  const choices = riders
    .filter((r) => r.onDuty && (!r.locationId || !order.locationId || r.locationId === order.locationId))
    .sort((a, b) => a.active.length - b.active.length || a.name.localeCompare(b.name));

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toastSuccess(done);
      onChanged();
    } catch (e) {
      toastError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const picker = (label: string) =>
    canUpdate ? (
      <select
        aria-label={label}
        disabled={busy}
        value=""
        onChange={(e) => {
          const id = e.target.value;
          const r = riders.find((x) => x.id === id);
          if (r) void run(() => assignOrderRider(order.id, id), `#${order.orderNumber} → ${r.name}. Send it to them on WhatsApp.`);
        }}
        className={
          d
            ? 'rounded-md border border-[#e2e2e2] bg-white px-2 py-1.5 text-xs text-[#2e2e30]'
            : 'w-full rounded-md bg-[#2e2e30] px-3 py-2 text-sm font-medium text-white'
        }
      >
        <option value="">{label}</option>
        {choices.map((r) => (
          <option key={r.id} value={r.id} disabled={r.id === d?.riderId}>
            {r.name} · {r.active.length ? `${r.active.length} on now` : 'free'}
          </option>
        ))}
        {!choices.length && <option disabled>No rider on duty — switch one on in Riders</option>}
      </select>
    ) : null;

  if (!d) return <div className="mt-3">{picker('Assign rider')}</div>;

  const link = rider ? riderLink(rider.linkToken) : '';
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md bg-[#f6f6f8] p-2.5">
      <div className="flex items-center gap-2">
        <RiderAvatar r={{ name: d.rider.name, photoUrl: d.rider.photoUrl }} size={28} />
        <div className="min-w-0 flex-1 text-xs">
          <div className="truncate font-semibold text-[#2e2e30]">
            {d.rider.name}
            {d.rider.vehicle ? <span className="font-normal text-[#6b6b70]"> · {VEHICLE_LABEL[d.rider.vehicle as keyof typeof VEHICLE_LABEL] ?? d.rider.vehicle}</span> : null}
          </div>
          <div className="text-[#6b6b70]">
            {d.deliveredAt
              ? `Delivered ${clock(d.deliveredAt)}`
              : d.pickedUpAt
              ? `Picked up ${clock(d.pickedUpAt)} · on the way`
              : `Assigned ${clock(d.assignedAt)} · not picked up yet`}
          </div>
        </div>
      </div>
      {d.problem && !d.deliveredAt && (
        <div role="alert" className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 ring-1 ring-red-200">
          <span className="font-semibold">Couldn't deliver:</span> {REASON_LABEL[d.problem.reason] ?? d.problem.reason} · {clock(d.problem.at)}
          {d.problem.note ? <div className="mt-0.5">“{d.problem.note}”</div> : null}
        </div>
      )}
      {canUpdate && !d.deliveredAt && (
        <div className="flex flex-wrap items-center gap-1.5">
          {rider && (
            <a
              href={whatsappTo(rider.phone, orderMessage(order, restaurant, link))}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"
            >
              WhatsApp {d.rider.name.split(' ')[0]}
            </a>
          )}
          {!d.pickedUpAt && picker('Change rider')}
          {!d.pickedUpAt ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => orderTrip(order.id, 'picked_up'), `#${order.orderNumber} picked up`)}
              className="rounded-md border border-[#e2e2e2] bg-white px-2.5 py-1.5 text-xs font-medium"
            >
              Picked up
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => orderTrip(order.id, 'delivered'), `#${order.orderNumber} delivered`)}
              className="rounded-md bg-[#2e2e30] px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              Mark delivered
            </button>
          )}
          {!d.pickedUpAt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => assignOrderRider(order.id, null), `Rider taken off #${order.orderNumber}`)}
              className="px-1.5 py-1.5 text-xs text-[#6b6b70] hover:text-[#2e2e30]"
            >
              Unassign
            </button>
          )}
        </div>
      )}
    </div>
  );
}
