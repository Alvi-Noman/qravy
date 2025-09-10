import { useEffect, useState } from 'react';
import type { PlanInfo } from './types';

type PackageId = 'p1' | 'p2';

type Props = {
  value: PlanInfo;
  onChange: (v: PlanInfo) => void;
  onNext: () => void;
};

export default function StepPlanPricing({ value, onChange, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);

  // Default to Package 1 if nothing selected yet
  useEffect(() => {
    if (!value.planId) onChange({ ...value, planId: 'p1' as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPlan = (id: PackageId) => {
    onChange({ ...value, planId: id as any });
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.planId) return setError('Please pick a plan.');
    onNext();
  };

  const cards: Array<{
    id: PackageId;
    title: string;
    lines: string[];
  }> = [
    {
      id: 'p1',
      title: 'Package 1',
      lines: [
        'Customizable Digital Menu',
        'Real-Time Availability Display',
        'In-Restaurant Ordering',
        'Call Waiter with a Single Tap',
        'AI Waiter Assistant',
        'AI-Powered Dish Recommendations',
        'Smart Upselling',
        'Multilingual Support',
        'Promotions & Deals',
      ],
    },
    {
      id: 'p2',
      title: 'Package 2',
      lines: [
        'Everything in Package 1',
        'Online Ordering & Payments',
        'Third-Party Delivery Integration',
        'Built-in Marketing Tools',
      ],
    },
  ];

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">Pick your plan</h2>
      <p className="text-sm text-[#5b5b5d] text-center mt-3 mb-8">
        Choose the package that fits your service.
      </p>

      {/* Selectable cards (stacked vertically) */}
      <div role="radiogroup" aria-label="Plans" className="w-full grid grid-cols-1 gap-3 mb-6">
        {cards.map((c) => {
          const selected = value.planId === (c.id as any);
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectPlan(c.id)}
              className={[
                'relative w-full rounded-lg border transition p-4 text-left bg-white',
                'shadow-sm',
                selected
                  ? 'border-[#2e2e30] shadow-[0_2px_8px_rgba(0,0,0,0.05)]'
                  : 'border-[#cecece] hover:border-[#b0b0b5]',
              ].join(' ')}
            >
              {/* Radio in top-left */}
              <span className="absolute top-4 left-4 inline-flex items-center justify-center">
                <span
                  aria-hidden="true"
                  className={[
                    'h-5 w-5 rounded-full border-2 transition',
                    selected ? 'border-[#2e2e30]' : 'border-[#bdbdbf]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'block h-2.5 w-2.5 rounded-full m-[3px] transition',
                      selected ? 'bg-[#2e2e30]' : 'bg-transparent',
                    ].join(' ')}
                  />
                </span>
              </span>

              {/* Content */}
              <div className="pl-10">
                <div className="text-base font-medium text-[#2e2e30] mb-1">{c.title}</div>
                <ul className="space-y-1">
                  {c.lines.map((line) => (
                    <li key={line} className="text-sm text-[#5b5b5d]">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="text-red-500 -mt-1 mb-3 text-sm w-full text-left" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="w-full h-12 rounded-md font-medium transition border text-center bg-[#2e2e30] border-[#2e2e30] text-white hover:bg-[#262629]"
      >
        Start Free Trial
      </button>
      <p className="text-center text-xs text-[#5b5b5d] mt-2">No credit card required</p>
    </form>
  );
}