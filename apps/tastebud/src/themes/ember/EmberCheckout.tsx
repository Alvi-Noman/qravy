// apps/tastebud/src/themes/ember/EmberCheckout.tsx
// Ember — the order before it's placed.
//   Dine-in (6.1): "Your order" — steppers, a note for the kitchen, the total, "Send to kitchen · ৳" (or say "send it").
//     Paying at a table is staff-only (Call waiter → Bring the bill).
//   Online (9.4 → 10.1 / 10.2): "Your order" with "Checkout · ৳", then one checkout page: Delivery | Pickup, your
//     details, the address (delivery) or where to collect it (pickup), payment, the summary, "Place order · ৳".
// Placing the order is the same as the original theme's checkout (api/orders.placeOrder); the waiter is the shared one.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart, cartLineKey, type CartItem } from '../../context/CartContext';
import { usePublicMenu } from '../../hooks/usePublicMenu';
import { useWaiterSession } from '../../waiter/useWaiterSession';
import { OrderApiError, cartIdempotencyKey, orderAttemptDone, placeOrder, rememberOrder } from '../../api/orders';
import { clearOrderNote, missingContactField, useGuestContact, useOrderNote, usePickupPlace, type GuestContact } from '../../utils/order-mode';
import { orderPath } from '../../utils/checkout-flow';
import { getStableSessionId } from '../../utils/ws';
import { useCartWait } from '../../utils/wait-time';
import { money } from '../../utils/ui-lang';
import { track } from '../../utils/track';
import { useEmberChrome } from './Chrome';
import { useStoreRoute } from './store';
import { WaitingDish } from './WaitingDish';
import { BottomBar, DishSheet, EM, I, LineWarning, Orb, Shell, TopBar, imageOf, lineWarning, tx, type Lang } from './ui';

function Stepper({ qty, onMinus, onPlus, name, lang }: { qty: number; onMinus: () => void; onPlus: () => void; name: string; lang: Lang }) {
  return (
    <div className="flex h-10 items-center rounded-full" style={{ background: EM.surface2 }}>
      <button type="button" aria-label={tx(lang, `${name} একটা কম`, `One less ${name}`)} onClick={onMinus} className="flex h-10 w-10 items-center justify-center">
        {qty === 1 ? I.trash({ size: 14 }) : I.minus()}
      </button>
      <span className="min-w-[16px] text-center text-[15px] font-semibold tabular-nums">{qty}</span>
      <button type="button" aria-label={tx(lang, `${name} আরেকটা`, `One more ${name}`)} onClick={onPlus} className="flex h-10 w-10 items-center justify-center">
        {I.plus({ size: 14 })}
      </button>
    </div>
  );
}

