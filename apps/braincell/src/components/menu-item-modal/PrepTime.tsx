// Prep time: how long the kitchen needs for one portion. Drives the wait times guests see
// (menu, cart, order countdown) and the virtual waiter's "how long will it take?" answers.
import { ClockIcon } from '@heroicons/react/24/outline';

const QUICK = [5, 10, 15, 20, 30];

export default function PrepTime({
  value,
  onChange,
  defaultMinutes,
  error,
}: {
  /** "" = use the restaurant default */
  value: string;
  onChange: (v: string) => void;
  defaultMinutes: number;
  error?: string | null;
}) {
  const current = value.trim() ? Number(value) : null;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <ClockIcon className="h-4 w-4 text-[#6b6b70]" aria-hidden="true" />
        <label htmlFor="prep-minutes" className="text-sm font-medium text-[#2e2e30]">
          Prep time
        </label>
      </div>
      <p id="prep-help" className="mt-0.5 text-xs text-[#6b6b70]">
        How long the kitchen needs to make one portion. Guests see it as a wait time, and your virtual waiter uses it
        to answer “how long will it take?”. Leave empty to use your default ({defaultMinutes} min).
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-stretch">
          <input
            id="prep-minutes"
            inputMode="numeric"
            className={`w-20 rounded-l-md border bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] hover:border-[#111827] focus:outline-none ${
              error ? 'border-red-500 focus:border-red-500' : 'border-[#dbdbdb] focus:border-[#111827]'
            }`}
            placeholder={String(defaultMinutes)}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
            aria-describedby="prep-help"
            aria-invalid={!!error || undefined}
          />
          <span className="-ml-px select-none rounded-r-md border border-[#dbdbdb] bg-[#f6f6f6] px-2.5 py-2 text-sm text-[#6b7280]">
            min
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common prep times">
          {QUICK.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(current === m ? '' : String(m))}
              aria-pressed={current === m}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                current === m
                  ? 'border-[#111827] bg-[#111827] text-white'
                  : 'border-[#dbdbdb] bg-white text-[#2e2e30] hover:border-[#111827]'
              }`}
            >
              {m} min
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="mt-1 text-xs text-red-600" role="alert" aria-live="polite">
          {error}
        </div>
      )}
    </div>
  );
}
