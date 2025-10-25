import React from 'react';

type Props = {
  /** Current/effective price */
  price?: number;
  /** Optional compare-at price (MSRP / crossed-out) */
  compareAt?: number;
  /** Optional compact style for tight spaces */
  compact?: boolean;
  className?: string;
};

export default function PriceTag({ price, compareAt, compact, className }: Props) {
  if (typeof price !== 'number' && typeof compareAt !== 'number') {
    return <div className={compact ? 'h-3' : 'h-4'} />;
  }

  const showCompare = typeof price === 'number' && typeof compareAt === 'number' && compareAt > price;

  const base = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={`mt-1 ${base} ${className ?? ''}`}>
      {showCompare ? (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 line-through">${compareAt!.toFixed(2)}</span>
          <span className="font-semibold text-gray-900">${price!.toFixed(2)}</span>
        </div>
      ) : (
        <span className="text-gray-800">
          {typeof price === 'number'
            ? `$${price.toFixed(2)}`
            : typeof compareAt === 'number'
            ? `$${compareAt.toFixed(2)}`
            : null}
        </span>
      )}
    </div>
  );
}
