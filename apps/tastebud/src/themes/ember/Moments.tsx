// apps/tastebud/src/themes/ember/Moments.tsx
// One small card on the home screen, at the right moment of the visit — the things a good waiter offers without
// being asked, once:
//   · "Another round of the same?" — dine-in, ~25 min after the drinks reached the table (the same drinks, one tap)
//   · "Something sweet to finish?" — dine-in, a while after the mains were served, nothing sweet ordered yet
//   · "Order the same again?" — online, a returning guest with an empty cart: their last order, one tap
// "Not now" puts a card away for the visit. Dish kinds (drink, dessert, rice…) are the waiter's own reading of the
// menu (GET /menu/kinds). Nothing is added without a tap.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMenuKinds } from '../../api/storefront';
import { getOrder, recentOrders, type PublicOrder } from '../../api/orders';
import { useCart, type CartItem } from '../../context/CartContext';
import { money } from '../../utils/ui-lang';
import { placedAt, type Visit } from './visit';
import { bnDigits } from './when';
import { AddControl, EM, I, haptic, imageOf, needsChoices, priceOf, tx, type Lang } from './ui';

const MAIN = new Set(['rice', 'fish', 'chicken', 'meat', 'curry']);
const ROUND_AFTER_MS = 25 * 60 * 1000;
const SWEET_AFTER_MS = 15 * 60 * 1000;

const doneAt = (o: PublicOrder) => {
  const h = (o.statusHistory ?? []).find((x) => x.status === 'completed')?.at;
  const t = h ? Date.parse(h) : NaN;
  return Number.isFinite(t) ? t : null;
};

const asLine = (l: PublicOrder['items'][number], m: any): CartItem => ({
  id: l.itemId,
  name: l.name,
  price: l.unitPrice,
  qty: l.qty || 1,
  ...(l.variation ? { variation: l.variation } : {}),
  ...(l.modifiers?.length ? { modifiers: l.modifiers.map((x: any) => ({ groupId: x.groupId ?? '', groupName: x.groupName ?? '', optionId: x.optionId ?? x.name, name: x.name, price: x.price || 0 })) } : {}),
  ...(imageOf(m) ? { imageUrl: imageOf(m) } : {}),
});

export function useMenuKinds(sub: string, branch: string | null) {
  const { data = {} } = useQuery({
    queryKey: ['menuKinds', sub, branch ?? ''],
    queryFn: () => getMenuKinds({ subdomain: sub, branch }),
    staleTime: 5 * 60_000,
    enabled: !!sub,
  });
  return data;
}

/** An online guest's last order (up to a month back), for "Order the same again?". */
function useLastOrder(sub: string, enabled: boolean) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const last = recentOrders(sub, 30 * 24 * 60 * 60 * 1000)[0];
    if (!last) return;
    let alive = true;
    getOrder(last.token).then((o) => alive && setOrder(o)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [sub, enabled]);
  return order;
}

type Moment =
  | { key: string; kind: 'round'; lines: CartItem[] }
  | { key: string; kind: 'sweet'; dishes: any[] }
  | { key: string; kind: 'again'; lines: CartItem[]; missing: number };

