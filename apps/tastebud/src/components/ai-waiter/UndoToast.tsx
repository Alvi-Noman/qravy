// apps/tastebud/src/components/ai-waiter/UndoToast.tsx
// After every tray change (voice or tap): what changed, with a one-tap Undo. Hides itself after a few seconds.
import { useEffect, useState } from 'react';
import { useCart, type CartChange, type CartItem } from '../../context/CartContext';
import { tr, uiLang, type UiLang } from '../../utils/ui-lang';

const SHOW_MS = 6000;

function describe(c: CartChange, lang: UiLang): string {
  const name = (it: CartItem) => it.name + (it.variation ? ` (${it.variation})` : '');
  const parts: string[] = [];
  if (c.added.length) {
    const s = c.added.map((it) => `${it.qty} × ${name(it)}`).join(', ');
    parts.push(tr(lang, `যোগ হলো: ${s}`, `Added ${s}`));
  }
  for (const { before, after } of c.changed.slice(0, 2)) {
    if (before.qty !== after.qty) parts.push(tr(lang, `${name(after)}: ${before.qty} → ${after.qty}`, `${name(after)}: ${before.qty} → ${after.qty}`));
    else parts.push(tr(lang, `${name(after)}: নোট বদলানো হলো`, `${name(after)}: note updated`));
  }
  if (c.removed.length) {
    const s = c.removed.map(name).join(', ');
    parts.push(tr(lang, `বাদ দেওয়া হলো: ${s}`, `Removed ${s}`));
  }
  return parts.join(' · ');
}

export default function UndoToast() {
  const { lastChange, undoLast, dismissChange } = useCart();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastChange) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [lastChange]);

  if (!lastChange || !visible) return null;
  const lang = 'en' as const; // UI chrome stays English
  const text = describe(lastChange, lang);
  if (!text) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-[1700] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl bg-gray-900/95 px-4 py-3 text-white shadow-xl backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm leading-snug">{text}</span>
        <button
          type="button"
          onClick={() => {
            undoLast();
            setVisible(false);
          }}
          className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25"
        >
          {tr(lang, 'ফিরিয়ে দিন', 'Undo')}
        </button>
        <button
          type="button"
          aria-label={tr(lang, 'বন্ধ করুন', 'Dismiss')}
          onClick={() => {
            dismissChange();
            setVisible(false);
          }}
          className="shrink-0 text-white/60 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
