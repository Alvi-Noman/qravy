// apps/rider/src/pages/Deliveries.tsx — one restaurant's deliveries for this rider (/r/<link>). The rider opens the
// link the restaurant sent them (or the app remembers it): no login. Built for one hand
// on a bike handle: big text, two big steps — slide for "Picked up", then "Delivered" — and the customer one tap
// away (Call, Open in Maps). The cash to take at the door in a big box. "Can't deliver?" tells the restaurant why.
// New deliveries appear by themselves (live). Bangla first, English one tap away.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { followRider, getRiderPage, riderAction, type ProblemReason, type RiderDelivery, type RiderPageData } from '../api';
import { forgetLink, saveLink, savedLinks } from '../links';

type Lang = 'bn' | 'en';
const tx = (lang: Lang, bn: string, en: string) => (lang === 'en' ? en : bn);
const BN = '০১২৩৪৫৬৭৮৯';
const num = (lang: Lang, n: number | string) => (lang === 'en' ? String(n) : String(n).replace(/[0-9]/g, (d) => BN[Number(d)]));
const money = (lang: Lang, n: number) => `৳${num(lang, n.toLocaleString('en-BD', { maximumFractionDigits: 0 }))}`;
const clock = (lang: Lang, d: string) => num(lang, new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const REASONS: Array<{ id: ProblemReason; bn: string; en: string }> = [
  { id: 'no-answer', bn: 'কাস্টমার ফোন ধরছেন না', en: 'Customer not answering' },
  { id: 'wrong-address', bn: 'ঠিকানা ভুল / খুঁজে পাচ্ছি না', en: "Wrong address / can't find it" },
  { id: 'refused', bn: 'কাস্টমার নিতে চাইছেন না', en: 'Customer refused' },
  { id: 'other', bn: 'অন্য সমস্যা', en: 'Another problem' },
];

/** Slide all the way to confirm — a pocket tap can't do it. (A range input: works with touch, mouse and keys.) */
function Slide({ label, onDone, busy, dark }: { label: string; onDone: () => void; busy: boolean; dark?: boolean }) {
  const [v, setV] = useState(0);
  const release = () => {
    if (v >= 92 && !busy) onDone();
    setV(0);
  };
  return (
    <div className={`relative h-16 overflow-hidden rounded-2xl ${dark ? 'bg-[#111]' : 'bg-[#0F766E]'} ${busy ? 'opacity-60' : ''}`}>
      <div className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-75" style={{ width: `${v}%` }} />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[18px] font-bold text-white">
        {busy ? '…' : label}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-[22px] font-bold text-[#111]"
        style={{ left: `calc(${v}% * 0.82 + 8px)` }}
      >
        →
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={v}
        disabled={busy}
        aria-label={label}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={release}
        onTouchEnd={release}
        onKeyUp={(e) => (e.key === 'Enter' || e.key === 'End') && !busy && onDone()}
        className="absolute inset-0 h-full w-full cursor-grab opacity-0"
      />
    </div>
  );
}

function ProblemSheet({ lang, onClose, onSend }: { lang: Lang; onClose: () => void; onSend: (r: ProblemReason, note: string) => Promise<void> }) {
  const [reason, setReason] = useState<ProblemReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={tx(lang, 'ডেলিভারি করা যাচ্ছে না', "Can't deliver")}
        className="w-full max-w-[480px] rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[20px] font-bold">{tx(lang, 'কী সমস্যা হয়েছে?', "What's the problem?")}</h2>
        <p className="mt-1 text-[14px] text-[#555]">{tx(lang, 'রেস্টুরেন্ট সাথে সাথে দেখতে পাবে।', 'The restaurant sees it right away.')}</p>
        <div className="mt-4 flex flex-col gap-2">
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setReason(r.id)}
              className={`h-14 rounded-2xl border px-4 text-left text-[16px] font-semibold ${reason === r.id ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]' : 'border-[#DDD]'}`}
            >
              {tx(lang, r.bn, r.en)}
            </button>
          ))}
        </div>
        <textarea
          id="rider-problem-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder={tx(lang, 'আরও কিছু বলবেন? (ঐচ্ছিক)', 'Anything else? (optional)')}
          className="mt-3 w-full rounded-2xl border border-[#DDD] px-4 py-3 text-[15px] outline-none"
        />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="h-14 flex-1 rounded-2xl border border-[#DDD] text-[16px] font-semibold">
            {tx(lang, 'বাতিল', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={!reason || busy}
            onClick={async () => {
              if (!reason) return;
              setBusy(true);
              await onSend(reason, note.trim()).finally(() => setBusy(false));
            }}
            className="h-14 flex-1 rounded-2xl bg-[#B91C1C] text-[16px] font-bold text-white disabled:opacity-40"
          >
            {tx(lang, 'রেস্টুরেন্টকে জানান', 'Tell the restaurant')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeliveryCard({ d, lang, busy, onAction, onProblem }: { d: RiderDelivery; lang: Lang; busy: boolean; onAction: (a: 'picked_up' | 'delivered') => void; onProblem: () => void }) {
  const c = d.customer;
  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-[#E5E5E5] bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[24px] font-bold tracking-[-0.3px]">#{num(lang, d.orderNumber)}</span>
        <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${d.pickedUpAt ? 'bg-[#E3F2F0] text-[#0F766E]' : 'bg-[#F3F3F3] text-[#444]'}`}>
          {d.pickedUpAt ? tx(lang, `পথে · ${clock(lang, d.pickedUpAt)} থেকে`, `On the way since ${clock(lang, d.pickedUpAt)}`) : tx(lang, 'রেস্টুরেন্ট থেকে নিন', 'Pick up at the restaurant')}
        </span>
      </div>
      {c && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-[#EEE] p-3.5">
          <span className="text-[12px] font-bold tracking-[0.8px] text-[#777]">{tx(lang, 'কাস্টমার', 'CUSTOMER')}</span>
          <span className="text-[18px] font-bold">{c.name}</span>
          {c.address && <span className="text-[17px] leading-snug">{c.address}</span>}
          {d.notes && <span className="rounded-xl bg-[#FFF8E6] px-3 py-2 text-[14px] text-[#6B4E00]">{d.notes}</span>}
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <a href={`tel:${c.phone}`} className="flex h-12 items-center justify-center rounded-xl border border-[#D5D5D5] text-[16px] font-semibold">
              {tx(lang, 'কল করুন', 'Call')}
            </a>
            {c.address ? (
              <a href={mapsUrl(c.address)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center rounded-xl border border-[#D5D5D5] text-[16px] font-semibold">
                {tx(lang, 'ম্যাপে দেখুন', 'Open in Maps')}
              </a>
            ) : (
              <span />
            )}
          </div>
        </div>
      )}
      <div className={`flex flex-col gap-0.5 rounded-2xl border p-3.5 ${d.collect > 0 ? 'border-[#F2D59A] bg-[#FFF6E5]' : 'border-[#CDE8D6] bg-[#EEF8F1]'}`}>
        <span className="text-[12px] font-bold tracking-[0.8px] text-[#7A5A1A]">
          {d.collect > 0 ? tx(lang, 'নগদ নিতে হবে', 'COLLECT CASH') : tx(lang, 'পরিশোধ হয়ে গেছে', 'ALREADY PAID')}
        </span>
        <span className="text-[26px] font-bold">{d.collect > 0 ? money(lang, d.collect) : tx(lang, 'কিছু নিতে হবে না', 'Collect nothing')}</span>
        <span className="text-[13px] text-[#6b6b6b]">{tx(lang, `${num(lang, d.items)}টা আইটেম`, `${d.items} items`)}</span>
      </div>
      {d.problem && (
        <p className="rounded-xl bg-[#FEF2F2] px-3 py-2 text-[14px] text-[#991B1B]">
          {tx(lang, 'রেস্টুরেন্টকে জানানো হয়েছে: ', 'Restaurant told: ')}
          {tx(lang, REASONS.find((r) => r.id === d.problem!.reason)?.bn ?? '', REASONS.find((r) => r.id === d.problem!.reason)?.en ?? '')}
        </p>
      )}
      {d.pickedUpAt ? (
        <Slide dark label={d.collect > 0 ? tx(lang, `ডেলিভারি হয়েছে · ${money(lang, d.collect)} নিয়েছি`, `Delivered · got ${money(lang, d.collect)}`) : tx(lang, 'ডেলিভারি হয়েছে', 'Delivered')} busy={busy} onDone={() => onAction('delivered')} />
      ) : (
        <Slide label={tx(lang, 'খাবার নিয়েছি', 'Picked up')} busy={busy} onDone={() => onAction('picked_up')} />
      )}
      <button type="button" onClick={onProblem} className="h-11 text-[14px] font-semibold text-[#777] underline">
        {tx(lang, 'ডেলিভারি করা যাচ্ছে না?', "Can't deliver?")}
      </button>
    </article>
  );
}

export default function Deliveries() {
  const { token: link = '' } = useParams<{ token?: string }>();
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('qravy:rider:lang') === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });
  const [data, setData] = useState<RiderPageData | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getRiderPage(link);
      if (!d) {
        setGone(true);
        forgetLink(link); // (reset or removed: off this phone's list)
      } else {
        setData(d);
        setError(null);
        // remembered on this phone: the app opens here next time
        saveLink({ token: link, restaurant: d.restaurant.name, rider: d.rider.name });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [link]);
  useEffect(() => {
    void load();
    return followRider(link, () => void load());
  }, [link, load]);
  useEffect(() => {
    try {
      localStorage.setItem('qravy:rider:lang', lang);
    } catch {
      /* storage blocked */
    }
  }, [lang]);
  useEffect(() => {
    document.title = data ? `${data.restaurant.name} · ${tx(lang, 'ডেলিভারি', 'Deliveries')}` : tx(lang, 'ডেলিভারি', 'Deliveries');
  }, [data, lang]);

  const say = (text: string) => {
    setFlash(text);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 3500);
  };
  const act = async (d: RiderDelivery, action: 'picked_up' | 'delivered' | 'problem', extra?: { reason?: ProblemReason; note?: string }) => {
    setBusyId(d.id);
    try {
      setData(await riderAction(link, d.id, action, extra));
      try {
        navigator.vibrate?.(40);
      } catch {
        /* unsupported */
      }
      say(
        action === 'picked_up'
          ? tx(lang, `#${num(lang, d.orderNumber)} নেওয়া হয়েছে — কাস্টমার জানতে পেরেছেন`, `#${d.orderNumber} picked up — the customer can see you're on the way`)
          : action === 'delivered'
          ? tx(lang, `#${num(lang, d.orderNumber)} ডেলিভারি হয়েছে`, `#${d.orderNumber} delivered`)
          : tx(lang, 'রেস্টুরেন্টকে জানানো হয়েছে', 'The restaurant has been told'),
      );
    } catch (e) {
      say((e as Error).message);
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const active = (data?.deliveries ?? []).filter((d) => !d.deliveredAt);
  const done = (data?.deliveries ?? []).filter((d) => d.deliveredAt);
  const cash = done.reduce((n, d) => n + (d.cashCollected || 0), 0);

  return (
    <div className="min-h-[100dvh] bg-[#F6F6F4] text-[#111]" style={{ fontFamily: 'Inter, "Noto Sans Bengali", system-ui, sans-serif' }}>
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 pb-10 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[#666]">{data?.restaurant.name ?? ''}</div>
            <div className="truncate text-[22px] font-bold">{data ? data.rider.name : tx(lang, 'ডেলিভারি', 'Deliveries')}</div>
          </div>
          {savedLinks().length > 1 && (
            <Link to="/connect" className="flex h-11 shrink-0 items-center rounded-full border border-[#D5D5D5] bg-white px-4 text-[14px] font-semibold">
              {tx(lang, 'রেস্টুরেন্ট বদলান', 'Switch')}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
            className="h-11 shrink-0 rounded-full border border-[#D5D5D5] bg-white px-4 text-[14px] font-semibold"
          >
            {lang === 'bn' ? 'English' : 'বাংলা'}
          </button>
        </header>

        {flash && (
          <div role="status" className="rounded-2xl bg-[#111] px-4 py-3 text-[15px] font-semibold text-white">
            {flash}
          </div>
        )}

        {gone ? (
          <div className="mt-10 rounded-3xl bg-white p-6 text-center">
            <p className="text-[18px] font-bold">{tx(lang, 'এই লিংকটা আর কাজ করছে না', 'This link no longer works')}</p>
            <p className="mt-2 text-[15px] text-[#555]">{tx(lang, 'রেস্টুরেন্টের কাছ থেকে নতুন লিংক নিন।', 'Ask the restaurant for a new one.')}</p>
            <Link to="/connect" className="mt-4 inline-flex h-12 items-center rounded-2xl bg-[#111] px-6 text-[15px] font-semibold text-white">
              {tx(lang, 'নতুন লিংক দিন', 'Add a new link')}
            </Link>
          </div>
        ) : !data ? (
          error ? (
            <div className="mt-10 rounded-3xl bg-white p-6 text-center">
              <p className="text-[16px] font-semibold">{tx(lang, 'লোড করা যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।', "Couldn't load. Check the internet and try again.")}</p>
              <button type="button" onClick={() => void load()} className="mt-4 h-12 rounded-2xl bg-[#111] px-6 text-[15px] font-semibold text-white">
                {tx(lang, 'আবার চেষ্টা করুন', 'Try again')}
              </button>
            </div>
          ) : (
            <div className="mt-6 h-64 animate-pulse rounded-3xl bg-white" />
          )
        ) : (
          <>
            {!data.rider.onDuty && (
              <p className="rounded-2xl bg-[#FFF6E5] px-4 py-3 text-[14px] text-[#6B4E00]">
                {tx(lang, 'আপনি এখন অফ ডিউটি — রেস্টুরেন্ট আপনাকে নতুন অর্ডার দেবে না।', "You're off duty — the restaurant won't send you new orders.")}
              </p>
            )}
            {active.length ? (
              active.map((d) => (
                <DeliveryCard key={d.id} d={d} lang={lang} busy={busyId === d.id} onAction={(a) => void act(d, a)} onProblem={() => setProblemFor(d.id)} />
              ))
            ) : (
              <div className="rounded-3xl bg-white p-6 text-center">
                <p className="text-[18px] font-bold">{tx(lang, 'এখন কোনো ডেলিভারি নেই', 'No deliveries right now')}</p>
                <p className="mt-1 text-[15px] text-[#555]">{tx(lang, 'নতুন অর্ডার এলে এখানেই দেখা যাবে।', 'New orders show up here by themselves.')}</p>
              </div>
            )}
            {done.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="px-1 text-[13px] font-bold tracking-[0.8px] text-[#777]">
                  {tx(lang, `আজ ডেলিভারি করেছেন · ${num(lang, done.length)}টা`, `DELIVERED TODAY · ${done.length}`)}
                  {cash > 0 ? tx(lang, ` · নগদ ${money(lang, cash)}`, ` · cash ${money(lang, cash)}`) : ''}
                </h2>
                {done.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-[15px]">
                    <span className="font-semibold">#{num(lang, d.orderNumber)}</span>
                    <span className="text-[#666]">{clock(lang, d.deliveredAt!)}</span>
                    <span className="font-semibold">{d.cashCollected ? money(lang, d.cashCollected) : tx(lang, 'পরিশোধিত', 'Paid')}</span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      {problemFor && (
        <ProblemSheet
          lang={lang}
          onClose={() => setProblemFor(null)}
          onSend={async (reason, note) => {
            const d = data?.deliveries.find((x) => x.id === problemFor);
            setProblemFor(null);
            if (d) await act(d, 'problem', { reason, ...(note ? { note } : {}) });
          }}
        />
      )}
    </div>
  );
}