export function useMoment(opts: {
  sub: string;
  branch: string | null;
  online: boolean;
  visit: Visit;
  menuById: Map<string, any>;
  cartEmpty: boolean;
  hasActiveOrder: boolean;
}): { moment: Moment | null; dismiss: (key: string) => void } {
  const { sub, branch, online, visit, menuById, cartEmpty, hasActiveOrder } = opts;
  const kinds = useMenuKinds(sub, branch);
  const noKey = `qravy:ember:moment-no:${sub}`;
  const [no, setNo] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(noKey) || '[]');
    } catch {
      return [];
    }
  });
  const dismiss = (key: string) => {
    const next = [...no, key];
    setNo(next);
    try {
      sessionStorage.setItem(noKey, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  const last = useLastOrder(sub, online && cartEmpty && !hasActiveOrder);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const moment = useMemo((): Moment | null => {
    if (!cartEmpty) return null;
    const orderable = (id: string) => {
      const m = menuById.get(id);
      return !!m && m.orderable !== false && m.available !== false && m.servedNow !== false;
    };
    if (!online) {
      // the same drinks again: the last order with drinks reached the table a while ago, and none ordered since
      const withDrinks = visit.orders.filter((o) => o.items.some((l) => kinds[l.itemId] === 'drink'));
      const lastDrinks = withDrinks[withDrinks.length - 1];
      const served = lastDrinks ? doneAt(lastDrinks) : null;
      if (lastDrinks && served && now - served > ROUND_AFTER_MS) {
        const key = `round:${lastDrinks.token}`;
        const lines = lastDrinks.items.filter((l) => kinds[l.itemId] === 'drink' && orderable(l.itemId)).map((l) => asLine(l, menuById.get(l.itemId)));
        if (lines.length && !no.includes(key)) return { key, kind: 'round', lines };
      }
      // something sweet: the mains were served a while ago and nothing sweet is ordered yet
      const sweetOrdered = visit.orders.some((o) => o.items.some((l) => kinds[l.itemId] === 'dessert'));
      const mains = visit.orders.filter((o) => o.items.some((l) => MAIN.has(kinds[l.itemId])));
      const mainsServed = mains.map(doneAt).filter((t): t is number => t !== null);
      if (!sweetOrdered && mainsServed.length && now - Math.max(...mainsServed) > SWEET_AFTER_MS && !no.includes('sweet')) {
        const dishes = Array.from(menuById.values())
          .filter((m) => kinds[String(m.id)] === 'dessert' && orderable(String(m.id)) && !m.hidden)
          .sort((a, b) => Number(!!b.signature) - Number(!!a.signature))
          .slice(0, 2);
        if (dishes.length) return { key: 'sweet', kind: 'sweet', dishes };
      }
      return null;
    }
    // online: the last order again (what can still be ordered)
    if (hasActiveOrder || !last || last.status !== 'completed') return null;
    const key = `again:${last.token}`;
    if (no.includes(key)) return null;
    const ok = last.items.filter((l) => orderable(l.itemId));
    if (!ok.length) return null;
    return { key, kind: 'again', lines: ok.map((l) => asLine(l, menuById.get(l.itemId))), missing: last.items.length - ok.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartEmpty, online, visit, kinds, menuById, now, no.join(','), last, hasActiveOrder]);

  return { moment, dismiss };
}

export function MomentCard({
  moment,
  lang,
  onDismiss,
  onAdded,
  onChoose,
}: {
  moment: Moment;
  lang: Lang;
  onDismiss: () => void;
  onAdded: () => void;
  /** a dish with sizes / add-ons: its sheet */
  onChoose: (m: any) => void;
}) {
  const { addItem } = useCart();
  const addAll = (lines: CartItem[]) => {
    haptic();
    lines.forEach((l) => addItem(l));
    onAdded();
  };
  const card = 'em-rise flex flex-col gap-3 rounded-[20px] px-[18px] py-4';
  const style = { background: EM.amberTint, border: `1px solid ${EM.amberLine}` };
  const notNow = (
    <button type="button" onClick={onDismiss} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: EM.surface2, color: EM.text }}>
      {tx(lang, 'এখন না', 'Not now')}
    </button>
  );
  if (moment.kind === 'round' || moment.kind === 'again') {
    const total = moment.lines.reduce((n, l) => n + l.price * l.qty, 0);
    const what = moment.lines.map((l) => (lang === 'en' ? `${l.qty} ${l.name}` : `${bnDigits(l.qty)}টা ${l.name}`)).join(', ');
    return (
      <div className={card} style={style} role="group" aria-label={moment.kind === 'round' ? tx(lang, 'আরেক রাউন্ড', 'Another round') : tx(lang, 'আবার অর্ডার', 'Order again')}>
        <p className="em-tight text-[19px] font-medium leading-[1.3]">
          {moment.kind === 'round' ? tx(lang, 'আরেক রাউন্ড একই ড্রিংক?', 'Another round of the same?') : tx(lang, 'আগের অর্ডারটা আবার?', 'Order the same again?')}{' '}
          <span className="block text-[14px] font-normal" style={{ color: EM.text3 }}>
            {what}
            {moment.kind === 'again' && moment.missing > 0 && (
              <span> · {tx(lang, `${bnDigits(moment.missing)}টা এখন পাওয়া যাচ্ছে না`, `${moment.missing} not available now`)}</span>
            )}
          </span>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => addAll(moment.lines)} className="h-11 flex-1 rounded-full text-[14px] font-bold" style={{ background: EM.amber, color: EM.bg }}>
            {moment.kind === 'round' ? tx(lang, `হ্যাঁ · ${money(total)}`, `Yes · ${money(total)}`) : tx(lang, `আবার অর্ডার করুন · ${money(total)}`, `Order again · ${money(total)}`)}
          </button>
          {notNow}
        </div>
      </div>
    );
  }
  return (
    <div className={card} style={style} role="group" aria-label={tx(lang, 'মিষ্টি কিছু', 'Something sweet')}>
      <div className="flex items-center justify-between gap-2">
        <p className="em-tight text-[19px] font-medium">{tx(lang, 'শেষে মিষ্টি কিছু?', 'Something sweet to finish?')}</p>
        <button type="button" aria-label={tx(lang, 'এখন না', 'Not now')} onClick={onDismiss} className="flex h-10 w-10 items-center justify-center" style={{ color: EM.muted }}>
          {I.x()}
        </button>
      </div>
      {moment.dishes.map((m) => (
        <div key={String(m.id)} className="flex items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl" style={{ background: '#2A1F12' }}>
            {imageOf(m) && <img src={imageOf(m)} alt="" className="h-full w-full object-cover" />}
          </div>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold">{m.name}</span>
            <span className="text-[13px]" style={{ color: EM.text3 }}>{money(priceOf(m))}</span>
          </span>
          <div className="relative h-11 w-[124px] shrink-0">
            <AddControl item={{ id: String(m.id), name: m.name, price: priceOf(m), imageUrl: imageOf(m), choices: needsChoices(m) }} onChoose={() => onChoose(m)} onAdded={onAdded} lang={lang} />
          </div>
        </div>
      ))}
    </div>
  );
}

export { placedAt };
