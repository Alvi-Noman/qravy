import type { v1 } from '../../../../packages/shared/src/types';

export default function ProductCard({ item, onClick }: { item: v1.MenuItemDTO; onClick: () => void }) {
  const img = item.media?.[0];
  return (
    <button className="rounded-2xl shadow p-3 text-left hover:shadow-md transition" onClick={onClick}>
      {img && <img src={img} alt={item.name} className="w-full h-40 object-cover rounded-xl mb-2" />}
      <div className="font-medium">{item.name}</div>
      <div className="text-sm text-gray-600 line-clamp-2">{item.description}</div>
      <div className="mt-2">
        <span className="font-semibold">${item.price.toFixed(2)}</span>
        {item.compareAtPrice && item.compareAtPrice > item.price && (
          <span className="ml-2 text-xs line-through text-gray-400">${item.compareAtPrice.toFixed(2)}</span>
        )}
      </div>
    </button>
  );
}
