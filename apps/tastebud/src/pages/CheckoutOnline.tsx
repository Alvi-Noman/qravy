import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { placeOnlineOrder } from '../api/storefront';
import { useNavigate } from 'react-router-dom';

export default function CheckoutOnline() {
  const { lines, clear } = useCart();
  const nav = useNavigate();
  const [form, set] = useState({ name: '', phone: '', address: '' });

  const submit = async () => {
    const items = lines.map(l => ({ id: l.item.id, qty: l.qty, variation: l.variationName }));
    await placeOnlineOrder({ channel: 'online', customer: form, items });
    clear();
    nav('/order/placed');
  };

  return (
    <div className="max-w-lg mx-auto p-4">
      <h2 className="text-xl font-semibold mb-2">Online Checkout</h2>
      {(['name','phone','address'] as const).map((k) => (
        <div key={k} className="mb-3">
          <label className="text-sm capitalize">{k}</label>
          <input className="border rounded w-full px-3 py-2"
                 value={form[k]} onChange={(e)=>set({...form,[k]: e.target.value})}/>
        </div>
      ))}
      <button className="w-full bg-black text-white rounded-lg py-2" onClick={submit}>Place Order</button>
    </div>
  );
}
