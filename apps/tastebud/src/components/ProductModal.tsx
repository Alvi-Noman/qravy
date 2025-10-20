import { useState } from 'react';
import type { v1 } from '../../../../packages/shared/src/types';
import { useCart } from '../context/CartContext';

export default function ProductModal({ item, onClose }: { item: v1.MenuItemDTO; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const [variation, setVariation] = useState<string | undefined>(() => item.variations?.[0]?.name);
  const { add } = useCart();

  const addToCart = () => { add(item, qty, variation); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4">
      <div className="bg-white max-w-md w-full rounded-2xl p-4">
        <div className="flex gap-4">
          {item.media?.[0] && <img src={item.media[0]} alt={item.name} className="w-32 h-32 object-cover rounded-lg" />}
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{item.name}</h2>
            <p className="text-sm text-gray-600">{item.description}</p>
            {item.variations?.length ? (
              <select
                className="border rounded px-2 py-1 mt-2 w-full"
                value={variation}
                onChange={(e) => setVariation(e.target.value)}
              >
                {item.variations.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} {typeof v.price === 'number' ? `($${v.price.toFixed(2)})` : ''}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <input type="number" min={1} value={qty} onChange={(e) => setQty(+e.target.value || 1)} className="w-20 border rounded px-2 py-1" />
              <button className="ml-auto px-4 py-2 rounded bg-black text-white" onClick={addToCart}>Add</button>
            </div>
          </div>
        </div>
        <button className="mt-3 text-sm text-gray-500" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