function Field({
  label,
  optional,
  value,
  onChange,
  placeholder,
  prefix,
  error,
  inputMode,
  autoComplete,
  focus,
  lang,
}: {
  label: string;
  optional?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  error?: string | null;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  focus?: boolean;
  lang: Lang;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focus]);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium" style={{ color: EM.text3 }}>
        {label} {optional && <span className="font-normal" style={{ color: EM.muted }}>({tx(lang, 'ঐচ্ছিক', 'optional')})</span>}
      </span>
      <span className="flex h-[52px] items-center rounded-[14px] px-4" style={{ border: `1px solid ${error ? EM.danger : EM.border}`, background: EM.surface }}>
        {prefix && (
          <span className="mr-2.5 shrink-0 pr-2.5 text-[16px]" style={{ borderRight: `1px solid ${EM.border}`, color: EM.text2 }}>
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#6E6E73]"
          style={{ color: EM.text }}
        />
      </span>
      {error && <span className="text-[12px]" style={{ color: EM.danger }}>{error}</span>}
    </label>
  );
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[20px] p-[18px]" style={{ background: EM.card, border: '1px solid #222225' }}>
      <div className="flex items-baseline justify-between">
        <span className="em-tight text-[18px] font-semibold">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function PayOption({ title, sub, on, disabled, onClick, soon }: { title: string; sub: string; on: boolean; disabled?: boolean; onClick?: () => void; soon?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className="flex min-h-[60px] items-center gap-3.5 rounded-[14px] px-4 py-2.5 text-left"
      style={{ border: on ? `1.5px solid ${EM.amber}` : `1px solid ${EM.border}`, background: EM.surface, opacity: disabled ? 0.5 : 1 }}
    >
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${on ? EM.amber : '#48484D'}` }}>
        {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: EM.amber }} />}
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-semibold">{title}</span>
        <span className="text-[13px]" style={{ color: EM.text3 }}>{sub}</span>
      </span>
      {soon && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: EM.surface2, color: EM.text3 }}>{soon}</span>}
    </button>
  );
}

export default function EmberCheckout() {
  const navigate = useNavigate();
  const route = useStoreRoute();
  const { sub, branch, channel, online, table } = route;
  const { items, subtotal, count, setLineQty, removeLine, clear, warnings, lastChange } = useCart();
  const { items: menu } = usePublicMenu(sub, branch ?? undefined, channel);
  const menuById = useMemo(() => new Map(menu.map((m: any) => [String(m.id), m])), [menu]);
  // a line tapped → its size / choices / qty (the original theme's line editor)
  const [editLine, setEditLine] = useState<CartItem | null>(null);
  // what the waiter just changed by voice glows for a moment (as in the original theme's tray)
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const keys = [...(lastChange?.added ?? []), ...(lastChange?.changed ?? []).map((c) => c.after)].map((l) => cartLineKey(l));
    if (!keys.length) return;
    setFresh(new Set(keys));
    const t = window.setTimeout(() => setFresh(new Set()), 2400);
    return () => window.clearTimeout(t);
  }, [lastChange]);
  const [step, setStep] = useState<'review' | 'details'>('review');
  const [contact, setContact] = useGuestContact(sub);
  const [focus, setFocus] = useState<keyof GuestContact | null>(null);
  const [note, setNote] = useOrderNote(sub);
  const [noteOpen, setNoteOpen] = useState(!!note);
  const [flat, setFlat] = useState('');
  const [riderNote, setRiderNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickupAt = usePickupPlace(sub, branch);
  const wait = useCartWait({ subdomain: sub, branch, items });

  const w = useWaiterSession({
    subdomain: sub,
    branch: branch ?? undefined,
    channel,
    onOpenMenu: () => navigate(route.menuHref()),
    // the waiter asked for the table / the guest's details → this page's own fields
    onCheckoutStep: (ask) => {
      if (!online || !ask) return;
      setStep('details');
      setFocus(missingContactField(chrome.fulfillment, contact));
    },
  });
  const chrome = useEmberChrome({ w, route });
  const lang = chrome.lang;
  const fulfillment = chrome.fulfillment;

  // a dish waiting for its size / choice (asked for by voice here) keeps the order open, as in the original theme
  const hasItems = items.length > 0 || w.pickOptions.length > 0;

  // what changed since the guest last looked at this page: "নতুন" / "বদলেছে" on those lines, so a read-back is two
  // lines to check, not ten (remembered for this restaurant when they leave the page)
  const seenKey = `qravy:ember:seen:${sub}`;
  const [seen] = useState<{ keys: Record<string, number>; ids: Record<string, true> } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(seenKey) || 'null');
    } catch {
      return null;
    }
  });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      try {
        if (!itemsRef.current.length) return sessionStorage.removeItem(seenKey); // (order sent: start fresh)
        const keys: Record<string, number> = {};
        const ids: Record<string, true> = {};
        for (const l of itemsRef.current) {
          keys[cartLineKey(l)] = l.qty;
          ids[l.id] = true;
        }
        sessionStorage.setItem(seenKey, JSON.stringify({ keys, ids }));
      } catch {
        /* storage blocked */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const markOf = (l: CartItem): 'new' | 'changed' | null => {
    if (!seen) return null;
    const key = cartLineKey(l);
    if (seen.keys[key] === l.qty) return null;
    return seen.keys[key] !== undefined || seen.ids[l.id] ? 'changed' : 'new';
  };
  useEffect(() => {
    if (hasItems) track('checkout_started', { page: 'checkout' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems]);

  const lines = useMemo(
    () => items.map((l) => ({ key: cartLineKey(l), l, extras: [l.variation, ...(l.modifiers ?? []).map((m) => m.name)].filter(Boolean).join(', ') })),
    [items],
  );

  const CONTACT_ERR: Record<keyof GuestContact, string> = {
    name: tx(lang, 'আপনার নাম লিখুন', 'Please enter your name'),
    phone: tx(lang, 'সঠিক মোবাইল নম্বর লিখুন', 'Please enter a valid mobile number'),
    address: tx(lang, 'ডেলিভারির ঠিকানা লিখুন', 'Please enter the delivery address'),
  };

  async function submit() {
    setError(null);
    setFocus(null);
    if (online) {
      const missing = missingContactField(fulfillment, contact);
      if (missing) {
        setFocus(missing);
        return setError(CONTACT_ERR[missing]);
      }
    } else if (!table) {
      return setError(tx(lang, 'টেবিলের QR কোডটা আবার স্ক্যান করুন — তারপর অর্ডার দিতে পারবেন।', 'Please scan the QR code on your table again, then order.'));
    }
    if (!items.length) return;
    setPlacing(true);
    try {
      const sid = getStableSessionId();
      const notes = [note.trim(), online && fulfillment === 'delivery' && riderNote.trim() ? `${tx(lang, 'রাইডারের জন্য', 'For the rider')}: ${riderNote.trim()}` : '']
        .filter(Boolean)
        .join(' · ');
      const common = { subdomain: sub, branch, items, notes, sessionId: sid, idempotencyKey: cartIdempotencyKey(sid, items) };
      const address = [contact.address.trim(), flat.trim()].filter(Boolean).join(', ');
      const { order } = await placeOrder(
        online
          ? { ...common, channel: 'online', fulfillment, customer: { ...contact, address } }
          : { ...common, channel: 'dine-in', table: table as string },
      );
      clear({ silent: true });
      clearOrderNote(sub);
      orderAttemptDone(sid, items);
      rememberOrder(sub, order);
      // straight to the order's status — no "thank you" popup
      navigate(orderPath(order.token, sub, branch), { replace: true, state: { justPlaced: true } });
    } catch (e) {
      const err = e as OrderApiError;
      if (err?.needs === 'name' || err?.needs === 'phone' || err?.needs === 'address') {
        setStep('details');
        setFocus(err.needs);
      }
      setError(err?.message || tx(lang, 'অর্ডার দেওয়া যায়নি। আবার চেষ্টা করুন।', "Couldn't place the order. Please try again."));
    } finally {
      setPlacing(false);
    }
  }

  const orbLabel =
    w.orbMode === 'listening'
      ? tx(lang, 'শুনছি', 'Listening')
      : w.orbMode === 'thinking'
      ? tx(lang, 'ভাবছি', 'Thinking')
      : w.orbMode === 'talking'
      ? tx(lang, 'থামাতে ট্যাপ করুন', 'Tap to interrupt')
      : online
      ? tx(lang, 'অথবা বলুন “চেকআউট”', 'Or say “checkout”')
      : tx(lang, 'অথবা বলুন “পাঠিয়ে দিন”', 'Or say “send it”');

  /* ---------------------------------------------------------- empty order */
  if (!hasItems)
    return (
      <Shell glow="calm" header={<TopBar onBack={() => navigate(route.homeHref)} title={tx(lang, 'আপনার অর্ডার', 'Your order')} right={chrome.right} />} overlay={chrome.overlays}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <p className="em-tight text-[22px] font-medium">{tx(lang, 'আপনার অর্ডার এখনো খালি।', 'Your order is empty.')}</p>
          <button type="button" onClick={() => navigate(route.menuHref())} className="h-[54px] rounded-full px-6 text-[15px] font-semibold" style={{ background: EM.text, color: EM.bg }}>
            {tx(lang, 'মেনু দেখুন', 'Browse the menu')}
          </button>
        </div>
      </Shell>
    );

  /* ------------------------------------------------- 10.1 / 10.2 checkout */
  if (online && step === 'details') {
    const delivery = fulfillment === 'delivery';
    return (
      <Shell
        glow="none"
        header={<TopBar onBack={() => setStep('review')} title={tx(lang, 'চেকআউট', 'Checkout')} right={chrome.right} />}
        footer={
          <div className="flex flex-col gap-2.5 px-5 pt-3.5" style={{ borderTop: `1px solid ${EM.borderSoft}` }}>
            <span className="text-center text-[13px]" style={{ color: EM.text3 }}>
              {delivery
                ? tx(lang, `ডেলিভারির সময় রাইডারকে ${money(subtotal)} নগদ দেবেন`, `You’ll pay ${money(subtotal)} in cash to the rider`)
                : tx(lang, `নেওয়ার সময় ${money(subtotal)} পরিশোধ করবেন`, `You’ll pay ${money(subtotal)} when you pick it up`)}
            </span>
            <button type="button" onClick={submit} disabled={placing} className="h-[58px] rounded-full text-[17px] font-bold disabled:opacity-60" style={{ background: EM.amber, color: EM.bg }}>
              {placing ? tx(lang, 'অর্ডার দেওয়া হচ্ছে…', 'Placing order…') : `${tx(lang, 'অর্ডার দিন', 'Place order')} · ${money(subtotal)}`}
            </button>
          </div>
        }
        overlay={chrome.overlays}
      >
        <div className="em-noscroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
          <div className="flex flex-col gap-4">
            {/* Delivery | Pickup — it changes the form */}
            <div role="group" aria-label={tx(lang, 'অর্ডারের ধরন', 'Order type')} className="flex gap-0.5 rounded-[21px] p-[3px]" style={{ border: `1px solid ${EM.border}`, background: EM.surface }}>
              {(['delivery', 'pickup'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={fulfillment === f}
                  onClick={() => chrome.setFulfillment(f)}
                  className="h-9 flex-1 rounded-[18px] text-[14px]"
                  style={fulfillment === f ? { background: EM.text, color: EM.bg, fontWeight: 600 } : { color: EM.text2, fontWeight: 500 }}
                >
                  {f === 'delivery' ? tx(lang, 'ডেলিভারি', 'Delivery') : tx(lang, 'পিকআপ', 'Pickup')}
                </button>
              ))}
            </div>

            <Card title={tx(lang, 'আপনার তথ্য', 'Your details')}>
              <Field lang={lang} label={tx(lang, 'পুরো নাম', 'Full name')} value={contact.name} onChange={(v) => setContact({ name: v })} placeholder={tx(lang, 'যেমন: রহিম উদ্দিন', 'e.g. Rahim Uddin')} autoComplete="name" focus={focus === 'name'} error={focus === 'name' ? error : null} />
              <Field
                lang={lang}
                label={tx(lang, 'মোবাইল নম্বর', 'Mobile number')}
                prefix="+880"
                value={contact.phone}
                onChange={(v) => setContact({ phone: v.replace(/[^\d]/g, '').slice(0, 11) })}
                placeholder="01XXXXXXXXX"
                inputMode="numeric"
                autoComplete="tel-national"
                focus={focus === 'phone'}
                error={focus === 'phone' ? error : null}
              />
            </Card>

            {delivery ? (
              <Card title={tx(lang, 'ডেলিভারির ঠিকানা', 'Delivery address')}>
                <Field lang={lang} label={tx(lang, 'বাড়ি, রোড, এলাকা', 'House, road, area')} value={contact.address} onChange={(v) => setContact({ address: v })} placeholder={tx(lang, 'যেমন: বাড়ি ১২, রোড ৫, ব্লক সি, ধানমন্ডি', 'e.g. House 12, Road 5, Block C, Dhanmondi')} autoComplete="street-address" focus={focus === 'address'} error={focus === 'address' ? error : null} />
                <Field lang={lang} optional label={tx(lang, 'ফ্ল্যাট / তলা', 'Flat / floor')} value={flat} onChange={setFlat} placeholder={tx(lang, 'যেমন: ৪বি, ৪র্থ তলা', 'e.g. 4B, 4th floor')} />
                <Field lang={lang} optional label={tx(lang, 'রাইডারের জন্য নোট', 'Note for the rider')} value={riderNote} onChange={setRiderNote} placeholder={tx(lang, 'যেমন: গেটে এসে কল দিন', 'e.g. Call when you reach the gate')} />
                <span className="flex items-center gap-2.5 text-[14px]" style={{ color: EM.text3 }}>
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md" style={{ background: EM.amber, color: EM.bg }}>{I.check({ size: 12 })}</span>
                  {tx(lang, 'পরের বারের জন্য এই ফোনে মনে রাখা হবে', 'Remembered on this phone for next time')}
                </span>
              </Card>
            ) : (
              <Card title={tx(lang, 'যেখান থেকে নেবেন', 'Pick up from')}>
                <div className="flex flex-col gap-1">
                  <span className="text-[16px] font-semibold">{pickupAt.name || route.info?.name}</span>
                  {pickupAt.address && <span className="text-[14px] leading-[1.4]" style={{ color: EM.text3 }}>{pickupAt.address}</span>}
                </div>
                <span className="text-[13px] font-medium" style={{ color: EM.text3 }}>{tx(lang, 'কখন', 'When')}</span>
                <div className="flex gap-2">
                  <button type="button" aria-pressed="true" className="h-12 flex-1 rounded-[14px] text-[15px] font-semibold" style={{ border: `1.5px solid ${EM.amber}`, background: EM.amberTint }}>
                    {tx(lang, 'যত তাড়াতাড়ি সম্ভব', 'As soon as possible')}
                  </button>
                </div>
                {wait && <span className="text-[13px]" style={{ color: EM.text3 }}>{tx(lang, `সাধারণত ~${wait.totalMinutes} মিনিটে তৈরি হয়`, `Usually ready in ~${wait.totalMinutes} min`)}</span>}
              </Card>
            )}

            <Card title={tx(lang, 'পেমেন্ট', 'Payment')} aside={!delivery ? <span className="text-[13px]" style={{ color: EM.text3 }}>{tx(lang, 'ঐচ্ছিক', 'Optional')}</span> : undefined}>
              {delivery ? (
                <PayOption on title={tx(lang, 'ক্যাশ অন ডেলিভারি', 'Cash on delivery')} sub={tx(lang, 'রাইডারকে নগদ দিন', 'Pay the rider in cash')} />
              ) : (
                <PayOption on title={tx(lang, 'নেওয়ার সময় পরিশোধ', 'Pay at pickup')} sub={tx(lang, 'কাউন্টারে নগদ বা কার্ডে', 'Cash or card at the counter')} />
              )}
              {['bKash', 'Nagad', 'Rocket'].map((p) => (
                <PayOption key={p} disabled on={false} title={p} sub={tx(lang, `আপনার ${p} অ্যাকাউন্ট দিয়ে`, `Pay with your ${p} account`)} soon={tx(lang, 'শীঘ্রই', 'Soon')} />
              ))}
              <PayOption disabled on={false} title={tx(lang, 'কার্ড', 'Card')} sub="Visa, Mastercard, Amex" soon={tx(lang, 'শীঘ্রই', 'Soon')} />
            </Card>

            <Card title={tx(lang, 'অর্ডারের সারাংশ', 'Order summary')} aside={<button type="button" onClick={() => setStep('review')} className="h-11 text-[14px] font-semibold" style={{ color: EM.amber }}>{tx(lang, 'বদলান', 'Edit')}</button>}>
              <span className="text-[14px]" style={{ color: EM.text3 }}>{items.map((l) => `${l.qty} × ${l.name}`).join(', ')}</span>
              <div className="flex justify-between text-[15px]" style={{ color: EM.text2 }}>
                <span>{tx(lang, 'সাবটোটাল', 'Subtotal')}</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="h-px" style={{ background: EM.border }} />
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[16px] font-semibold">{tx(lang, 'মোট', 'Total')}</span>
                <span className="text-[20px] font-bold">{money(subtotal)}</span>
              </div>
              <span className="text-[12px]" style={{ color: EM.muted }}>{tx(lang, 'চূড়ান্ত দাম (ডেলিভারি চার্জ, ভ্যাট) রেস্টুরেন্ট নিশ্চিত করবে।', 'The restaurant confirms the final price (delivery fee, VAT).')}</span>
            </Card>
            {error && !focus && <div role="alert" className="rounded-2xl p-3 text-[14px]" style={{ background: '#2A1414', color: EM.danger }}>{error}</div>}
            <p className="mx-1 text-[12px] leading-[1.5]" style={{ color: EM.muted }}>
              {tx(lang, 'অর্ডার দিয়ে আপনি রেস্টুরেন্টের শর্তে সম্মত হচ্ছেন।', "By placing this order you agree to the restaurant's terms.")}
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------ 6.1 / 9.4 your order */
  return (
    <Shell
      glow="calm"
      header={<TopBar onBack={() => navigate(route.homeHref)} title={tx(lang, 'আপনার অর্ডার', 'Your order')} right={chrome.right} />}
      footer={
        <div className="flex flex-col gap-3">
          {error && <div role="alert" className="mx-6 rounded-2xl p-3 text-[14px]" style={{ background: '#2A1414', color: EM.danger }}>{error}</div>}
          <button
            type="button"
            onClick={online ? () => setStep('details') : submit}
            disabled={placing}
            className="em-rise mx-6 h-[58px] rounded-full text-[17px] font-bold disabled:opacity-60"
            style={{ background: EM.amber, color: EM.bg }}
          >
            {placing
              ? tx(lang, 'পাঠানো হচ্ছে…', 'Sending…')
              : online
              ? `${tx(lang, 'চেকআউট', 'Checkout')} · ${money(subtotal)}`
              : `${tx(lang, 'কিচেনে পাঠান', 'Send to kitchen')} · ${money(subtotal)}`}
          </button>
          <BottomBar lang={lang} onMenu={() => navigate(route.menuHref())} onType={chrome.openChat} orb={<Orb mode={w.orbMode} label={orbLabel} pressProps={w.orbPressProps} ballRef={w.orbBallRef} />} />
        </div>
      }
      overlay={
        <>
          {chrome.overlays}
          <DishSheet item={editLine ? menuById.get(editLine.id) ?? null : null} line={editLine} onClose={() => setEditLine(null)} lang={lang} />
        </>
      }
    >
      <div className="em-noscroll min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-1">
        <div className="flex flex-col gap-3.5">
          <p className="em-tight mb-1 text-[22px] font-medium leading-[1.25]">
            {tx(lang, 'এই হলো সব।', "Here's everything.")}{' '}
            <span style={{ color: EM.muted }}>
              {online ? tx(lang, 'চেকআউট করবেন?', 'Ready to check out?') : tx(lang, 'কিচেনে পাঠিয়ে দেব?', 'Shall I send it to the kitchen?')}
            </span>
          </p>
          <div className="flex flex-col">
            {w.pickOptions.map((p) => (
              <div key={p.itemId} className="mx-2 mb-2">
                <WaitingDish p={p} lang={lang} image={imageOf(menuById.get(p.itemId))} onAnswer={chrome.say} />
              </div>
            ))}
            {lines.map(({ key, l, extras }) => {
              const warn = lineWarning(l, menuById.get(l.id), warnings, lang);
              return (
                <div
                  key={key}
                  className="-mx-2 rounded-[14px] px-2 py-2.5 transition-colors duration-700"
                  style={{ borderBottom: `1px solid ${EM.borderSoft}`, background: fresh.has(key) ? 'rgba(245,165,36,0.08)' : 'transparent' }}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditLine(l)}
                      aria-label={tx(lang, `${l.name} বদলান`, `Change ${l.name}`)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[16px] font-medium">{l.name}</span>
                        {markOf(l) && (
                          <span className="shrink-0 rounded-full px-2 py-px text-[11px] font-bold" style={{ background: EM.amberTint, color: EM.amber, border: `1px solid ${EM.amberLine}` }}>
                            {markOf(l) === 'new' ? tx(lang, 'নতুন', 'New') : tx(lang, 'বদলেছে', 'Changed')}
                          </span>
                        )}
                      </span>
                      {extras && <span className="truncate text-[12px]" style={{ color: EM.muted }}>{extras}</span>}
                      {l.notes && <span className="truncate text-[12px]" style={{ color: '#F6C27A' }}>{l.notes}</span>}
                      <span className="text-[13px]" style={{ color: EM.text3 }}>{money(l.price * l.qty)}</span>
                    </button>
                    <Stepper lang={lang} name={l.name} qty={l.qty} onMinus={() => (l.qty > 1 ? setLineQty(key, l.qty - 1) : removeLine(key))} onPlus={() => setLineQty(key, l.qty + 1)} />
                  </div>
                  {warn && <LineWarning text={warn} lang={lang} onRemove={() => removeLine(key)} />}
                </div>
              );
            })}
          </div>
          {noteOpen ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium" style={{ color: EM.text3 }}>
                {online ? tx(lang, 'রেস্টুরেন্টের জন্য নোট', 'Note for the restaurant') : tx(lang, 'কিচেনের জন্য নোট', 'Note for the kitchen')}
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={2}
                autoFocus={!note}
                placeholder={tx(lang, 'যেমন: সব কম ঝাল, বাদাম ছাড়া', 'e.g. everything less spicy, no nuts')}
                className="rounded-[14px] px-3.5 py-2.5 text-[15px] outline-none placeholder:text-[#6E6E73]"
                style={{ border: `1px solid ${EM.border}`, background: EM.surface, color: EM.text }}
              />
            </label>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="h-10 self-start rounded-full px-3.5 text-[14px]" style={{ border: '1px dashed #48484D', color: EM.text2 }}>
              + {online ? tx(lang, 'রেস্টুরেন্টের জন্য নোট', 'Add a note for the restaurant') : tx(lang, 'কিচেনের জন্য নোট', 'Add a note for the kitchen')}
            </button>
          )}
          <div className="flex flex-col gap-2 pt-1.5">
            <div className="flex justify-between text-[15px]" style={{ color: EM.text2 }}>
              <span>{tx(lang, `সাবটোটাল (${count})`, `Subtotal (${count})`)}</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[16px] font-semibold">{tx(lang, 'মোট', 'Total')}</span>
              <span className="text-[20px] font-semibold">{money(subtotal)}</span>
            </div>
            {wait && (
              <span className="text-[13px]" style={{ color: EM.text3 }}>
                {tx(lang, `তৈরি হতে প্রায় ${wait.totalMinutes} মিনিট`, `About ${wait.totalMinutes} min once accepted`)}
              </span>
            )}
            {!online && (
              <span className="text-[12px]" style={{ color: EM.muted }}>
                {tx(lang, 'বিল দিতে: ওয়েটার ডাকুন → বিল দিন।', 'To pay: Call waiter → Bring the bill.')}
              </span>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
