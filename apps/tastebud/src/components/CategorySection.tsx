import React from 'react';
import type { v1 } from '../../../../packages/shared/src/types';
import ProductCard from './ProductCard';

type Props = {
  id?: string;
  title: string;
  items: v1.MenuItemDTO[];
};

/**
 * CategorySection — shows a section with a title and grid of ProductCards.
 * Safe even if no items are passed.
 */
export default function CategorySection({ id, title, items }: Props) {
  if (!items?.length) return null;

  return (
    <section id={id} className="scroll-mt-20">
      {/* Category name */}
      <h2 className="mb-3 text-base font-semibold text-gray-900 sm:text-lg">{title}</h2>

      {/* Responsive grid layout for product cards */}
      <div
        className="
          grid grid-cols-2 gap-3 sm:gap-4
          md:grid-cols-3 lg:grid-cols-4
          auto-rows-fr
        "
      >
        {items.map((it) => (
          <ProductCard key={it.id} item={it} className="h-full" />
        ))}
      </div>
    </section>
  );
}
