// apps/tastebud/src/pages/CheckoutPage.tsx
// Checkout: read the order back, then either confirm the table (dine-in, pay at the counter) or choose
// pickup / delivery and give name, phone and address (online), and place it.
// The guest can tap "Place order" or just say "yes" / "হ্যাঁ" to the waiter on the mic bar below.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCart, cartLineKey } from '../context/CartContext';
// THE WAITER — the same one as on the home screen and the menu page (src/waiter); never handle its replies here
import { useWaiterSession } from '../waiter/useWaiterSession';
import WaiterSheets, { WaiterDock } from '../waiter/WaiterSheets';
import { OrderApiError, cartIdempotencyKey, placeOrder, rememberOrder } from '../api/orders';
import { normalizeTable, useTable, withTable } from '../utils/table';
import {
  missingContactField,
  useFulfillment,
  useGuestContact,
  useOrderChannel,
  type GuestContact,
} from '../utils/order-mode';
import OnlineOrderDetails, { CONTACT_MESSAGES } from '../components/OnlineOrderDetails';
import { orderPath, storeBasePath } from '../utils/checkout-flow';
import { getStableSessionId } from '../utils/ws';
import { money, tr, uiLang } from '../utils/ui-lang';
import WaitEstimateLine from '../components/WaitEstimateLine';
import { useCartWait } from '../utils/wait-time';

