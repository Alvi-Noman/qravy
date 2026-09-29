// apps/tastebud/src/pages/OrderStatusPage.tsx
// The guest's live order: a countdown to the kitchen's ready time, then Placed → Accepted → Preparing → Ready →
// Completed (or Cancelled). The ready time moves live when cooking starts or the kitchen adjusts it.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { followOrder, getOrder, type OrderStatus, type PublicOrder } from '../api/orders';
import OrderConfirmedModal from '../components/ai-waiter/OrderConfirmedModal';
import OrderCountdown from '../components/OrderCountdown';
import { storeBasePath } from '../utils/checkout-flow';
import { money, tr, type UiLang } from '../utils/ui-lang';

const STEPS: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'completed'];

const LABEL: Record<OrderStatus, [string, string]> = {
  placed: ['অর্ডার পাঠানো হয়েছে', 'Order sent'],
  accepted: ['রেস্টুরেন্ট গ্রহণ করেছে', 'Accepted by the restaurant'],
  preparing: ['তৈরি হচ্ছে', 'Preparing'],
  ready: ['প্রস্তুত', 'Ready'],
  completed: ['সম্পন্ন', 'Completed'],
  cancelled: ['বাতিল', 'Cancelled'],
};

const HINT: Record<OrderStatus, [string, string]> = {
  placed: ['রেস্টুরেন্ট শিগগিরই আপনার অর্ডার দেখবে।', 'The restaurant will look at your order shortly.'],
  accepted: ['রেস্টুরেন্ট আপনার অর্ডার গ্রহণ করেছে।', 'The restaurant has accepted your order.'],
  preparing: ['আপনার খাবার তৈরি হচ্ছে।', 'Your food is being prepared.'],
  ready: ['আপনার খাবার প্রস্তুত!', 'Your food is ready!'],
  completed: ['ধন্যবাদ! আবার আসবেন।', 'Thank you! Enjoy your meal.'],
  cancelled: ['অর্ডারটি বাতিল হয়েছে। কোনো প্রশ্ন থাকলে স্টাফকে জানান।', 'This order was cancelled. Please ask a staff member if you have questions.'],
};

