// pages/restaurant/steps/StepWelcome.tsx
type StepProps = {
  onNext: () => void;
};

export default function StepWelcome({ onNext }: StepProps) {
  return (
    <div className="bg-white p-8 rounded shadow w-96">
      <h2 className="text-xl font-bold mb-4">Welcome!</h2>
      <p className="mb-6">Let&apos;s get your restaurant set up.</p>
      <button onClick={onNext} className="w-full bg-blue-500 text-white p-2 rounded">Next</button>
    </div>
  );
}