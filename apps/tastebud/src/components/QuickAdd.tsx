// apps/tastebud/src/components/QuickAdd.tsx
// "+" on a dish (the menu's cards, the AI suggestions): one tap puts one in the tray and opens into "− 1 +"; the
// count is the tray's own (the waiter adding one shows here too), down to 0 folds it back to "+". A dish with sizes /
// add-ons can't be added blind: "+" opens its choices instead (`onChoose`).
import { useCart } from '../context/CartContext';

type Props = {
  id?: string;
  name?: string;
  price?: number;
  imageUrl?: string;
  /** sizes or add-ons to pick first → "+" calls onChoose instead of adding */
  choices?: boolean;
  onChoose?: () => void;
  /** can't be ordered right now (e.g. the restaurant is closed) */
  disabled?: boolean;
  className?: string;
};

const BTN =
  'grid h-9 w-9 place-items-center rounded-full text-[20px] leading-none font-semibold transition active:scale-95 ' +
  'disabled:opacity-40 disabled:active:scale-100';

export default function QuickAdd({ id, name, price, imageUrl, choices, onChoose, disabled, className }: Props) {
  const { items, addItem, setQty } = useCart();
  if (!id) return null;
  // the plain line of this dish (no size / add-ons): what "+" and "−" change
  const line = items.find((it) => it.id === id && !it.variation && !(it.modifiers && it.modifiers.length));
  const qty = line?.qty ?? 0;
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation(); // (the card itself opens the dish / the menu)
  };
  const plus = (e: React.MouseEvent) => {
    stop(e);
    if (disabled) return;
    if (choices && qty === 0) return onChoose?.();
    if (qty === 0) addItem({ id, name: name ?? '', price: price ?? 0, ...(imageUrl ? { imageUrl } : {}) });
    else setQty(id, qty + 1);
  };
  const minus = (e: React.MouseEvent) => {
    stop(e);
    setQty(id, qty - 1); // (0 takes the line out of the tray)
  };

  if (qty === 0) {
    return (
      <button
        type="button"
        aria-label={`Add ${name ?? 'item'}`}
        disabled={disabled}
        onClick={plus}
        onPointerDown={(e) => e.stopPropagation()}
        className={`${BTN} bg-white text-[#FA2851] shadow-[0_2px_8px_rgba(0,0,0,0.18)] ring-1 ring-black/5 ${className ?? ''}`}
      >
        +
      </button>
    );
  }
  return (
    <div
      onClick={stop}
      onPointerDown={(e) => e.stopPropagation()}
      className={`flex items-center gap-1 rounded-full bg-[#FA2851] p-0.5 text-white shadow-[0_2px_8px_rgba(250,40,81,0.35)] ${className ?? ''}`}
    >
      <button type="button" aria-label={`One less ${name ?? ''}`} onClick={minus} className={`${BTN} h-8 w-8 text-white`}>
        −
      </button>
      <span className="min-w-[1.25rem] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button type="button" aria-label={`One more ${name ?? ''}`} disabled={disabled} onClick={plus} className={`${BTN} h-8 w-8 text-white`}>
        +
      </button>
    </div>
  );
}
