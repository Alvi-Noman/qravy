// apps/tastebud/src/components/ai-waiter/ViewTrayBar.tsx
// "View your tray (N items) · ৳…" — for a guest ordering by hand ("+" pressed), in place of the waiter's orb and the
// tray button, like a delivery app: the AI suggestions and the menu page.
import { useCart } from '../../context/CartContext';
import { priceNumber } from '../../utils/ui-lang';

export default function ViewTrayBar({ onClick, lang = 'bn' }: { onClick?: () => void; lang?: 'bn' | 'en' }) {
  const { count, subtotal } = useCart();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      className="flex h-14 w-full items-center justify-between rounded-2xl bg-[#FA2851] px-5 text-white shadow-[0_6px_18px_rgba(250,40,81,0.35)] active:scale-[0.99] disabled:opacity-50"
    >
      <span className="text-[16px] font-semibold">
        {lang === 'en' ? `View your tray (${count} ${count === 1 ? 'item' : 'items'})` : `ট্রে দেখুন (${count}টি আইটেম)`}
      </span>
      <span className="text-[16px] font-semibold">৳ {priceNumber(subtotal)}</span>
    </button>
  );
}
