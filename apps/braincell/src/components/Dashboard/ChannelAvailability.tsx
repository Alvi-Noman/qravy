import { toastSuccess } from '../Toaster';

export default function ChannelAvailability({
  dineIn,
  online,
}: {
  dineIn: number;
  online: number;
}) {
  const handleToggle = (channel: 'Dine-In' | 'Online') => {
    toastSuccess(`${channel} items toggled`);
    // TODO: connect to API mutation
  };

  return (
    <div className="rounded-lg border border-[#ececec] bg-white p-5 shadow-sm">
      <h3 className="mb-4 font-semibold text-[#2e2e30]">Channel Availability</h3>
      <div className="flex gap-6">
        <ChannelStat label="Dine-In" value={dineIn} color="text-indigo-600" onToggle={() => handleToggle('Dine-In')} />
        <ChannelStat label="Online" value={online} color="text-pink-500" onToggle={() => handleToggle('Online')} />
      </div>
    </div>
  );
}

function ChannelStat({
  label,
  value,
  color,
  onToggle,
}: {
  label: string;
  value: number;
  color: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-center flex-1">
      <span className={`font-bold text-2xl ${color}`}>{value}</span>
      <span className="text-sm text-[#6b6b70] mb-2">{label} Items</span>
      <button
        onClick={onToggle}
        className="text-xs rounded-md border border-[#cecece] px-3 py-1 hover:bg-[#f5f5f5]"
      >
        Toggle
      </button>
    </div>
  );
}