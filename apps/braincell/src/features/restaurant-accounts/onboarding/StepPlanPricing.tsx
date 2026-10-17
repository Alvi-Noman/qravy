import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { completeOnboarding } from '../../../api/auth';
import { useAuthContext } from '../../../context/AuthContext';
import type { PlanInfo, PlanId } from './types';
import api from '../../../api/auth';

interface StepPlanPricingProps {
  value: PlanInfo;
  onChange: (v: PlanInfo) => void;
  onNext: () => void;
}

const services = [
  'Customizable Digital Menu',
  'Real-Time Availability Display',
  'In-Restaurant Ordering',
  'Call Waiter with a Single Tap',
  'AI Waiter Assistant',
  'AI-Powered Dish Recommendations',
  'Smart Upselling',
  'Multilingual Support',
  'Promotions & Deals',
  'Online Ordering & Payments',
  'Third-Party Delivery Integration',
  'Built-in Marketing Tools',
];

const disabledInStarter = new Set([
  'Online Ordering & Payments',
  'Third-Party Delivery Integration',
  'Built-in Marketing Tools',
]);

export default function StepPlanPricing({ value, onChange }: StepPlanPricingProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  // a price agreed with Qravy (negotiated) — optional; Qravy sees it in Cortex next to the list price
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customCurrency, setCustomCurrency] = useState<'BDT' | 'USD'>('BDT');
  const [customNote, setCustomNote] = useState('');
  const customValue = Number(customAmount);
  const customValid = customAmount.trim() !== '' && Number.isFinite(customValue) && customValue > 0;
  const customBad = customOpen && customAmount.trim() !== '' && !customValid;

  const navigate = useNavigate();
  const { reloadUser } = useAuthContext();

  const plans: {
    id: PlanId; // 'p1' | 'p2'
    title: string;
    monthly: string;
    yearly: string;
    description: string;
    highlight?: boolean;
  }[] = [
    {
      id: 'p1',
      title: 'Starter',
      monthly: '$29',
      yearly: '$290',
      description: 'Everything you need to get started with your digital restaurant menu.',
    },
    {
      id: 'p2',
      title: 'Pro',
      monthly: '$79',
      yearly: '$790',
      description: 'Unlock full potential with online ordering, integrations, and AI features.',
      highlight: true,
    },
  ];

  const handleSelect = async (id: PlanId) => {
    // Normalize to 4 canonical plan IDs:
    // Starter monthly -> p1_m, Starter yearly -> p1_y
    // Pro monthly -> p2_m, Pro yearly -> p2_y
    const base = id === 'p1' ? 'p1' : 'p2';
    const suffix = billingCycle === 'monthly' ? 'm' : 'y';
    const normalizedPlanId = `${base}_${suffix}`;

    if (customBad) return;
    onChange({ planId: normalizedPlanId } as any);
    setLoadingPlan(id);

    const start = Date.now();
    try {
      await api.post('/api/v1/auth/tenants/onboarding-step', {
        step: 'plan',
        data: {
          planId: normalizedPlanId,
          ...(customOpen && customValid
            ? { customPrice: { amount: customValue, currency: customCurrency, note: customNote.trim() } }
            : {}),
        },
      });
      await completeOnboarding();
      await reloadUser();
    } finally {
      const elapsed = Date.now() - start;
      const minDelay = 3000;
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, Math.max(0, minDelay - elapsed));
    }
  };

  const toggleBilling = () => {
    setBillingCycle((prev) => (prev === 'monthly' ? 'yearly' : 'monthly'));
  };

  return (
    <div className="w-full pt-9 pb-14">
      <div className="text-center mb-7">
        <h1 className="text-3xl font-semibold text-[#2e2e30]">Choose Your Plan</h1>
        <p className="mt-2 text-base text-[#555]">
          Select the subscription that fits your restaurant best
        </p>
        <div className="mt-5 flex justify-center items-center gap-4">
          <span className={billingCycle === 'monthly' ? 'font-medium text-[#2e2e30]' : 'text-[#777]'}>Monthly</span>
          <button
            type="button"
            onClick={toggleBilling}
            className="relative inline-flex h-6 w-12 items-center rounded-full bg-[#d4d4d8] transition"
          >
            <span
              className={`absolute h-5 w-5 rounded-full bg-white shadow transform transition ${
                billingCycle === 'yearly' ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className={billingCycle === 'yearly' ? 'font-medium text-[#2e2e30]' : 'text-[#777]'}>
            Yearly <span className="text-sm text-green-600">(2 months free)</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row justify-center gap-10 px-6">
        {plans.map((plan) => {
          const isStarter = plan.id === 'p1';
          const isLoading = loadingPlan === plan.id;

          return (
            <motion.div
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              key={plan.id}
              className={[
                'relative flex flex-col rounded-3xl border shadow-md transition-all w-full max-w-md bg-white',
                'border-[#e4e4e7] hover:shadow-lg',
                plan.highlight ? 'ring-2 ring-[#2e2e30]' : '',
              ].join(' ')}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 text-xs font-medium rounded-full bg-[#2e2e30] text-white shadow-sm">
                  Popular
                </span>
              )}

              <div className="p-7 flex flex-col flex-1">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-2xl font-semibold text-[#2e2e30]">{plan.title}</h2>
                  <motion.span layout className="text-3xl font-bold text-[#2e2e30]">
                    {billingCycle === 'monthly' ? plan.monthly : plan.yearly}
                    <span className="text-base font-medium ml-1">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                  </motion.span>
                </div>
                <p className="mb-5 text-sm text-[#555]">{plan.description}</p>
                <ul className="space-y-3 text-sm flex-1">
                  {services.map((s) => {
                    const disabled = isStarter && disabledInStarter.has(s);
                    return (
                      <li
                        key={s}
                        className={`flex items-center gap-2 ${
                          disabled ? 'text-gray-400 line-through' : 'text-[#2e2e30]'
                        }`}
                      >
                        {disabled ? (
                          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-[#2e2e30]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {s}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => handleSelect(plan.id)}
                disabled={isLoading}
                className={`w-full rounded-b-3xl py-4 text-base font-medium flex items-center justify-center gap-2 transition ${
                  isLoading
                    ? 'bg-[#2e2e30] text-white cursor-wait'
                    : 'bg-[#f5f5f5] text-[#2e2e30] hover:bg-[#e9e9ee]'
                }`}
              >
                {isLoading && (
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                )}
                {isLoading ? 'Starting your free trial…' : 'Start 14 Day Free Trial'}
              </button>
            </motion.div>
          );
        })}
      </div>

      <div className="mx-auto mt-8 w-full max-w-md px-6">
        {!customOpen ? (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="w-full text-center text-sm text-[#555] underline underline-offset-4 hover:text-[#2e2e30]"
          >
            Agreed a different price with Qravy?
          </button>
        ) : (
          <div className="rounded-2xl border border-[#e4e4e7] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#2e2e30]">Your agreed price</h3>
              <button
                type="button"
                onClick={() => {
                  setCustomOpen(false);
                  setCustomAmount('');
                  setCustomNote('');
                }}
                className="text-xs text-[#777] hover:text-[#2e2e30]"
              >
                Remove
              </button>
            </div>
            <p className="mt-1 text-xs text-[#777]">
              Only if you settled a price with the Qravy team. It applies to the plan you start above.
            </p>
            <div className="mt-3 flex gap-2">
              <select
                value={customCurrency}
                onChange={(e) => setCustomCurrency(e.target.value === 'USD' ? 'USD' : 'BDT')}
                aria-label="Currency"
                className="rounded-lg border border-[#e4e4e7] bg-white px-2 text-sm text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#2e2e30]/20"
              >
                <option value="BDT">৳ BDT</option>
                <option value="USD">$ USD</option>
              </select>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Amount"
                aria-label="Agreed price"
                className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#2e2e30]/20 ${
                  customBad ? 'border-red-400' : 'border-[#e4e4e7]'
                }`}
              />
              <span className="self-center text-sm text-[#555]">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
            </div>
            {customBad && <p className="mt-1 text-xs text-red-500">Enter a price above 0.</p>}
            <input
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value.slice(0, 200))}
              placeholder="Note (optional) — e.g. launch discount for 6 months"
              aria-label="Note"
              className="mt-2 w-full rounded-lg border border-[#e4e4e7] px-3 py-2 text-sm text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#2e2e30]/20"
            />
          </div>
        )}
      </div>
    </div>
  );
}