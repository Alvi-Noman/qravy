// apps/tastebud/src/components/OrderCountdown.tsx
// The guest's "how much longer?" — a live countdown ring to the kitchen's ready time, what's happening to the
// food right now, and a heads-up when the kitchen changes the time. Updates arrive live (SSE) with the order.
import { useEffect, useRef, useState } from 'react';
import type { PublicOrder } from '../api/orders';
import { useCountdown } from '../utils/wait-time';
import { tr, type UiLang } from '../utils/ui-lang';

const BRAND = '#FA2851';
const R = 52;
const C = 2 * Math.PI * R;

const STAGE: Record<string, [string, string, string, string]> = {
  // [bn title, en title, bn detail, en detail]
  placed: ['অর্ডার পাঠানো হয়েছে', 'Order sent', 'রেস্টুরেন্ট গ্রহণ করলেই সময় গোনা শুরু হবে।', 'The timer starts as soon as the restaurant accepts it.'],
  accepted: ['অর্ডার গ্রহণ করা হয়েছে', 'Order accepted', 'কিচেনে রান্নার লাইনে আছে।', "It's in line for the stove."],
  preparing: ['রান্না হচ্ছে', 'Being cooked', 'আপনার খাবার এখন তৈরি হচ্ছে।', 'Your food is on the stove right now.'],
};

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
}

