import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export default function CartDrawer() {
  const { lines, remove, subtotal, channel } = useCart();
  if (!lines.length) return null;
  return (
    <div className="fixed bottom-4 right-4 bg-white shadow-xl rounded-2xl p-4 w-80">
      <div className="font-semibold mb-2">Cart</div>
      <div className="space-y-2 max-h-60 overflow-auto">
        {lines.map((l) => (
          <div key={l.item.id + (l.variationName ?? '')} className="flex justify-between text-sm">
            <div>
              {l.item.name} {l.variationName && <span>· {l.variationName}</span>} × {l.qty}
            </div>
            <button onClick={() => remove(l.item.id, l.variationName)} className="text-red-500">Remove</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between">
        <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
      </div>
      <Link
        to={channel === 'dine-in' ? '/checkout/dine-in' : '/checkout/online'}
        className="block mt-3 text-center bg-black text-white rounded-lg py-2"
      >
        Checkout
      </Link>
    </div>
  );
}
