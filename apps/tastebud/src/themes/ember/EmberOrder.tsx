// apps/tastebud/src/themes/ember/EmberOrder.tsx
// Ember — after ordering. Minimal: one order per screen.
//   Dine-in (7.2 – 7.4): tabs "Order 2 · Order 1" when there's more than one; a big ring (a pulsing dot while it waits
//     to be accepted, minutes left once it is); the title and one grey line; Sent → Accepted → Preparing → Ready →
//     Served; "View dishes" opens the dishes sheet (no editing — changes go through staff).
//   Online (11.0 – 11.2): the same while it waits for the restaurant; once accepted, delivery tracking or pickup status
//     (the big order number for the counter, directions).
// Live: the order is followed as it changes (api/orders.followOrder).
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ownMessage, type GuestMessages } from '../../utils/guestMessages';
import { followOrder, getOrder, type OrderStatus, type PublicOrder } from '../../api/orders';
import { useWaiterSession } from '../../waiter/useWaiterSession';
import { orderPath } from '../../utils/checkout-flow';
import { usePickupPlace } from '../../utils/order-mode';
import { money } from '../../utils/ui-lang';
import { useEmberChrome } from './Chrome';
import { clockTime, useOrderClock, useStoreRoute } from './store';
import { placedAt, useVisitSync } from './visit';
import AppOffer from './AppOffer';
import { bnDigits, clockText } from './when';
import { BottomBar, EM, I, Orb, Sheet, Shell, TopBar, tx, type Lang } from './ui';

type Step = { key: OrderStatus; label: string };

function steps(o: PublicOrder, lang: Lang): Step[] {
  if (o.channel !== 'online')
    return [
      { key: 'placed', label: tx(lang, 'পাঠানো হয়েছে', 'Sent') },
      { key: 'accepted', label: tx(lang, 'গ্রহণ করা হয়েছে', 'Accepted') },
      { key: 'preparing', label: tx(lang, 'তৈরি হচ্ছে', 'Preparing') },
      { key: 'ready', label: tx(lang, 'প্রস্তুত', 'Ready') },
      { key: 'completed', label: tx(lang, 'পরিবেশন করা হয়েছে', 'Served') },
    ];
  const delivery = o.fulfillment === 'delivery';
  return [
    { key: 'placed', label: tx(lang, 'অর্ডার দেওয়া হয়েছে', 'Placed') },
    { key: 'accepted', label: tx(lang, 'গ্রহণ করা হয়েছে', 'Accepted') },
    { key: 'preparing', label: tx(lang, 'তৈরি হচ্ছে', 'Preparing') },
    { key: 'ready', label: delivery ? tx(lang, 'পথে আছে', 'On the way') : tx(lang, 'নেওয়ার জন্য প্রস্তুত', 'Ready for pickup') },
    { key: 'completed', label: delivery ? tx(lang, 'পৌঁছে গেছে', 'Delivered') : tx(lang, 'নেওয়া হয়েছে', 'Picked up') },
  ];
}
const ORDER: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'completed'];
const timeOf = (o: PublicOrder, s: OrderStatus) => {
  const h = o.statusHistory?.find((x) => x.status === s);
  return h ? clockTime(new Date(h.at)) : '';
};

/** Right after ordering: the restaurant's own thank-you (Settings → Guest messages), else the original wording —
 *  the title, the line under it and how to pay. No popup: a card on the order screen, closed with ×. */