function mmss(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function OrderCountdown({ order, lang }: { order: PublicOrder; lang: UiLang }) {
  const eta = order.eta;
  // nothing to count down until the restaurant has taken the order
  const waiting = order.status === 'placed';
  const cd = useCountdown(waiting ? undefined : eta?.readyAt, eta?.serverNow);
  const [notice, setNotice] = useState<string | null>(null);
  const prevReady = useRef<{ at: string; status: string } | null>(null);

  // the kitchen moved the time (+5 min / sooner) — tell the guest once. A status change re-times the order
  // by itself (cooking started → the clock restarts), which isn't news worth a banner.
  useEffect(() => {
    const next = eta?.readyAt ?? null;
    const prev = prevReady.current;
    prevReady.current = next ? { at: next, status: order.status } : null;
    if (!prev || !next || prev.status !== order.status || order.status === 'ready') return;
    const diff = Math.round((new Date(next).getTime() - new Date(prev.at).getTime()) / 60000);
    if (Math.abs(diff) < 2) return;
    setNotice(
      diff > 0
        ? tr(lang, `কিচেন সময় আপডেট করেছে: আরও ${diff} মিনিট`, `The kitchen updated your time: ${diff} more minutes`)
        : tr(lang, `সুখবর — ${-diff} মিনিট আগেই তৈরি হবে`, `Good news — about ${-diff} minutes sooner`),
    );
    const t = window.setTimeout(() => setNotice(null), 12_000);
    return () => window.clearTimeout(t);
  }, [eta?.readyAt, order.status, lang]);

  if (order.status === 'cancelled') return null;

  // --- done states
  if (order.status === 'ready' || order.status === 'completed') {
    const ready = order.status === 'ready';
    const kind = order.channel === 'online' ? (order.fulfillment === 'delivery' ? 'delivery' : 'pickup') : 'dine-in';
    const doneTitle = {
      'dine-in': tr(lang, 'খাবার পরিবেশন করা হয়েছে', 'Served — enjoy your meal'),
      pickup: tr(lang, 'অর্ডার নেওয়া হয়েছে', 'Picked up — enjoy your meal'),
      delivery: tr(lang, 'ডেলিভারি হয়েছে', 'Delivered — enjoy your meal'),
    }[kind];
    const readyText = {
      'dine-in': tr(lang, 'এখনই আপনার টেবিলে চলে আসবে।', "It's on its way to your table."),
      pickup: tr(lang, 'কাউন্টার থেকে নিয়ে নিন — অর্ডার নম্বরটা বলবেন।', 'Collect it at the counter — just quote your order number.'),
      delivery: tr(lang, 'শিগগিরই আপনার কাছে রওনা হবে।', "It'll be on its way to you shortly."),
    }[kind];
    return (
      <section className="rounded-3xl bg-white p-6 text-center shadow-sm" aria-live="polite">
        <div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full ${ready ? 'bg-emerald-50' : 'bg-gray-50'}`}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={ready ? '#059669' : '#6b7280'} strokeWidth="2.5" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className={`mt-4 text-xl font-semibold ${ready ? 'text-emerald-700' : 'text-gray-900'}`}>
          {ready ? tr(lang, 'আপনার খাবার তৈরি!', 'Your food is ready!') : doneTitle}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          {ready ? readyText : kind === 'dine-in' ? tr(lang, 'ধন্যবাদ! আবার আসবেন।', 'Thank you for dining with us.') : tr(lang, 'ধন্যবাদ! আবার অর্ডার করবেন।', 'Thanks for ordering!')}
        </p>
      </section>
    );
  }

  const stage = STAGE[order.status] ?? STAGE.placed;

  // --- sent, not accepted yet: no clock, just how long it usually takes once they do
  if (waiting) {
    return (
      <section className="rounded-3xl bg-white p-6 text-center shadow-sm" aria-live="polite">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-rose-50">
          <span className="relative flex h-5 w-5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: BRAND }} />
            <span className="relative inline-flex h-5 w-5 rounded-full" style={{ background: BRAND }} />
          </span>
        </div>
        <p className="mt-4 text-lg font-semibold text-gray-900">
          {tr(lang, 'রেস্টুরেন্টের গ্রহণের অপেক্ষায়', 'Waiting for the restaurant to accept')}
        </p>
        {/* no time until they accept — the clock starts then */}
        <p className="mt-1 text-sm text-gray-600">
          {tr(lang, 'অনুগ্রহ করে অপেক্ষা করুন — রেস্টুরেন্ট আপনার অর্ডারটি গ্রহণ করলেই আনুমানিক সময় দেখতে পাবেন।', "Please wait for the restaurant to accept your order. You'll see the estimated time as soon as they do.")}
        </p>
      </section>
    );
  }

  // --- no estimate (orders from before wait times existed)
  if (!eta || !cd) {
    return (
      <section className="rounded-3xl bg-white p-6 text-center shadow-sm" aria-live="polite">
        <p className="text-lg font-semibold text-gray-900">{tr(lang, stage[0], stage[1])}</p>
        <p className="mt-1 text-sm text-gray-600">{tr(lang, stage[2], stage[3])}</p>
      </section>
    );
  }

  // the countdown runs from when the current clock started: accepting starts it, cooking restarts it
  const startedAt =
    order.statusHistory.find((h) => h.status === order.status && (h.status === 'preparing' || h.status === 'accepted'))?.at ??
    order.createdAt;
  const total = Math.max(60_000, new Date(eta.readyAt).getTime() - new Date(startedAt).getTime());
  const progress = cd.overdue ? 1 : Math.min(1, Math.max(0.02, 1 - cd.msLeft / total));
  const late = cd.overdue;
  const ring = late ? '#f59e0b' : BRAND;
  const bigText = late ? tr(lang, 'প্রায় হয়ে গেছে', 'Almost') : cd.secsLeft >= 3600 ? `${Math.ceil(cd.secsLeft / 60)}m` : mmss(cd.secsLeft);

  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-col items-center">
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={R} fill="none" stroke="#F3F4F6" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={ring}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" role="timer" aria-live="off">
            <span className={`font-bold tabular-nums tracking-tight text-gray-900 ${late ? 'text-2xl' : 'text-4xl'}`}>{bigText}</span>
            <span className="mt-0.5 text-xs text-gray-500">
              {late ? tr(lang, 'একটু বেশি লাগছে', 'there') : tr(lang, 'বাকি', 'left')}
            </span>
          </div>
          {order.status === 'preparing' && !late && (
            <span className="absolute -top-1 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg shadow" aria-hidden="true">
              <span className="animate-pulse">🔥</span>
            </span>
          )}
        </div>

        <p className="mt-4 text-lg font-semibold text-gray-900" aria-live="polite">
          {late ? tr(lang, 'আর কয়েক মিনিট', 'Just a few more minutes') : tr(lang, stage[0], stage[1])}
        </p>
        <p className="mt-1 text-center text-sm text-gray-600">
          {late
            ? tr(lang, 'কিচেনে একটু বেশি সময় লাগছে — দুঃখিত, খাবার শিগগিরই আসছে।', "It's taking a little longer than expected — sorry, it's coming soon.")
            : tr(lang, stage[2], stage[3])}
        </p>
        {!late && (
          <p className="mt-3 rounded-full bg-gray-50 px-3 py-1 text-sm text-gray-700">
            {tr(lang, `আনুমানিক ${clock(eta.readyAt)}-এর মধ্যে তৈরি`, `Ready around ${clock(eta.readyAt)}`)}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
