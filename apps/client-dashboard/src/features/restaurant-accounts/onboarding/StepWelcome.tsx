import React from 'react';

export default function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="w-full flex flex-col items-center">
      {/* Brand icon at the top */}
      <img
        src="/qravy-icon-200X200.png"
        alt="Qravy"
        className="h-16 w-16 mb-6"
        loading="eager"
        decoding="async"
      />

      <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">Welcome to Qravy</h2>
      <p className="w-full text-sm text-[#5b5b5d] text-center mt-3 mb-8">
        Let’s set up your restaurant in a few quick steps. You can change these anytime.
      </p>

      <button
        type="button"
        onClick={onNext}
        className="w-full h-12 rounded-md font-medium transition border text-center bg-[#2e2e30] border-[#2e2e30] text-white hover:bg-[#262629]"
      >
        Get started
      </button>
    </div>
  );
}