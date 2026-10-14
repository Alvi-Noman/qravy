// apps/tastebud/src/components/ai-waiter/PopupHeader.tsx
// Top of a full-screen popup (the cards, the tray): the title centered, a round close button top-right — and, on a
// second step (the tray's checkout form), a back button top-left.
import React from 'react';

type Props = {
  title: React.ReactNode;
  onClose: () => void;
  /** a step back inside the popup (checkout form → tray) */
  onBack?: () => void;
};

const ROUND =
  'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-[#FFE4EA] hover:text-[#FA2851] active:scale-95';

export default function PopupHeader({ title, onClose, onBack }: Props) {
  return (
    <div className="relative z-20 shrink-0 bg-white pt-[env(safe-area-inset-top)]">
      <div className="relative flex h-14 items-center justify-center px-14">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" className={`${ROUND} left-3`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <h2 className="truncate text-[16px] font-semibold text-gray-900">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className={`${ROUND} right-3`}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 0 0-1.41 1.41L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.41-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4Z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** Classes for the full-screen popup page itself (it appears at once — the orb travelling in is the motion). */
export const POPUP_PAGE_CLASS = 'relative flex h-[100dvh] w-full max-w-2xl flex-col bg-white';
