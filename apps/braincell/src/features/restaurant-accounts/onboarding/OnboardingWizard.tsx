import { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import StepWelcome from './StepWelcome';
import StepOwnerAdmin from './StepOwnerAdmin';
import StepRestaurantInfo from './StepRestaurantInfo';
import StepPlanPricing from './StepPlanPricing';
import type { OnboardingState } from './types';

const initialState: OnboardingState = {
  owner: { fullName: '', phone: '' },
  restaurant: { restaurantType: '', country: '', address: '' },
  plan: { planId: null },
};

const steps = [
  { key: 'welcome' },
  { key: 'owner' },
  { key: 'restaurant' },
  { key: 'plan' },
] as const;

export default function OnboardingWizard() {
  const [state, setState] = useState<OnboardingState>(initialState);
  const [index, setIndex] = useState<number>(0);

  const current = steps[index]?.key;
  const canGoBack = index > 0;

  /** Validation rules for each step */
  const isStepValid = (stepKey: typeof steps[number]['key']): boolean => {
    if (stepKey === 'owner') {
      return state.owner.fullName.trim() !== '' && state.owner.phone.trim() !== '';
    }
    if (stepKey === 'restaurant') {
      return (
        state.restaurant.restaurantType.trim() !== '' &&
        state.restaurant.country.trim() !== '' &&
        state.restaurant.address.trim() !== ''
      );
    }
    if (stepKey === 'plan') {
      return state.plan.planId !== null;
    }
    return true; // welcome always valid
  };

  const goNext = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setIndex((i) => Math.max(i - 1, 0));

  const goTo = (i: number) => {
    if (i <= index) {
      // backward always allowed
      setIndex(i);
    } else {
      // moving forward: check current step validity
      if (isStepValid(current!)) {
        setIndex(i);
      } else {
        alert('Please fill in the required information before continuing.');
      }
    }
  };

  const update = <K extends keyof OnboardingState>(
    key: K,
    value: OnboardingState[K]
  ) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const dots = useMemo(
    () => (
      <div className="flex items-center justify-center gap-2">
        {steps.map((_, i) => {
          const disabledForward = i > index && !isStepValid(current!);
          return (
            <button
              key={i}
              type="button"
              aria-label={`Go to step ${i + 1}`}
              onClick={() => !disabledForward && goTo(i)}
              disabled={disabledForward}
              className={[
                'h-2.5 w-2.5 rounded-full transition',
                i === index
                  ? 'bg-[#2e2e30]'
                  : 'bg-[#e9e9ee] hover:bg-[#dcdce1]',
              ].join(' ')}
            />
          );
        })}
      </div>
    ),
    [index, state]
  );

  return (
    <div className="min-h-[100svh] w-full bg-[#fcfcfc] flex flex-col font-inter">
      {canGoBack && (
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="fixed top-4 left-4 z-50 h-10 w-10 rounded-full border border-[#cecece] bg-white/90 text-[#2e2e30] hover:bg-[#f5f5f5] shadow-sm flex items-center justify-center"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      <div className="flex-1 grid place-items-center px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.2 }}
            className="w-full"
          >
            {/* Welcome */}
            {current === 'welcome' && (
              <div className="mx-auto w-96">
                <StepWelcome onNext={goNext} />
              </div>
            )}

            {/* Owner */}
            {current === 'owner' && (
              <div className="mx-auto w-96">
                <StepOwnerAdmin
                  value={state.owner}
                  onChange={(v) => update('owner', v)}
                  onNext={goNext}
                />
              </div>
            )}

            {/* Restaurant */}
            {current === 'restaurant' && (
              <div className="mx-auto w-96">
                <StepRestaurantInfo
                  value={state.restaurant}
                  onChange={(v) => update('restaurant', v)}
                  onNext={goNext}
                />
              </div>
            )}

            {/* Plan (full-width, no card wrapper) */}
            {current === 'plan' && (
              <div className="w-full">
                <StepPlanPricing
                  value={state.plan}
                  onChange={(v) => update('plan', v)}
                  onNext={goNext}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="w-full py-6">{dots}</div>
    </div>
  );
}