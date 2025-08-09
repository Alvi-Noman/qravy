// pages/restaurant/OnboardingWizard.tsx
import { useState } from 'react';
import StepWelcome from './steps/StepWelcome';
import StepLocation from './steps/StepLocation';
import StepTableCount from './steps/StepTableCount';

const steps = [
  StepWelcome,
  StepLocation,
  StepTableCount,
];

export default function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const StepComponent = steps[step];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <StepComponent
        onNext={() => setStep(step + 1)}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
      />
      <div className="flex gap-2 mt-6">
        {steps.map((_, i) => (
          <span
            key={i}
            className={`w-3 h-3 rounded-full cursor-pointer ${i === step ? 'bg-blue-500' : 'bg-gray-300'}`}
            onClick={() => setStep(i)}
          />
        ))}
      </div>
    </div>
  );
}