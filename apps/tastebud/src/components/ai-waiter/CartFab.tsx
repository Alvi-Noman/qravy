// apps/tastebud/src/components/ai-waiter/CartFab.tsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../../context/CartContext';

const BDT = new Intl.NumberFormat('en-BD');
const formatBDT = (n: number) => `৳${BDT.format(n)}`;

type CartFabProps = {
  /** Whether the tray is currently open. If open, we hide the FAB. */
  trayOpen: boolean;
  /** Called when user taps the FAB (should open TrayModal). */
  onOpenTray: () => void;
};

export default function CartFab({ trayOpen, onOpenTray }: CartFabProps) {
  const { items, subtotal } = useCart();
  const location = useLocation();

  // Hide on checkout page to avoid weird double-UX
  if (location.pathname.includes('/checkout')) return null;

  const hasItems = items.length > 0;
  if (!hasItems || trayOpen) return null;

  const totalQty = items.reduce((sum, it) => sum + (it.qty || 0), 0);

  return (
    <button
      onClick={onOpenTray}
      className="
        fixed bottom-5 right-5 z-[95]
        flex items-center gap-2
        px-4 py-2
        rounded-full
        bg-[#FA2851] text-white
        shadow-[0_10px_30px_rgba(250,40,81,0.35)]
        hover:shadow-[0_14px_40px_rgba(250,40,81,0.45)]
        active:scale-95
        transition-all
      "
      aria-label="Open tray"
    >
      <span className="inline-flex h-7 w-7 rounded-full bg-white/15 items-center justify-center">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M7 4h-.76a2 2 0 0 0-1.98 1.64L3 11.5A2.5 2.5 0 0 0 5.47 14h11.92a2.5 2.5 0 0 0 2.46-2.11l.9-5.39A1.5 1.5 0 0 0 19.28 5H9"
          />
          <circle cx="9" cy="19" r="1.6" />
          <circle cx="17" cy="19" r="1.6" />
        </svg>
      </span>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[10px] uppercase tracking-wide font-semibold">
          Tray
        </span>
        <span className="text-[11px]">
          {totalQty} item{totalQty !== 1 ? 's' : ''} · {formatBDT(subtotal)}
        </span>
      </div>
    </button>
  );
}