export default function CheckoutPage() {
  const params = useParams<{ subdomain?: string; branchSlug?: string; branch?: string }>();
  const store = typeof window !== 'undefined' ? (window as any).__STORE__ : undefined;
  const sub = params.subdomain ?? store?.subdomain ?? null;
  const branch = params.branchSlug ?? params.branch ?? store?.branch ?? null;

  const lang = uiLang();
  const navigate = useNavigate();
  const { items, subtotal, count, setLineQty, removeLine, clear } = useCart();
  const channel = useOrderChannel(sub);
  const online = channel === 'online';
  const wait = useCartWait({ subdomain: sub, branch, items });
  const [table, saveTable] = useTable(sub);
  const [fulfillment, setFulfillment] = useFulfillment(sub);
  const [contact, setContact] = useGuestContact(sub);
  const [contactFocus, setContactFocus] = useState<keyof GuestContact | null>(null);
  const [tableDraft, setTableDraft] = useState(table ?? '');
  const [editingTable, setEditingTable] = useState(!table);
  const [orderNotes, setOrderNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the waiter (shared): cart changes, the picker, offers… all as on the other pages. Its read-back / "which table?" /
  // contact-details steps point at THIS page's fields (it is the checkout) instead of opening the tray.
  const w = useWaiterSession({
    subdomain: sub ?? 'demo',
    branch: branch ?? undefined,
    channel,
    onCheckoutStep: (askTable) => {
      if (!askTable) return;
      if (online) setContactFocus(missingContactField(fulfillment, contact));
      else setEditingTable(true);
    },
  });

  useEffect(() => {
    if (table) {
      setTableDraft(table);
      setEditingTable(false);
    }
  }, [table]);

  const effectiveTable = editingTable ? normalizeTable(tableDraft) : table;
  const backHref = withTable(storeBasePath(sub, branch) || '/', sub); // (the table stays on the link)

  const lines = useMemo(
    () =>
      items.map((l) => ({
        key: cartLineKey(l),
        line: l,
        extras: [l.variation, ...(l.modifiers ?? []).map((m) => m.name)].filter(Boolean).join(', '),
      })),
    [items],
  );

  async function submit() {
    setError(null);
    setContactFocus(null);
    if (!sub) return setError(tr(lang, 'রেস্টুরেন্ট খুঁজে পাওয়া যায়নি।', 'Restaurant not found.'));
    if (online) {
      const missing = missingContactField(fulfillment, contact);
      if (missing) {
        setContactFocus(missing);
        return setError(CONTACT_MESSAGES[missing]);
      }
    } else if (!effectiveTable) {
      setEditingTable(true);
      return setError(tr(lang, 'আপনার টেবিল নম্বরটা লিখুন।', 'Please enter your table number.'));
    }
    if (!items.length) return;
    if (!online && effectiveTable) saveTable(effectiveTable);
    setPlacing(true);
    try {
      const sid = getStableSessionId();
      const common = {
        subdomain: sub,
        branch,
        items,
        notes: orderNotes,
        sessionId: sid,
        idempotencyKey: cartIdempotencyKey(sid, items),
      };
      const { order } = await placeOrder(
        online
          ? { ...common, channel: 'online', fulfillment, customer: contact }
          : { ...common, channel: 'dine-in', table: effectiveTable as string },
      );
      clear({ silent: true });
      rememberOrder(sub, order);
      navigate(orderPath(order.token, sub, branch), { replace: true, state: { justPlaced: true } });
    } catch (e) {
      const err = e as OrderApiError;
      if (err?.needs === 'table') setEditingTable(true);
      if (err?.needs === 'name' || err?.needs === 'phone' || err?.needs === 'address') setContactFocus(err.needs);
      setError(err?.message || tr(lang, 'অর্ডার দেওয়া যায়নি। আবার চেষ্টা করুন।', "Couldn't place the order. Please try again."));
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F5F8] flex flex-col" style={{ fontFamily: "'Noto Sans Bengali', system-ui, sans-serif" }}>
      <header className="max-w-2xl w-full mx-auto px-4 pt-6 pb-2 flex items-center gap-3">
        <Link to={backHref} className="h-10 w-10 rounded-full bg-white shadow-sm flex items-center justify-center" aria-label={tr(lang, 'ফিরে যান', 'Back')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{tr(lang, 'আপনার অর্ডার', 'Your order')}</h1>
          <p className="text-xs text-gray-500">
            {!online
              ? tr(lang, 'ডাইন-ইন · বিল কাউন্টারে পরিশোধ', 'Dine-in · pay at the counter')
              : fulfillment === 'delivery'
              ? tr(lang, 'ডেলিভারি · ক্যাশ অন ডেলিভারি', 'Delivery · cash on delivery')
              : tr(lang, 'পিকআপ · নেওয়ার সময় পরিশোধ', 'Pickup · pay when you collect')}
          </p>
        </div>
      </header>

      <main className="max-w-2xl w-full mx-auto px-4 pb-80 flex-1">
        {!items.length ? (
          <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm">
            <p className="text-gray-700 mb-4">{tr(lang, 'আপনার ট্রে খালি।', 'Your tray is empty.')}</p>
            <Link to={backHref} className="inline-block rounded-full bg-[#FA2851] px-5 py-2.5 text-white font-medium">
              {tr(lang, 'ওয়েটারের কাছে ফিরে যান', 'Back to the waiter')}
            </Link>
          </div>
        ) : (
          <>
            {/* Table (dine-in) or pickup/delivery details (online) */}
            <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
              {online ? (
                <OnlineOrderDetails
                  fulfillment={fulfillment}
                  onFulfillment={setFulfillment}
                  contact={contact}
                  onContact={setContact}
                  focusField={contactFocus}
                />
              ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-gray-600">{tr(lang, 'টেবিল', 'Table')}</div>
                {!editingTable && table ? (
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold text-gray-900">{table}</span>
                    <button type="button" className="text-sm text-[#FA2851] font-medium" onClick={() => setEditingTable(true)}>
                      {tr(lang, 'বদলান', 'Change')}
                    </button>
                  </div>
                ) : (
                  <input
                    value={tableDraft}
                    onChange={(e) => setTableDraft(e.target.value)}
                    onBlur={() => normalizeTable(tableDraft) && saveTable(normalizeTable(tableDraft))}
                    inputMode="text"
                    maxLength={12}
                    placeholder={tr(lang, 'যেমন 12', 'e.g. 12')}
                    aria-label={tr(lang, 'টেবিল নম্বর', 'Table number')}
                    className="w-28 rounded-xl border border-gray-200 px-3 py-2 text-right text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-[#FA2851]/40"
                  />
                )}
              </div>
              )}
            </section>

            {/* Lines */}
            <section className="mt-3 rounded-2xl bg-white shadow-sm divide-y divide-gray-100">
              {lines.map(({ key, line, extras }) => (
                <div key={key} className="p-4 flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{line.name}</div>
                    {extras && <div className="text-xs text-gray-500 mt-0.5">{extras}</div>}
                    {line.notes && <div className="text-xs text-amber-700 mt-0.5">{tr(lang, 'নোট', 'Note')}: {line.notes}</div>}
                    <div className="text-sm text-gray-500 mt-1">{money(line.price)}</div>
                  </div>
                  <div className="flex flex-col items-end justify-between gap-2">
                    <div className="font-semibold text-gray-900">{money(line.price * line.qty)}</div>
                    <div className="flex items-center rounded-full border border-gray-200">
                      <button
                        type="button"
                        className="h-8 w-8 text-lg text-gray-700"
                        aria-label={tr(lang, 'কমান', 'Decrease')}
                        onClick={() => (line.qty > 1 ? setLineQty(key, line.qty - 1) : removeLine(key))}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{line.qty}</span>
                      <button
                        type="button"
                        className="h-8 w-8 text-lg text-gray-700"
                        aria-label={tr(lang, 'বাড়ান', 'Increase')}
                        onClick={() => setLineQty(key, line.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {/* Notes */}
            <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
              <label className="text-sm text-gray-600" htmlFor="order-notes">
                {tr(lang, 'রান্নাঘরের জন্য নোট (ঐচ্ছিক)', 'Note for the kitchen (optional)')}
              </label>
              <textarea
                id="order-notes"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                maxLength={300}
                rows={2}
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA2851]/40"
                placeholder={tr(lang, 'যেমন: সব কম ঝাল', 'e.g. everything less spicy')}
              />
            </section>

            {/* Total */}
            <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex justify-between text-sm text-gray-600">
                <span>{tr(lang, `আইটেম (${count})`, `Items (${count})`)}</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="flex justify-between mt-2 text-lg font-semibold text-gray-900">
                <span>{tr(lang, 'মোট', 'Total')}</span>
                <span>{money(subtotal)}</span>
              </div>
              <WaitEstimateLine estimate={wait} lang={lang} className="mt-3" />
              <p className="mt-2 text-xs text-gray-500">
                {online
                  ? tr(lang, 'চূড়ান্ত দাম রেস্টুরেন্ট যাচাই করবে।', 'The restaurant confirms final prices.')
                  : tr(
                      lang,
                      'চূড়ান্ত দাম রেস্টুরেন্ট যাচাই করবে। বিল কাউন্টারে পরিশোধ করবেন।',
                      'The restaurant confirms final prices. You pay at the counter.',
                    )}
              </p>
            </section>

            {error && (
              <div role="alert" className="mt-3 rounded-2xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </>
        )}
      </main>

      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[#F6F5F8]/95 backdrop-blur pt-3">
          <div className="mx-auto max-w-2xl px-4 space-y-3">
            <button
              type="button"
              onClick={submit}
              disabled={placing}
              className="w-full rounded-2xl bg-[#FA2851] py-3.5 text-white text-base font-semibold shadow-lg disabled:opacity-60"
            >
              {placing
                ? tr(lang, 'অর্ডার দেওয়া হচ্ছে…', 'Placing order…')
                : tr(lang, `অর্ডার দিন · ${money(subtotal)}`, `Place order · ${money(subtotal)}`)}
            </button>
          </div>
          {/* the waiter: hold the orb to talk; what it says, and the answer pills */}
          <div className="mx-auto mt-3 max-w-2xl">
            <WaiterDock w={w} originFromOrb={false} />
          </div>
        </div>
      )}

      {/* the waiter's sheets (suggestions, the tray with its picker) — the same as on the other pages */}
      <WaiterSheets w={w} />
    </div>
  );
}
