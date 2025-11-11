import React from 'react';

export type Variation = {
  id: string;
  name?: string;
  price?: number;
};

export type Selection = {
  variationId?: string;
};

type Props = {
  variations?: Variation[];
  value?: Selection;
  onChange?: (sel: Selection) => void;
  className?: string;
};

/**
 * Mobile-first, pill-style variation selector (single-choice).
 * Horizontally scrollable on small screens.
 */
export default function VariationsSelector({ variations = [], value, onChange, className }: Props) {
  if (!Array.isArray(variations) || variations.length === 0) return null;

  const activeId = value?.variationId;

  return (
    <div className={`mt-2 ${className ?? ''}`}>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {variations.map((v) => {
          const id = v.id ?? String(v.name ?? '');
          const isActive = id === activeId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange?.({ variationId: id })}
              className={[
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
                isActive
                  ? 'border-black bg-black text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              ].join(' ')}
              aria-pressed={isActive}
            >
              {v.name ?? 'Option'}
              {typeof v.price === 'number' ? ` · $${v.price.toFixed(2)}` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
