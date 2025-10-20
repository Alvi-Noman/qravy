import { useEffect, useState } from 'react';
import { useCart } from '../context/CartContext';
import { placeDineInOrder } from '../api/storefront';
import { useNavigate } from 'react-router-dom';

export default function CheckoutDineIn() {
  const { lines, clear } = useCart();
  const nav = useNavigate();
  const [table, setTable] = useState('');

  // auto table: ?table=12 or localStorage
  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('table') || localStorage.getItem('tableNumber') || '';
    setTable(t);
  }, []);

  const submit = async () => {
    const items = lines.map(l => ({ id: l.item.id, qty: l.qty, variation: l.variationName }));
    await placeDineInOrder({ channel: 'dine-in', tableNumber: table || 'unknown', items });
    clear();
    nav('/order/placed');
  };

  return (
    <div className="max-w-lg mx-auto p-4">
      <h2 className="text-xl font-semibold mb-2">Dine-In Checkout</h2>
      <label className="text-sm">Table</label>
      <input className="border rounded w-full px-3 py-2 mb-4" value={table} onChange={e => setTable(e.target.value)} />
      <button className="w-full bg-black text-white rounded-lg py-2" onClick={submit}>Place Order</button>
    </div>
  );
}