function ThankYou({ o, lang, messages, restaurant, waiter, onClose }: { o: PublicOrder; lang: Lang; messages: GuestMessages | null; restaurant?: string | null; waiter: string; onClose: () => void }) {
  const online = o.channel === 'online';
  const delivery = online && o.fulfillment === 'delivery';
  const kind = !online ? 'dineIn' : delivery ? 'delivery' : 'pickup';
  const first = (o.customer?.name || '').trim().split(/s+/)[0];
  const vars = { restaurant, waiter, name: first, table: o.table, order: o.orderNumber };
  const title =
    ownMessage(messages, `${kind}Title` as any, lang, vars) ?? (first ? tx(lang, `ধন্যবাদ, ${first}!`, `Thank you, ${first}!`) : tx(lang, 'ধন্যবাদ!', 'Thank you!'));
  const message =
    ownMessage(messages, `${kind}Body` as any, lang, vars) ??
    (o.status === 'placed' ? tx(lang, 'অর্ডার পাঠানো হয়েছে', 'Your order has been sent') : tx(lang, 'অর্ডার কনফার্ম করা হয়েছে', 'Your order is confirmed'));
  const pay = delivery
    ? tx(lang, 'ক্যাশ অন ডেলিভারি।', 'Cash on delivery.')
    : online
    ? tx(lang, 'খাবার তৈরি হলে রেস্টুরেন্ট থেকে নিয়ে যাবেন — তখন এই নম্বরটা বলে পরিশোধ করবেন।', "Collect it from the restaurant when it's ready — quote this number and pay there.")
    : tx(lang, 'বিল কাউন্টারে দেবেন — এই নম্বরটা বলবেন।', 'Pay at the counter — just quote this number.');
  return (
    <div role="status" className="em-rise mx-4 mt-3 flex items-start gap-3 rounded-[18px] py-3 pl-4 pr-2" style={{ background: EM.amberTint, border: `1px solid ${EM.amberLine}` }}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: EM.amber, color: EM.bg }}>{I.check({ size: 14 })}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px]" style={{ color: EM.text2 }}>{message} · #{o.orderNumber}</span>
        <span className="text-[13px]" style={{ color: EM.text3 }}>{pay}</span>
      </span>
      <button type="button" aria-label={tx(lang, 'বন্ধ করুন', 'Close')} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center" style={{ color: EM.text2 }}>{I.x({ size: 16 })}</button>
    </div>
  );
}

/** "Your table so far": every order this visit — its time, where it is, its total — and one total for them all, so
 *  the bill holds no surprise. Only with two or more orders. */
