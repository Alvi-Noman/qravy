// apps/tastebud/src/components/Modal.tsx
import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  image?: string | null;
  images?: string[];
  price?: number | null;
  compareAt?: number | null;
  unavailable?: boolean;
  description?: string;
  variations?: Array<{
    name?: string;
    price?: number;
    compareAtPrice?: number;
    available?: boolean;
  }>;
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
};

const BDT = new Intl.NumberFormat('en-BD');
const formatBDT = (n?: number | null) =>
  typeof n === 'number' ? `৳ ${BDT.format(n)}` : undefined;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function addPreloadLink(href: string) {
  if (!href) return;
  const existing = document.querySelector<HTMLLinkElement>(
    `link[rel="preload"][as="image"][href="${href}"]`
  );
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = href;
  document.head.appendChild(link);
}

type SmartImageProps = {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
};

function SmartImage({ src, alt, className, width, height }: SmartImageProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!src) return;
    try {
      addPreloadLink(src);
    } catch {}
    let cancelled = false;
    const img = new Image();
    if (typeof width === 'number') img.width = width;
    if (typeof height === 'number') img.height = height;
    (img as any).fetchPriority = 'high';
    img.decoding = 'async';
    img.src = src;
    const reveal = () => !cancelled && setReady(true);
    if (img.complete) {
      reveal();
      return () => {
        cancelled = true;
      };
    }
    img.onload = () => {
      if ('decode' in img) {
        (img as any).decode?.().then(reveal).catch(reveal);
      } else {
        reveal();
      }
    };
    img.onerror = reveal;
    return () => {
      cancelled = true;
    };
  }, [src, width, height]);

  return (
    <div className="relative h-full w-full">
      {!ready && <div className="absolute inset-0 z-[1] animate-pulse bg-gray-200" />}
      <img
        src={src}
        alt={alt}
        loading="eager"
        decoding="async"
        // @ts-ignore
        fetchPriority="high"
        className={cx(
          'h-full w-full transition-opacity duration-200 object-cover',
          ready ? 'opacity-100' : 'opacity-0',
          className || ''
        )}
        width={width}
        height={height}
        sizes="100vw"
      />
    </div>
  );
}

