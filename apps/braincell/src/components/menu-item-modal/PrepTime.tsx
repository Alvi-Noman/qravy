// Prep time: how long the kitchen needs for one portion. Drives the wait times guests see
// (menu, cart, order countdown) and the virtual waiter's "how long will it take?" answers.
// Every dish gets its own time: leave it empty and the AI works it out from the dish.
import { ClockIcon, SparklesIcon } from '@heroicons/react/24/outline';

const QUICK = [5, 10, 15, 20, 30];

export type PrepSource = 'owner' | 'menu' | 'ai' | 'guess';

const BADGE: Partial<Record<PrepSource, [string, string]>> = {
  ai: ['AI estimate', 'bg-violet-50 text-violet-700 ring-violet-200'],
  guess: ['Estimate — AI is refining it', 'bg-slate-50 text-slate-600 ring-slate-200'],
  menu: ['From your menu', 'bg-sky-50 text-sky-700 ring-sky-200'],
};

export default function PrepTime({
  value,
  onChange,
  defaultMinutes,
  error,
  source,
  onSuggest,
  suggesting,
}: {
  /** "" = let the AI work it out */
  value: string;
  onChange: (v: string) => void;
  /** Restaurant fallback, only used if the AI can't be reached */
  defaultMinutes: number;
  error?: string | null;
  /** Where the current value came from (badge) */
  source?: PrepSource;
  /** "Ask AI" — estimates this dish from its name, category, description and sizes */
  onSuggest?: () => void;
  suggesting?: boolean;
}) {
  const current = value.trim() ? Number(value) : null;
  const badge = value.trim() && source ? BADGE[source] : undefined;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ClockIcon className="h-4 w-4 text-[#6b6b70]" aria-hidden="true" />
        <label htmlFor="prep-minutes" className="text-sm font-medium text-[#2e2e30]">
          Prep time
        </label>
        {badge && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${badge[1]}`}>
            {source === 'ai' && <SparklesIcon className="h-3 w-3" aria-hidden="true" />}
            {badge[0]}
          </span>
        )}
      </div>
      <p id="prep-help" className="mt-0.5 text-xs text-[#6b6b70]">
        How long the kitchen needs to make one portion. Guests see it as a wait time, and your virtual waiter uses it
        to answer “how long will it take?”. Leave it empty and AI estimates it for this dish — change it any time.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-stretch">
          <input
            id="prep-minutes"
            inputMode="numeric"
            className={`w-20 rounded-l-md border bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] hover:border-[#111827] focus:outline-none ${
              error ? 'border-red-500 focus:border-red-500' : 'border-[#dbdbdb] focus:border-[#111827]'
            }`}
            placeholder="Auto"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
            aria-describedby="prep-help"
            aria-invalid={!!error || undefined}
          />
          <span className="-ml-px select-none rounded-r-md border border-[#dbdbdb] bg-[#f6f6f6] px-2.5 py-2 text-sm text-[#6b7280]">
            min
          </span>
        </div>
        {onSuggest && (
          <button
            type="button"
            onClick={onSuggest}
            disabled={suggesting}
            className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:border-violet-400 disabled:opacity-60"
            title="Estimate this dish's prep time with AI"
          >
            <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {suggesting ? 'Estimating…' : 'Ask AI'}
          </button>
        )}
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
      <span className="sr-only">Used only if AI can't be reached: {defaultMinutes} min</span>
    </div>
  );
}
