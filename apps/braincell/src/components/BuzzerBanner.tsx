// apps/braincell/src/components/BuzzerBanner.tsx — the counter buzzer on the Orders and Service Requests pages:
// "ringing" (with Silence), and "offline" when the buzzer device has stopped checking in (no power / no Wi-Fi) — so a
// restaurant that relies on it knows before an order is missed.
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

function ago(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

export default function BuzzerBanner({
  active,
  kind,
  deviceOffline,
  deviceSeenAgo,
  onSilence,
}: {
  active: boolean;
  kind: 'order' | 'call' | null;
  deviceOffline: boolean;
  deviceSeenAgo: number | null;
  onSilence: () => void;
}) {
  return (
    <>
      {deviceOffline && deviceSeenAgo !== null && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">The counter buzzer is offline</div>
            <div>
              Last heard from {ago(deviceSeenAgo)} ago — it won’t ring until it’s back. Check that it has power and Wi-Fi. Orders and table
              calls still show here.
            </div>
          </div>
        </div>
      )}
      {active && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
            </span>
            <span className="text-sm font-medium text-amber-800">
              Counter buzzer is ringing — {kind === 'call' ? 'a table is calling for staff' : 'a new order came in'}
            </span>
          </div>
          <button
            type="button"
            onClick={onSilence}
            className="shrink-0 whitespace-nowrap rounded-md bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-200 active:scale-95"
          >
            Silence buzzer
          </button>
        </div>
      )}
    </>
  );
}
