// apps/tastebud/src/themes/ember/UndoBar.tsx
// After Pixie changes the order (added, removed, a size changed): what changed, with a one-tap undo, for a few
// seconds. Voice is fast but not always right — taking it back should cost one tap. (A tap's own change is already
// in front of the guest, so it gets none.) The words are the original theme's (components/ai-waiter/UndoToast).
import { useEffect, useState } from 'react';
import { useCart } from '../../context/CartContext';
import { describe } from '../../components/ai-waiter/UndoToast';
import { EM, I, tx, type Lang } from './ui';

const SHOW_MS = 6000;

export default function UndoBar({ lang, replyAt }: { lang: Lang; replyAt: number }) {
  const { lastChange, undoLast, dismissChange } = useCart();
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    // Pixie's change: made with her reply (the cart changes as the reply is applied)
    if (!lastChange || !replyAt || Math.abs(lastChange.at - replyAt) > 4000) return;
    setShown(lastChange.id);
    const t = window.setTimeout(() => setShown(null), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [lastChange, replyAt]);
  if (!lastChange || shown !== lastChange.id) return null;
  const text = describe(lastChange, lang);
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+12px)] z-[150] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="em-rise pointer-events-auto flex w-full max-w-[440px] items-center gap-2 rounded-2xl py-2 pl-4 pr-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
        style={{ background: '#232326', border: `1px solid ${EM.border}` }}
      >
        <span className="min-w-0 flex-1 text-[14px] leading-snug">{text}</span>
        <button
          type="button"
          onClick={() => {
            undoLast();
            setShown(null);
          }}
          className="h-10 shrink-0 rounded-full px-3.5 text-[14px] font-semibold"
          style={{ color: EM.amber }}
        >
          {tx(lang, 'ফিরিয়ে দিন', 'Undo')}
        </button>
        <button
          type="button"
          aria-label={tx(lang, 'বন্ধ করুন', 'Dismiss')}
          onClick={() => {
            dismissChange();
            setShown(null);
          }}
          className="flex h-10 w-9 shrink-0 items-center justify-center"
          style={{ color: EM.muted }}
        >
          {I.x()}
        </button>
      </div>
    </div>
  );
}