function TableSoFar({ orders, lang, table, current, onOpen }: { orders: PublicOrder[]; lang: Lang; table: string | null; current: string; onOpen: (token: string) => void }) {
  const live = orders.filter((x) => x.status !== 'cancelled');
  if (live.length < 2) return null;
  const total = live.reduce((n, x) => n + (x.total ?? x.subtotal ?? 0), 0);
  const at = (x: PublicOrder) => {
    const d = new Date(placedAt(x));
    return clockText(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, lang);
  };
  return (
    <div className="mx-5 mt-6 flex flex-col gap-2.5 rounded-[18px] px-4 py-3.5" style={{ background: EM.surface, border: `1px solid ${EM.border}` }}>
      <span className="text-[12px] font-semibold tracking-[1px]" style={{ color: EM.text3 }}>
        {table ? tx(lang, `টেবিল ${bnDigits(table)} · এ পর্যন্ত`, `TABLE ${table} · SO FAR`) : tx(lang, 'এ পর্যন্ত', 'SO FAR')}
      </span>
      {live.map((x) => {
        const label = steps(x, lang).find((st) => st.key === x.status)?.label ?? '';
        const on = x.token === current;
        return (
          <button key={x.token} type="button" onClick={() => onOpen(x.token)} className="flex items-center gap-3 text-left text-[14px]">
            <span className="min-w-0 flex-1 truncate" style={{ fontWeight: on ? 600 : 400 }}>
              {tx(lang, `অর্ডার ${x.orderNumber}`, `Order ${x.orderNumber}`)} <span style={{ color: EM.muted }}>· {at(x)}</span>
            </span>
            <span className="shrink-0 text-[13px]" style={{ color: x.status === 'completed' ? EM.muted : EM.amber }}>{label}</span>
            <span className="w-16 shrink-0 text-right tabular-nums" style={{ color: EM.text2 }}>{money(x.total ?? x.subtotal ?? 0)}</span>
          </button>
        );
      })}
      <div className="flex items-baseline justify-between pt-2" style={{ borderTop: `1px solid ${EM.border}` }}>
        <span className="text-[15px] font-semibold">{tx(lang, 'মোট', 'Total')}</span>
        <span className="text-[17px] font-semibold tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}

const VEHICLE: Record<string, [string, string]> = { bike: ['বাইক', 'Bike'], cycle: ['সাইকেল', 'Cycle'], car: ['গাড়ি', 'Car'], walk: ['হেঁটে', 'On foot'] };

/** Who is bringing it (the restaurant's own rider): photo, name, vehicle, where they are, and Call. */
function RiderCard({ o, lang }: { o: PublicOrder; lang: Lang }) {
  const d = o.delivery;
  if (!d || d.deliveredAt) return null;
  const r = d.rider;
  const v = r.vehicle && VEHICLE[r.vehicle] ? tx(lang, VEHICLE[r.vehicle][0], VEHICLE[r.vehicle][1]) : '';
  const where = d.pickedUpAt
    ? tx(lang, `${clockTime(new Date(d.pickedUpAt))} থেকে পথে`, `On the way since ${clockTime(new Date(d.pickedUpAt))}`)
    : tx(lang, 'রেস্টুরেন্ট থেকে খাবার নিচ্ছেন', 'Collecting your order');
  const initials = r.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return (
    <div className="em-rise flex items-center gap-3 rounded-[18px] p-3" style={{ background: EM.surface, border: `1px solid ${EM.border}` }}>
      {r.photoUrl ? (
        <img src={r.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[16px] font-bold" style={{ background: '#2A2116', color: EM.amber }}>
          {initials}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] font-semibold">{r.name}</span>
        <span className="truncate text-[13px]" style={{ color: EM.text3 }}>
          {[v, where].filter(Boolean).join(' · ')}
        </span>
      </span>
      <a
        href={`tel:${r.phone}`}
        aria-label={tx(lang, `${r.name}-কে কল করুন`, `Call ${r.name}`)}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[18px] font-bold"
        style={{ background: EM.amber, color: EM.bg }}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
      </a>
    </div>
  );
}

/** Sent → Accepted → … : done steps show their time, the current one amber, future ones nothing. */
function Steps({ o, lang, current, minutes }: { o: PublicOrder; lang: Lang; current: number; minutes: number | null }) {
  return (
    <ol aria-label={tx(lang, 'অর্ডারের অগ্রগতি', 'Order progress')} className="flex flex-col">
      {steps(o, lang).map((s, i) => {
        const done = i < current || (i === current && s.key === 'completed');
        const now = i === current && !done;
        return (
          <li key={s.key} aria-current={now ? 'step' : undefined} className="flex h-9 items-center gap-3.5">
            {done ? (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: EM.amber, color: EM.bg }}>{I.check({ size: 12, sw: 3.2 })}</span>
            ) : now ? (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold" style={{ border: `2px solid ${EM.amber}`, color: EM.amber }}>{i + 1}</span>
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: EM.surface2, color: EM.faint }}>{i + 1}</span>
            )}
            <span className="flex-1 text-[15px]" style={{ color: done ? EM.text2 : now ? EM.text : EM.faint, fontWeight: now ? 600 : 500 }}>{s.label}</span>
            <span className="text-[13px]" style={{ color: now ? EM.amber : EM.muted }}>
              {done ? timeOf(o, s.key) : now ? (s.key === 'accepted' ? tx(lang, 'অপেক্ষা…', 'waiting…') : minutes != null && s.key === 'preparing' ? tx(lang, `${minutes} মিনিট`, `${minutes} min`) : '') : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Ring({ minutes, fraction, waiting, done }: { minutes: number | null; fraction: number; waiting: boolean; done: boolean }) {
  const r = 76;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-[164px] w-[164px]">
      <svg aria-hidden="true" width="164" height="164" className="absolute inset-0">
        <circle cx="82" cy="82" r={r} fill="none" stroke="#232326" strokeWidth={waiting ? 5 : 6} />
        <circle cx="82" cy="82" r={r} fill="none" stroke={EM.amber} strokeWidth={waiting ? 5 : 6} strokeLinecap="round" strokeDasharray={`${c * (done ? 1 : fraction)} ${c}`} transform="rotate(-90 82 82)" opacity={waiting ? 0.9 : 1} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {done ? (
          <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: EM.amber, color: EM.bg }}>{I.check({ size: 28 })}</span>
        ) : waiting || minutes == null ? (
          <span aria-hidden="true" className="em-pulse h-3.5 w-3.5 rounded-full" style={{ background: EM.amber }} />
        ) : (
          <>
            <span className="em-tight text-[48px] font-semibold leading-none tracking-[-1.5px]">{minutes}</span>
            <span className="mt-1 text-[13px]" style={{ color: EM.muted }}>min</span>
          </>
        )}
      </div>
    </div>
  );
}

function DishesSheet({ o, open, onClose, lang, waiterName }: { o: PublicOrder; open: boolean; onClose: () => void; lang: Lang; waiterName: string }) {
  const readyDone = o.status === 'ready' || o.status === 'completed';
  return (
    <Sheet open={open} onClose={onClose} label={tx(lang, `অর্ডার ${o.orderNumber}-এর খাবার`, `Order ${o.orderNumber} dishes`)}>
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="em-tight text-[22px] font-semibold">{tx(lang, `অর্ডার ${o.orderNumber}`, `Order ${o.orderNumber}`)}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-full" style={{ color: EM.text3 }}>{I.x({ size: 22, sw: 2 })}</button>
      </div>
      {o.items.map((it, i) => (
        <div key={i} className="flex h-[52px] items-center gap-3.5">
          <span className="w-6 shrink-0 text-[15px]" style={{ color: EM.muted }}>{it.qty}×</span>
          <span className="min-w-0 flex-1 truncate text-[16px]">
            {it.name}
            {it.variation ? <span style={{ color: EM.muted }}> · {it.variation}</span> : null}
            {readyDone && <span className="ml-1.5 text-[12px] font-semibold" style={{ color: EM.ready }}>{tx(lang, 'প্রস্তুত', 'Ready')}</span>}
          </span>
          <span className="text-[15px]" style={{ color: EM.text2 }}>{money(it.lineTotal)}</span>
        </div>
      ))}
      <div className="mt-1.5 flex h-14 items-center justify-between" style={{ borderTop: `1px solid ${EM.border}` }}>
        <span className="text-[15px]" style={{ color: EM.text3 }}>{tx(lang, 'মোট', 'Total')}</span>
        <span className="text-[17px] font-semibold">{money(o.total)}</span>
      </div>
      <p className="mt-2 text-center text-[13px]" style={{ color: EM.muted }}>
        {o.channel === 'online'
          ? tx(lang, `কিছু বদলাতে চান? ${waiterName}-কে বলুন।`, `Need a change? Just ask ${waiterName}.`)
          : tx(lang, `কিছু বদলাতে চান? ${waiterName}-কে বলুন বা ওয়েটার ডাকুন।`, `Need a change? Just ask ${waiterName} or call a waiter.`)}
      </p>
    </Sheet>
  );
}

export default function EmberOrder() {
  const navigate = useNavigate();
  const { token = '' } = useParams<{ token?: string }>();
  const route = useStoreRoute();
  const { sub, branch, channel, waiterName } = route;
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [missing, setMissing] = useState(false);
  const [dishes, setDishes] = useState(false);
  const location = useLocation();
  const [thanks, setThanks] = useState(!!(location.state as any)?.justPlaced);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    setOrder(null);
    getOrder(token).then((o) => (alive ? (o ? setOrder(o) : setMissing(true)) : undefined));
    const stop = followOrder(token, (o) => alive && setOrder(o));
    return () => {
      alive = false;
      stop();
    };
  }, [token]);
  // (ready → a buzz: the visit store does it, on every page — themes/ember/visit.ts)

  const w = useWaiterSession({ subdomain: sub, branch: branch ?? undefined, channel, onOpenMenu: () => navigate(route.menuHref()) });
  const chrome = useEmberChrome({ w, route });
  const lang = chrome.lang;
  const { all } = useVisitSync(sub);
  const clock = useOrderClock(order);
  const pickupAt = usePickupPlace(sub, order?.branch ?? branch);

  const orbLabel =
    w.orbMode === 'listening'
      ? tx(lang, 'শুনছি', 'Listening')
      : w.orbMode === 'thinking'
      ? tx(lang, 'ভাবছি', 'Thinking')
      : w.orbMode === 'talking'
      ? tx(lang, 'থামাতে ট্যাপ করুন', 'Tap to interrupt')
      : tx(lang, 'অর্ডার নিয়ে জিজ্ঞেস করুন', 'Ask about your order');
  const online = order?.channel === 'online';
  const footer = (
    <BottomBar
      lang={lang}
      onMenu={() => navigate(route.menuHref())}
      onType={chrome.openChat}
      orb={<Orb mode={w.orbMode} label={orbLabel} pressProps={w.orbPressProps} ballRef={w.orbBallRef} ariaLabel={tx(lang, 'অর্ডার নিয়ে জিজ্ঞেস করুন', `Ask ${waiterName} about your order`)} />}
    />
  );
  const header = (
    <>
      <TopBar onBack={() => navigate(route.homeHref)} title={online ? tx(lang, 'আপনার অর্ডার', 'Your order') : tx(lang, 'অর্ডার', 'Orders')} right={chrome.right} />
      {chrome.statusCard}
    </>
  );
  const thankYou =
    thanks && order ? (
      <ThankYou
        o={order}
        lang={lang}
        messages={(route.info as { guestMessages?: GuestMessages } | null)?.guestMessages ?? null}
        restaurant={route.info?.name}
        waiter={waiterName}
        onClose={() => setThanks(false)}
      />
    ) : null;

  if (missing || !order)
    return (
      <Shell glow="calm" header={header} footer={footer} overlay={chrome.overlays}>
        <div className="flex flex-1 items-center justify-center px-8 text-center text-[15px]" style={{ color: EM.muted }}>
          {missing ? tx(lang, 'অর্ডারটি খুঁজে পাওয়া যায়নি।', "We couldn't find this order.") : tx(lang, 'লোড হচ্ছে…', 'Loading…')}
        </div>
      </Shell>
    );

  const o = order;
  const cancelled = o.status === 'cancelled';
  const waitingForRider = !!o.delivery && !o.delivery.pickedUpAt && o.status === 'ready';
  const current = waitingForRider ? ORDER.indexOf('preparing') : Math.max(0, ORDER.indexOf(o.status));
  const waiting = o.status === 'placed';
  const done = o.status === 'completed';
  const delivery = online && o.fulfillment === 'delivery';
  const minutesText = clock.minutes == null ? '' : clock.overdue ? tx(lang, 'প্রায় হয়ে এসেছে', 'Almost ready') : tx(lang, `${clock.minutes} মিনিট`, `${clock.minutes} min`);

  // more than one order this visit: tabs, newest first (minutes left on each)
  const tabs =
    all.length > 1 && !online ? (
      <div role="tablist" aria-label={tx(lang, 'এই ভিজিটের অর্ডার', 'Orders this visit')} className="em-noscroll flex gap-2 overflow-x-auto px-4 pt-3">
        {all.map((x) => {
          const on = x.token === o.token;
          return (
            <button
              key={x.token}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => navigate(orderPath(x.token, sub, branch), { replace: true })}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold"
              style={on ? { background: EM.text, color: EM.bg } : { border: `1px solid ${EM.border}`, color: EM.text2 }}
            >
              {tx(lang, `অর্ডার ${x.orderNumber}`, `Order ${x.orderNumber}`)}
              {x.eta?.readyAt && x.status !== 'placed' && x.status !== 'completed' && x.status !== 'cancelled' && (
                <span className="font-medium" style={{ color: on ? EM.faint : EM.text3 }}>
                  {Math.max(0, Math.ceil((new Date(x.eta.readyAt).getTime() - Date.now()) / 60000))} min
                </span>
              )}
            </button>
          );
        })}
      </div>
    ) : null;

  /* ------------------------------------- 11.1 / 11.2 online, after accept */
  if (online && !waiting && !cancelled) {
    const items = o.items.reduce((n, i) => n + i.qty, 0);
    return (
      <Shell glow="calm" header={header} footer={footer} overlay={<>{chrome.overlays}<DishesSheet o={o} open={dishes} onClose={() => setDishes(false)} lang={lang} waiterName={waiterName} /></>}>
        {thankYou}
        <div className="em-noscroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-1">
          <div className="flex flex-col gap-3.5">
            <div className="em-rise flex flex-col gap-2 rounded-[20px] p-[18px]" style={{ background: EM.amberTint, border: `1px solid ${EM.amberLine}` }}>
              <span className="text-[12px] font-semibold tracking-[1px]" style={{ color: EM.amber }}>
                {delivery ? tx(lang, `অর্ডার #${o.orderNumber} · ডেলিভারি`, `ORDER #${o.orderNumber} · DELIVERY`) : tx(lang, 'পিকআপ', 'PICKUP')}
              </span>
              <span className="em-tight text-[26px] font-semibold tracking-[-0.4px]">
                {done
                  ? delivery ? tx(lang, 'পৌঁছে গেছে', 'Delivered') : tx(lang, 'নেওয়া হয়েছে', 'Picked up')
                  : waitingForRider || (delivery && o.delivery && !o.delivery.pickedUpAt && o.status !== 'placed')
                  ? tx(lang, 'রাইডার খাবার নিতে আসছেন', 'A rider is collecting it')
                  : o.status === 'ready'
                  ? delivery ? tx(lang, 'আপনার খাবার পথে', 'On the way to you') : tx(lang, 'নেওয়ার জন্য প্রস্তুত', 'Ready for pickup')
                  : delivery
                  ? tx(lang, 'আপনার খাবার তৈরি হচ্ছে', 'Preparing your food')
                  : clock.minutes != null
                  ? tx(lang, `~${clock.minutes} মিনিটে প্রস্তুত`, `Ready in ~${clock.minutes} min`)
                  : tx(lang, 'তৈরি হচ্ছে', 'Preparing')}
              </span>
              {delivery && !done && clock.minutes != null && o.status !== 'ready' && (
                <span className="mb-1 text-[14px]" style={{ color: EM.text3 }}>
                  {tx(lang, 'রান্না শেষ', 'Cooked in')} <b style={{ color: EM.text }}>~{clock.minutes} min</b>
                  {clock.readyAt ? ` · ${tx(lang, 'প্রায়', 'around')} ${clockTime(clock.readyAt)}` : ''}
                </span>
              )}
              {!delivery && (
                <div className="flex flex-col items-center gap-1 rounded-2xl p-3.5" style={{ background: EM.bg }}>
                  <span className="text-[12px]" style={{ color: EM.text3 }}>{tx(lang, 'কাউন্টারে এটা দেখান', 'Show this at the counter')}</span>
                  <span className="em-tight text-[40px] font-bold tracking-[1px]">#{o.orderNumber}</span>
                </div>
              )}
              <div className="mt-1">
                <Steps o={o} lang={lang} current={current} minutes={clock.minutes} />
              </div>
            </div>
            {delivery && <RiderCard o={o} lang={lang} />}
            {/* the restaurant's app: offered once the order is in (src/pwa) */}
            <AppOffer sub={sub} name={route.info?.name ?? ''} lang={lang} show={(route.info as any)?.channels?.online !== false} />
            {delivery ? (
              <div className="flex flex-col gap-2.5 rounded-[20px] p-[18px]" style={{ background: EM.card, border: '1px solid #222225' }}>
                <span className="text-[13px] font-medium" style={{ color: EM.text3 }}>{tx(lang, 'যেখানে যাবে', 'DELIVERING TO')}</span>
                <span className="rr-mask text-[15px] leading-[1.4]">
                  {o.customer?.name} · {o.customer?.phone}
                  <br />
                  {o.customer?.address}
                </span>
                <div className="h-px" style={{ background: EM.border }} />
                <div className="flex justify-between text-[15px]" style={{ color: EM.text2 }}>
                  <span>{tx(lang, 'ক্যাশ অন ডেলিভারি', 'Cash on delivery')} · {items} {tx(lang, 'আইটেম', 'items')}</span>
                  <span>{money(o.total)}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 rounded-[20px] p-[18px]" style={{ background: EM.card, border: '1px solid #222225' }}>
                <span className="text-[13px] font-medium" style={{ color: EM.text3 }}>{tx(lang, 'যেখান থেকে নেবেন', 'PICK UP FROM')}</span>
                <span className="text-[15px] leading-[1.4]">
                  {pickupAt.name}
                  {pickupAt.address && (
                    <>
                      <br />
                      {pickupAt.address}
                    </>
                  )}
                </span>
                {pickupAt.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([pickupAt.name, pickupAt.address].filter(Boolean).join(', '))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-[46px] items-center justify-center rounded-full text-[15px] font-semibold"
                    style={{ border: '1px solid #3A3A3F', color: EM.text }}
                  >
                    {tx(lang, 'দিকনির্দেশনা', 'Get directions')}
                  </a>
                )}
                <div className="h-px" style={{ background: EM.border }} />
                <div className="flex justify-between text-[15px]" style={{ color: EM.text2 }}>
                  <span>{tx(lang, 'নেওয়ার সময় পরিশোধ', 'Pay at pickup')}</span>
                  <span>{money(o.total)}</span>
                </div>
              </div>
            )}
            <button type="button" onClick={() => setDishes(true)} className="h-11 self-center px-4 text-[14px] font-semibold" style={{ color: EM.text3 }}>
              {tx(lang, 'খাবারগুলো দেখুন', 'View dishes')}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ------------------------------ 7.2 / 7.3 dine-in · 11.0 waiting (online) */
  const title = cancelled
    ? tx(lang, 'অর্ডার বাতিল হয়েছে', 'Order cancelled')
    : waiting
    ? online
      ? tx(lang, 'রেস্টুরেন্টের অপেক্ষায়', 'Waiting for the restaurant')
      : tx(lang, 'অনুমোদনের অপেক্ষায়', 'Waiting for approval')
    : o.status === 'ready'
    ? tx(lang, 'প্রস্তুত!', 'Ready!')
    : done
    ? tx(lang, 'পরিবেশন করা হয়েছে', 'Served')
    : tx(lang, 'রান্না হচ্ছে', 'Cooking');
  const line = cancelled
    ? tx(lang, 'কোনো প্রশ্ন থাকলে স্টাফকে জানান।', 'Please ask a staff member if you have questions.')
    : online
    ? `${tx(lang, `অর্ডার #${o.orderNumber}`, `Order #${o.orderNumber}`)} · ${delivery ? tx(lang, 'ডেলিভারি', 'Delivery') : tx(lang, 'পিকআপ', 'Pickup')}`
    : waiting
    ? o.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(' · ')
    : o.status === 'ready'
    ? tx(lang, 'আপনার টেবিলে আসছে', 'On its way to your table')
    : done
    ? tx(lang, 'খাবার উপভোগ করুন!', 'Enjoy your meal!')
    : clock.overdue
    ? tx(lang, 'প্রায় হয়ে এসেছে', 'Almost ready')
    : clock.readyAt
    ? tx(lang, `প্রায় ${clockTime(clock.readyAt)}-এ প্রস্তুত`, `Ready around ${clockTime(clock.readyAt)}`)
    : minutesText;

  return (
    <Shell
      glow="calm"
      header={
        <>
          {header}
        </>
      }
      footer={footer}
      overlay={
        <>
          {chrome.overlays}
          <DishesSheet o={o} open={dishes} onClose={() => setDishes(false)} lang={lang} waiterName={waiterName} />
        </>
      }
    >
      {thankYou}
      {tabs}
      <div className="em-noscroll min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="em-fade pt-6">
          <Ring minutes={clock.minutes} fraction={clock.fraction} waiting={waiting || cancelled} done={done} />
          <div className="mt-[22px] px-6 text-center">
            <h2 className="em-tight text-[24px] font-semibold tracking-[-0.4px]">{title}</h2>
            <p className="mt-1.5 truncate text-[14px]" style={{ color: EM.muted }}>{line}</p>
          </div>
          {!cancelled && (
            <div className="mx-10 mt-5">
              <Steps o={o} lang={lang} current={current} minutes={clock.minutes} />
            </div>
          )}
          <div className="mt-3 flex flex-col items-center">
            {waiting && (
              <p className="px-8 text-center text-[13px]" style={{ color: EM.muted }}>
                {online
                  ? tx(lang, 'বাতিল করতে চাইলে রেস্টুরেন্টকে জানান।', 'Need to cancel? Contact the restaurant before it’s accepted.')
                  : tx(lang, 'বাতিল করতে চাইলে ওয়েটার ডাকুন।', 'Need to cancel? Call a waiter before it’s accepted.')}
              </p>
            )}
            <button type="button" onClick={() => setDishes(true)} className="h-11 px-4 text-[14px] font-semibold" style={{ color: EM.text3 }}>
              {tx(lang, 'খাবারগুলো দেখুন', 'View dishes')}
            </button>
          </div>
          {!online && (
            <TableSoFar orders={all} lang={lang} table={o.table} current={o.token} onOpen={(t) => navigate(orderPath(t, sub, branch), { replace: true })} />
          )}
          {!online && done && (
            // the meal is over: the restaurant's app, for delivery next time (src/pwa)
            <div className="mx-5 mt-5">
              <AppOffer sub={sub} name={route.info?.name ?? ''} lang={lang} show={(route.info as any)?.channels?.online !== false} />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