export default function Modal({
  open,
  onClose,
  title,
  image,
  images,
  price,
  compareAt,
  unavailable,
  description,
  variations,
  size = 'md',
  dismissible = true,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const [visible, setVisible] = useState(false);
  const startYRef = useRef<number | null>(null);
  const translateYRef = useRef<number>(0);

  const hasVariations = useMemo(
    () => Array.isArray(variations) && variations.length > 0,
    [variations]
  );

  const gallery: string[] = useMemo(() => {
    const arr = Array.isArray(images) ? images.filter(Boolean) : [];
    if (arr.length) return arr;
    return image ? [image] : [];
  }, [images, image]);
  const multi = gallery.length > 1;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (open) setIdx(0);
  }, [open, gallery.length]);

  // preload all images
  useEffect(() => {
    if (!open || gallery.length <= 1) return;
    gallery.forEach((src) => {
      try {
        addPreloadLink(src);
      } catch {}
      const im = new Image();
      // @ts-ignore
      im.fetchPriority = 'high';
      im.decoding = 'async';
      im.src = src;
    });
  }, [open, gallery]);

  // swipe gesture
  const startXRef = useRef<number | null>(null);
  const deltaXRef = useRef<number>(0);
  const onImgTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    deltaXRef.current = 0;
  };
  const onImgTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    deltaXRef.current = e.touches[0].clientX - startXRef.current;
  };
  const onImgTouchEnd = () => {
    if (startXRef.current === null) return;
    const dx = deltaXRef.current;
    startXRef.current = null;
    deltaXRef.current = 0;
    const THRESH = 50;
    if (dx > THRESH) setIdx((i) => Math.max(0, i - 1));
    else if (dx < -THRESH) setIdx((i) => Math.min(gallery.length - 1, i + 1));
  };

  const [selectedVar, setSelectedVar] = useState<number | null>(null);
  useEffect(() => {
    if (open && hasVariations) {
      const firstAvail = variations!.findIndex((v) => v.available !== false);
      setSelectedVar(firstAvail >= 0 ? firstAvail : 0);
    } else {
      setSelectedVar(null);
    }
  }, [open, hasVariations, variations]);

  const close = useCallback(() => {
    if (!dismissible) return;
    setVisible(false);
    setTimeout(() => onClose?.(), 250);
  }, [dismissible, onClose]);

  useEffect(() => {
    if (open) setVisible(true);
    else setVisible(false);
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, close]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onBackdropMouseDown = (e: React.MouseEvent) => {
    if (!dismissible) return;
    if (e.target === backdropRef.current) close();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!dragRef.current) return;
    if (!dragRef.current.contains(e.target as Node)) return;
    startYRef.current = e.touches[0].clientY;
    translateYRef.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy > 0 && panelRef.current) {
      translateYRef.current = dy;
      panelRef.current.style.transform = `translateY(${dy}px)`;
    }
  };
  const onTouchEnd = () => {
    if (startYRef.current === null) return;
    const dy = translateYRef.current;
    startYRef.current = null;
    translateYRef.current = 0;
    if (panelRef.current) panelRef.current.style.transform = '';
    if (dy > 140) close();
  };

  if (!open && !visible) return null;

  const sizeClass =
    size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-xl';

  const mobileSheetHeight = hasVariations
    ? 'h-[90vh] max-h-[90vh]'
    : 'h-[80vh] max-h-[80vh]';
  const mobileImageHeight = 'h-[300px]';
  const desktopImageHeight = 'sm:h-[380px]';

  // -------- Price to display (variation-aware) --------
  const selected = hasVariations && selectedVar !== null ? variations![selectedVar] : null;
  const displayPrice = (selected?.price ?? price) ?? null;
  const displayCompareAt = (selected?.compareAtPrice ?? compareAt) ?? null;

  return createPortal(
    <div
      ref={backdropRef}
      className={cx(
        'fixed inset-0 z-[999] flex sm:items-center sm:justify-center bg-black/45 sm:p-4 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      onMouseDown={onBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={panelRef}
        className={cx(
          'fixed bottom-0 left-0 right-0 sm:static sm:mx-auto',
          'bg-[#F6F5F8] rounded-t-[24px] sm:rounded-[16px] shadow-xl w-full font-[Inter]',
          'transform transition-transform duration-300 ease-out will-change-transform',
          visible ? 'translate-y-0 sm:translate-y-0' : 'translate-y-full sm:translate-y-0',
          `flex flex-col ${mobileSheetHeight} sm:h-auto sm:max-h-[90vh]`,
          sizeClass
        )}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Close (desktop) */}
        {dismissible && (
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="hidden sm:flex absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {/* Drag handle area (mobile only) */}
        <div ref={dragRef} className="relative block sm:hidden">
          <div className="absolute top-[10px] left-1/2 z-10 -translate-x-1/2">
            <div className="h-1.5 w-14 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.2)]" />
          </div>
        </div>

        {/* Gallery */}
        <div
          className="relative w-full overflow-hidden rounded-t-[24px] sm:rounded-t-[16px] bg-gray-100 shrink-0"
          onTouchStart={multi ? onImgTouchStart : undefined}
          onTouchMove={multi ? onImgTouchMove : undefined}
          onTouchEnd={multi ? onImgTouchEnd : undefined}
        >
          <div
            className={cx(
              'flex w-full',
              mobileImageHeight,
              desktopImageHeight,
              'transition-transform duration-300'
            )}
            style={{
              transform: `translateX(-${idx * (100 / gallery.length)}%)`,
              width: `${gallery.length * 100}%`,
            }}
          >
            {gallery.length > 0 ? (
              gallery.map((src, i) => (
                <div
                  key={`${src}-${i}`}
                  className="w-full h-full shrink-0"
                  style={{ width: `${100 / gallery.length}%` }}
                >
                  <SmartImage
                    src={src}
                    alt={`${title} ${i + 1}`}
                    className="object-cover object-center"
                    width={1200}
                    height={300}
                  />
                </div>
              ))
            ) : (
              <div className="w-full h-full bg-gray-100" />
            )}
          </div>

          {multi && (
            <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-white/70 px-2 py-1 backdrop-blur-sm">
              {gallery.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Go to image ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className={cx(
                    'h-2 rounded-full transition-all',
                    i === idx ? 'w-4 bg-neutral-900' : 'w-2 bg-neutral-400'
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 sm:px-5 sm:pb-8">
          <div className="flex items-start justify-between gap-3">
            <h4 className="min-w-0 truncate text-[17px] sm:text-[19px] font-semibold tracking-tight text-neutral-900">
              {title}
            </h4>

            <div className="shrink-0" aria-live="polite">
              {typeof displayCompareAt === 'number' &&
              typeof displayPrice === 'number' &&
              displayCompareAt > displayPrice ? (
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-neutral-400 line-through">
                    {formatBDT(displayCompareAt)}
                  </span>
                  <span className="text-[16px] sm:text-[17px] font-semibold text-neutral-900">
                    {formatBDT(displayPrice)}
                  </span>
                </div>
              ) : (
                <span className="text-[16px] sm:text-[17px] font-semibold text-neutral-900">
                  {formatBDT(displayPrice) ?? '—'}
                </span>
              )}
            </div>
          </div>

          {unavailable && (
            <span
              className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: '#F5E6E8', color: '#FA2851' }}
            >
              Unavailable
            </span>
          )}

          {description && (
            <p className="mt-3 text-[14px] leading-[1.6] text-neutral-600">{description}</p>
          )}

          {hasVariations && (
            <div className="mt-5 rounded-[22px] border border-gray-100 bg-white px-4 pt-4 pb-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:px-5 sm:pt-5 sm:pb-12">
              <h5 className="mb-3 text-center text-[16px] font-semibold text-neutral-900">
                Variation
              </h5>
              <div role="radiogroup" aria-label="Choose a variation" className="divide-y divide-neutral-200">
                {variations!.map((v, i) => {
                  const disabled = v.available === false;
                  const checked = selectedVar === i;
                  return (
                    <label
                      key={i}
                      className={cx(
                        'flex items-center justify-between gap-3 py-4 cursor-pointer',
                        disabled && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="modal-variation"
                          className="h-[18px] w-[18px] accent-black"
                          disabled={disabled}
                          checked={checked}
                          onChange={() => setSelectedVar(i)}
                          aria-checked={checked}
                        />
                        <span className="text-[16px] font-medium text-neutral-900">
                          {v.name || `Option ${i + 1}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {typeof v.compareAtPrice === 'number' &&
                        typeof v.price === 'number' &&
                        v.compareAtPrice > v.price ? (
                          <>
                            <span className="text-[13px] text-neutral-400 line-through">
                              {formatBDT(v.compareAtPrice)}
                            </span>
                            <span className="text-[16px] font-semibold text-neutral-900">
                              {formatBDT(v.price)}
                            </span>
                          </>
                        ) : (
                          <span className="text-[16px] font-semibold text-neutral-900">
                            {formatBDT(v.price) ?? '—'}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