export default function OrderStatusPage() {
  const params = useParams<{ subdomain?: string; branchSlug?: string; branch?: string; token?: string }>();
  const location = useLocation();
  const store = typeof window !== 'undefined' ? (window as any).__STORE__ : undefined;
  const sub = params.subdomain ?? store?.subdomain ?? null;
  const branch = params.branchSlug ?? params.branch ?? store?.branch ?? null;
  const token = params.token ?? '';
  const lang: UiLang = 'en'; // the order page is always English
  const t = (pair: [string, string]) => tr(lang, pair[0], pair[1]);

  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [missing, setMissing] = useState(false);
  const [showConfirmed, setShowConfirmed] = useState(!!(location.state as any)?.justPlaced);
  const lastStatus = useRef<OrderStatus | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    getOrder(token).then((o) => {
      if (!alive) return;
      if (o) setOrder(o);
      else setMissing(true);
    });
    const stop = followOrder(token, (o) => alive && setOrder(o));
    return () => {
      alive = false;
      stop();
    };
  }, [token]);

  // a gentle buzz when the food is ready (phones that support it)
  useEffect(() => {
    if (!order) return;
    if (lastStatus.current && lastStatus.current !== order.status && order.status === 'ready') {
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* unsupported */
      }
    }
    lastStatus.current = order.status;
  }, [order]);

  const backHref = storeBasePath(sub, branch) || '/';

  if (missing) {
    return (
      <div className="min-h-screen bg-[#F6F5F8] flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-gray-700 mb-4">{tr(lang, 'অর্ডারটি খুঁজে পাওয়া যায়নি।', "We couldn't find this order.")}</p>
          <Link to={backHref} className="rounded-full bg-[#FA2851] px-5 py-2.5 text-white font-medium">
            {tr(lang, 'ওয়েটারের কাছে ফিরে যান', 'Back to the waiter')}
          </Link>
        </div>
      </div>
    );
  }

  if (!order) {
    return <div className="min-h-screen bg-[#F6F5F8] p-6 text-sm text-gray-500">{tr(lang, 'লোড হচ্ছে…', 'Loading…')}</div>;
  }

  const cancelled = order.status === 'cancelled';
  const online = order.channel === 'online';
  const delivery = online && order.fulfillment === 'delivery';
  const whereLabel = !online ? tr(lang, 'টেবিল', 'Table') : delivery ? tr(lang, 'ডেলিভারি', 'Delivery') : tr(lang, 'পিকআপ', 'Pickup');
  const whereShort = !online ? tr(lang, `টেবিল ${order.table}`, `Table ${order.table}`) : whereLabel;
  const currentIdx = STEPS.indexOf(order.status);
  const at = (s: OrderStatus) => order.statusHistory.find((h) => h.status === s)?.at;
  const time = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div className="min-h-screen bg-[#F6F5F8]" style={{ fontFamily: "'Noto Sans Bengali', system-ui, sans-serif" }}>
      <main className="max-w-2xl mx-auto px-4 pt-8 pb-16">
        <section className="flex items-center justify-between rounded-3xl bg-white px-6 py-4 shadow-sm">
          <div>
            <p className="text-xs text-gray-500">{tr(lang, 'অর্ডার', 'Order')}</p>
            <div className="text-3xl font-bold tracking-tight text-gray-900">#{order.orderNumber}</div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">{whereLabel}</p>
            <div className="text-xl font-semibold text-gray-900">{online ? order.customer?.name : order.table}</div>
          </div>
        </section>

        {online && order.customer && (
          <section className="mt-3 rounded-3xl bg-white px-6 py-4 text-sm text-gray-700 shadow-sm">
            <div>{order.customer.phone}</div>
            {delivery && order.customer.address && <div className="mt-1 text-gray-600">{order.customer.address}</div>}
          </section>
        )}

        {cancelled ? (
          <section className="mt-3 rounded-3xl bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-semibold text-red-600" aria-live="polite">
              {t(LABEL[order.status])}
            </p>
            <p className="mt-1 text-sm text-gray-600">{t(HINT[order.status])}</p>
          </section>
        ) : (
          <div className="mt-3">
            <OrderCountdown order={order} lang={lang} />
          </div>
        )}

        {!cancelled && (
          <section className="mt-3 rounded-3xl bg-white p-5 shadow-sm">
            <ol className="space-y-4">
              {STEPS.map((s, i) => {
                const done = i <= currentIdx;
                const current = i === currentIdx;
                return (
                  <li key={s} className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        done ? 'bg-[#FA2851] text-white' : 'bg-gray-100 text-gray-400'
                      } ${current ? 'ring-4 ring-[#FA2851]/20' : ''}`}
                      aria-hidden="true"
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    <span className={`flex-1 text-sm ${done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{t(LABEL[s])}</span>
                    <span className="text-xs text-gray-400">
                      {time(at(s)) ||
                        (s === 'accepted' && order.status === 'placed' ? tr(lang, 'অপেক্ষায়…', 'waiting…') : '') ||
                        (s === 'ready' && order.eta && order.status !== 'placed' ? tr(lang, `আনুমানিক ${time(order.eta.readyAt)}`, `est. ${time(order.eta.readyAt)}`) : '')}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section className="mt-3 rounded-3xl bg-white shadow-sm divide-y divide-gray-100">
          {order.items.map((l, i) => {
            const extras = [l.variation, ...l.modifiers.map((m) => m.name)].filter(Boolean).join(', ');
            return (
              <div key={i} className="p-4 flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-gray-900">
                    {l.qty} × {l.name}
                  </div>
                  {extras && <div className="text-xs text-gray-500">{extras}</div>}
                  {l.notes && <div className="text-xs text-amber-700">{tr(lang, 'নোট', 'Note')}: {l.notes}</div>}
                </div>
                <div className="font-medium text-gray-900">{money(l.lineTotal)}</div>
              </div>
            );
          })}
          {order.notes && <div className="p-4 text-sm text-amber-700">{tr(lang, 'নোট', 'Note')}: {order.notes}</div>}
          <div className="p-4 flex justify-between text-lg font-semibold text-gray-900">
            <span>{tr(lang, 'মোট', 'Total')}</span>
            <span>{money(order.total)}</span>
          </div>
          <div className="px-4 pb-4 text-sm text-gray-600">
            {order.payment.status === 'paid'
              ? tr(lang, 'পরিশোধিত ✓', 'Paid ✓')
              : delivery
              ? tr(lang, 'ক্যাশ অন ডেলিভারি।', 'Cash on delivery.')
              : online
              ? tr(lang, 'নেওয়ার সময় পরিশোধ করবেন।', 'Please pay when you pick it up.')
              : tr(lang, 'বিল কাউন্টারে পরিশোধ করবেন।', 'Please pay at the counter.')}
          </div>
        </section>

        <Link
          to={backHref}
          className="mt-5 block w-full rounded-2xl bg-white py-3.5 text-center font-semibold text-[#FA2851] shadow-sm"
        >
          {tr(lang, 'আরও কিছু অর্ডার করুন', 'Order something else')}
        </Link>
      </main>

      <OrderConfirmedModal
        open={showConfirmed}
        onClose={() => setShowConfirmed(false)}
        orderNumber={order.orderNumber}
        where={whereShort}
        total={order.total}
        minutesLeft={order.eta?.minutesLeft}
        waiting={order.status === 'placed'}
        payNote={
          delivery
            ? tr(lang, 'ক্যাশ অন ডেলিভারি।', 'Cash on delivery.')
            : online
            ? tr(lang, 'নেওয়ার সময় পরিশোধ করবেন — এই নম্বরটা বলবেন।', 'Pay when you pick it up — just quote this number.')
            : tr(lang, 'বিল কাউন্টারে দেবেন — এই নম্বরটা বলবেন।', 'Pay at the counter — just quote this number.')
        }
        lang={lang}
      />
    </div>
  );
}
