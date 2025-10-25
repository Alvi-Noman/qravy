// apps/tastebud/src/components/ProductCard.tsx
import React from 'react';
import type { v1 } from '../../../../packages/shared/src/types';

export type ProductCardProps = {
  item: v1.MenuItemDTO;
  className?: string;
};

/* ---------- Perf: cache formatter once ---------- */
const BDT = new Intl.NumberFormat('en-BD');

/* ---------- Helpers (pure) ---------- */
function getMinFromVariations(
  variations?: Array<Partial<{ price?: number; compareAtPrice?: number }>>,
  field: 'price' | 'compareAtPrice' = 'price'
) {
  if (!Array.isArray(variations) || variations.length === 0) return undefined;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < variations.length; i++) {
    const v = variations[i]?.[field];
    if (typeof v === 'number' && v < min) min = v;
  }
  return Number.isFinite(min) ? min : undefined;
}

function getEffectivePrice(item: any): number | undefined {
  return typeof item?.price === 'number' ? item.price : getMinFromVariations(item?.variations, 'price');
}

function getCompareAtPrice(item: any): number | undefined {
  return typeof item?.compareAtPrice === 'number'
    ? item.compareAtPrice
    : getMinFromVariations(item?.variations, 'compareAtPrice');
}

function isUnavailable(item: any): boolean {
  if (item?.status === 'hidden') return true;
  if (item?.available === false) return true;
  if (typeof item?.availability === 'string' && item.availability.toLowerCase() === 'unavailable') {
    return true;
  }
  return false;
}

function formatCurrency(n?: number) {
  if (typeof n !== 'number') return undefined;
  return `৳ ${BDT.format(n)}`;
}

/* ---------- Component ---------- */
function ProductCardBase({ item, className }: ProductCardProps): JSX.Element {
  const anyItem = item as any;

  // Avoid allocating arrays/objects in render path
  const image: string | undefined = Array.isArray(anyItem.media) ? anyItem.media[0] : undefined;
  const description: string | undefined =
    typeof anyItem.description === 'string'
      ? anyItem.description
      : typeof anyItem.subtitle === 'string'
      ? anyItem.subtitle
      : undefined;

  const price = getEffectivePrice(anyItem);
  const compareAt = getCompareAtPrice(anyItem);
  const unavailable = isUnavailable(anyItem);

  return (
    <article
      aria-label={anyItem.name}
      className={
        'group relative flex w-full flex-row-reverse items-start gap-4 rounded-[26px] bg-white p-4 sm:p-5 font-[Inter] ' +
        'shadow-[0_1px_4px_rgba(0,0,0,0.05)] transition-all duration-200 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)] hover:-translate-y-[1px] ' +
        (className ?? '')
      }
    >
      {/* Right: Image */}
      <div className="relative h-[110px] w-[110px] shrink-0 overflow-hidden rounded-[16px]">
        {image ? (
          <img
            src={image}
            alt={anyItem.name}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full rounded-[16px] bg-gray-100" />
        )}
      </div>

      {/* Left: Info column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Name */}
        <h3
          className="min-w-0 flex-1 truncate text-[16px] sm:text-[17px] font-semibold text-neutral-900 tracking-tight transition-transform duration-200 group-hover:-translate-y-0.5"
          title={anyItem.name}
        >
          {anyItem.name}
        </h3>

        {/* Price + Availability */}
        <div className="mt-1 flex items-center gap-2">
          {typeof compareAt === 'number' && typeof price === 'number' && compareAt > price ? (
            <>
              <span className="text-[13px] text-neutral-400 line-through">
                {formatCurrency(compareAt)}
              </span>
              <span className="text-[16px] font-semibold text-neutral-900 transition-opacity duration-200 group-hover:opacity-90">
                {formatCurrency(price)}
              </span>
            </>
          ) : (
            <span className="text-[16px] font-semibold text-neutral-900 transition-opacity duration-200 group-hover:opacity-90">
              {formatCurrency(price) ?? '—'}
            </span>
          )}

          {unavailable && (
            <span
              className="ml-2 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: '#F5E6E8', color: '#FA2851' }}
            >
              Unavailable
            </span>
          )}
        </div>

        {/* Description */}
        {description ? (
          <p
            className="mt-auto pt-2 text-[13px] leading-[1.4] text-neutral-600 line-clamp-2 transition-opacity duration-200 group-hover:opacity-90"
            title={description}
          >
            {description}
          </p>
        ) : (
          <div className="mt-auto h-3" />
        )}
      </div>
    </article>
  );
}

/* ---------- Memo with tight comparator ---------- */
const ProductCard = React.memo(ProductCardBase, (prev, next) => {
  const a = prev.item as any;
  const b = next.item as any;

  // Fast bailouts when identity/price/availability/text didn’t change
  return (
    prev.className === next.className &&
    a.id === b.id &&
    a.name === b.name &&
    a.status === b.status &&
    a.available === b.available &&
    a.price === b.price &&
    a.compareAtPrice === b.compareAtPrice &&
    // variations: compare min price quickly (covers most “matrix” cases)
    getMinFromVariations(a?.variations, 'price') === getMinFromVariations(b?.variations, 'price') &&
    getMinFromVariations(a?.variations, 'compareAtPrice') ===
      getMinFromVariations(b?.variations, 'compareAtPrice') &&
    // media first image (what we render)
    ((Array.isArray(a.media) ? a.media[0] : undefined) ===
      (Array.isArray(b.media) ? b.media[0] : undefined)) &&
    // small text that we render
    (typeof a.description === 'string' ? a.description : a.subtitle) ===
      (typeof b.description === 'string' ? b.description : b.subtitle)
  );
});

export default ProductCard;
