import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { usePlanQuery } from '../hooks/usePlan';
import type { PlanTier } from '../../../api/billing';

const catalog: Record<
  PlanTier,
  { label: string; priceM: number; includesSeats: number; features: string[] }
> = {
  Free: { label: 'Free', priceM: 0, includesSeats: 1, features: ['Basic menu', 'QR menu link', 'Community support'] },
  Starter: { label: 'Starter', priceM: 29, includesSeats: 3, features: ['Custom domain', 'Branding', 'Email support'] },
  Pro: { label: 'Pro', priceM: 99, includesSeats: 5, features: ['Analytics', 'Advanced roles', 'API/Webhooks'] },
  Business: { label: 'Business', priceM: 249, includesSeats: 10, features: ['SLA & SSO', 'Multi-venue', 'Priority support'] },
  Enterprise: { label: 'Enterprise', priceM: 0, includesSeats: 25, features: ['Custom SSO/SAML', 'Dedicated infra', 'Custom terms'] },
};

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

const disabledInStarter = new Set(['Online Ordering & Payments', 'Third-Party Delivery Integration', 'Built-in Marketing Tools']);

function formatCurrency(amount: number, currency = 'usd') {
  const code = currency.toUpperCase();
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
}

export default function PlanOverviewPage(): JSX.Element {
  const navigate = useNavigate();
  const { data: plan, isLoading } = usePlanQuery();

  const entry = plan ? catalog[plan.tier] : null;

  const priceLine = useMemo(() => {
    if (!plan || !entry) return '';
    if (plan.tier === 'Enterprise') return 'Custom';
    const m = entry.priceM;
    if (plan.interval === 'month') return `$${m} USD/month`;
    const y = Math.round(m * 12 * 0.85);
    return `$${y} USD/year`;
  }, [plan, entry]);

  const isYearly = plan?.interval === 'year';

  const yearlySavings = useMemo(() => {
    if (!plan || !entry || entry.priceM <= 0 || plan.tier === 'Enterprise') return 0;
    const full = entry.priceM * 12;
    const discounted = Math.round(entry.priceM * 12 * 0.85);
    return full - discounted;
  }, [plan, entry]);

  const snapshotBenefits = useMemo(() => {
    if (!plan) return [];
    if (plan.tier === 'Starter') return services.filter((s) => !disabledInStarter.has(s)).slice(0, 3);
    return services.slice(0, 3);
  }, [plan]);

  const openSheet = () => navigate('/settings/plan/select');

  if (isLoading || !plan || !entry) {
    return (
      <div className="grid gap-4">
        <div className="h-10 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-40 animate-pulse rounded-xl border border-[#ececec] bg-white" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold text-slate-900">Plan details</div>
        <button
          onClick={openSheet}
          className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
        >
          Change plan
        </button>
      </div>

      {/* Plan details card */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <div className="text-[18px] font-semibold text-slate-900">{entry.label}</div>
          <div className="text-[20px] font-bold text-slate-900">{priceLine}</div>
          {entry.priceM > 0 && plan.tier !== 'Enterprise' && (
            <div className="text-[12px] text-slate-600">
              {isYearly ? 'Billed yearly' : 'Billed monthly'} • Includes {entry.includesSeats} seats
            </div>
          )}
        </div>

        {/* Yearly savings banner */}
        {entry.priceM > 0 && plan.tier !== 'Enterprise' && (
          <button
            type="button"
            onClick={openSheet}
            className="mt-3 inline-flex w-full items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-left text-[13px] text-indigo-800"
            title="See billing options"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3m6 0c0 1.657-1.343 3-3 3m0 0v2m0-8V6m0 0a9 9 0 110 12 9 9 0 010-12z" />
            </svg>
            Pay yearly and save {formatCurrency(yearlySavings)}/year
          </button>
        )}

        {/* Snapshot benefits */}
        <div className="mt-3 border-t border-slate-200 pt-3">
          <ul className="space-y-2 text-[13px] text-slate-800">
            {snapshotBenefits.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckIcon className="h-4 w-4 text-slate-600" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Tinted footer row (opens selector) */}
        <button
          type="button"
          onClick={openSheet}
          className="mt-4 -mx-4 -mb-4 flex w-[calc(100%+2rem)] items-center justify-between rounded-b-xl border-t border-[#e5e5e5] bg-[#f6f6f6] px-4 py-3 text-left text-[13px] text-slate-700 hover:bg-[#efefef]"
        >
          <span>View all features</span>
          <ChevronRightIcon className="h-4 w-4 text-slate-500" />
        </button>
      </div>
    </div>
  );
}