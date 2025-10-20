import { useCart } from '../context/CartContext';

export default function ChannelSwitch() {
  const { channel, setChannel, clear } = useCart();
  return (
    <div className="flex gap-2">
      {(['dine-in', 'online'] as const).map((c) => (
        <button
          key={c}
          className={`px-3 py-1 rounded ${channel === c ? 'bg-black text-white' : 'bg-gray-200'}`}
          onClick={() => { setChannel(c); clear(); }} // clear cart when switching flows
        >
          {c === 'dine-in' ? 'Dine-In' : 'Online'}
        </button>
      ))}
    </div>
  );
}
