// apps/tastebud/src/components/ProductCard.tsx
import React from 'react';
import type { v1 } from '../../../../packages/shared/src/types';
import Modal from './Modal';
import { minutesLabel, prepRange } from '../utils/wait-time';

export type ProductCardProps = {
  item: v1.MenuItemDTO;
  className?: string;
  /** Set when the item's section is outside its serving hours, e.g. "Available 7am–11am" */
  closedNote?: string;
};

/** Short labels shown as badges (Spicy, Vegetarian, Halal…) */
export function visibleTags(item: any, max = 3): string[] {
  return Array.isArray(item?.tags)
    ? (item.tags as unknown[]).filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, max)
    : [];
}

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
  return typeof item?.price === 'number'
    ? item.price
    : getMinFromVariations(item?.variations, 'price');
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
function ProductCardBase({ item, className, closedNote }: ProductCardProps): JSX.Element {
  const anyItem = item as any;

  // Media
  const images: string[] = Array.isArray(anyItem.media)
    ? (anyItem.media as string[]).filter(Boolean)
    : [];
  const image: string | undefined = images[0];

  const description: string | undefined =
    typeof anyItem.description === 'string'
      ? anyItem.description
      : typeof anyItem.subtitle === 'string'
      ? anyItem.subtitle
      : undefined;

  const price = getEffectivePrice(anyItem);
  const compareAt = getCompareAtPrice(anyItem);
  const unavailable = isUnavailable(anyItem);
  const tags = visibleTags(anyItem);
  const prep = prepRange(anyItem);

  const [open, setOpen] = React.useState(false);

  const hasVariations = Array.isArray(anyItem.variations) && anyItem.variations.length > 0;

  return (
    <>
      <article
        aria-label={anyItem.name}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={
          'group relative flex w-full flex-row-reverse items-start gap-4 rounded-[26px] bg-white p-4 sm:p-5 font-[Inter] ' +
          'shadow-[0_1px_4px_rgba(0,0,0,0.05)] transition-all duration-200 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)] hover:-translate-y-[1px] cursor-pointer ' +
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
                  {hasVariations ? `From ${formatCurrency(price)}` : formatCurrency(price)}
                </span>
              </>
            ) : (
              <span className="text-[16px] font-semibold text-neutral-900 transition-opacity duration-200 group-hover:opacity-90">
                {hasVariations ? `From ${formatCurrency(price)}` : formatCurrency(price) ?? '—'}
              </span>
            )}

            {prep && !unavailable && (
              <span
                className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-500"
                title="About how long the kitchen takes to make it"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3" aria-hidden="true">
                    <circle cx="10" cy="10" r="7.5" />
                    <path d="M10 6v4.2l2.6 1.6" strokeLinecap="round" />
                  </svg>
                {minutesLabel(prep)}
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

          {closedNote && !unavailable && (
            <span className="mt-1 self-start rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
              {closedNote}
            </span>
          )}

          {(anyItem.signature || tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {anyItem.signature && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                  </svg>
                  Signature
                </span>
              )}
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

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

      {/* Modal — NO children prop; we pass content via props */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={anyItem.name}
        image={image}
        images={images}                 // <-- provide all images for the slider
        price={price}
        compareAt={compareAt}
        unavailable={unavailable || !!closedNote}
        unavailableNote={unavailable ? undefined : closedNote}
        tags={Array.isArray(anyItem.tags) ? anyItem.tags : undefined}
        description={description}
        variations={anyItem.variations} // allow Modal to render variation table
        options={anyItem.options}
        modifierGroups={anyItem.modifierGroups}
        prepMinutes={anyItem.prepMinutes}
        itemId={anyItem.id ? String(anyItem.id) : undefined}
      />
    </>
  );
}

/* ---------- Memo with tight comparator ---------- */
const ProductCard = React.memo(ProductCardBase, (prev, next) => {
  const a = prev.item as any;
  const b = next.item as any;

  return (
    prev.className === next.className &&
    prev.closedNote === next.closedNote &&
    (Array.isArray(a.tags) ? a.tags.join('|') : '') === (Array.isArray(b.tags) ? b.tags.join('|') : '') &&
    a.id === b.id &&
    !!a.signature === !!b.signature &&
    a.name === b.name &&
    a.status === b.status &&
    a.available === b.available &&
    a.price === b.price &&
    a.compareAtPrice === b.compareAtPrice &&
    JSON.stringify(prepRange(a)) === JSON.stringify(prepRange(b)) &&
    JSON.stringify(a.modifierGroups ?? null) === JSON.stringify(b.modifierGroups ?? null) &&
    getMinFromVariations(a?.variations, 'price') === getMinFromVariations(b?.variations, 'price') &&
    getMinFromVariations(a?.variations, 'compareAtPrice') ===
      getMinFromVariations(b?.variations, 'compareAtPrice') &&
    ((Array.isArray(a.media) ? a.media[0] : undefined) ===
      (Array.isArray(b.media) ? b.media[0] : undefined)) &&
    (typeof a.description === 'string' ? a.description : a.subtitle) ===
      (typeof b.description === 'string' ? b.description : b.subtitle)
  );
});

export default ProductCard;
