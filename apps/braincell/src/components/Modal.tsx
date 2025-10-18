import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  initialFocusRef?: React.RefObject<HTMLElement>;
  closeOnOverlayClick?: boolean;
};

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export default function Modal({
  open,
  onClose,
  title,
  size = 'lg',
  initialFocusRef,
  closeOnOverlayClick = true,
  children,
}: React.PropsWithChildren<ModalProps>) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const [closeIntent, setCloseIntent] = useState(false);

  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    (initialFocusRef?.current || panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      lastActiveRef.current?.focus();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* Overlay: use pointer events for mouse + touch */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/40"
        onPointerDown={(e) => {
          if (!closeOnOverlayClick) return;
          if (e.target === overlayRef.current) setCloseIntent(true);
        }}
        onPointerUp={(e) => {
          if (!closeOnOverlayClick) return;
          if (closeIntent && e.target === overlayRef.current) onClose();
          setCloseIntent(false);
        }}
      />
      {/* Wrapper ignores clicks so overlay receives them */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title || 'Dialog'}
          tabIndex={-1}
          className={`pointer-events-auto w-full ${sizes[size]} rounded-xl border border-[#e5e5e5] bg-white shadow-xl outline-none`}
          onPointerDown={() => setCloseIntent(false)} // clicks starting inside panel won't close
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}