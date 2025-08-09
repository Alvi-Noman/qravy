// pages/restaurant/steps/StepLocation.tsx
import { useState } from 'react';

type StepProps = {
  onNext: () => void;
  onBack?: () => void;
};

export default function StepLocation({ onNext, onBack }: StepProps) {
  const [location, setLocation] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // TODO: Save location info
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow w-96">
      <h2 className="text-xl font-bold mb-4">Restaurant Location</h2>
      <input
        className="border p-2 w-full mb-4"
        placeholder="Enter your restaurant location"
        value={location}
        onChange={e => setLocation(e.target.value)}
        required
      />
      <div className="flex justify-between">
        {onBack && (
          <button type="button" onClick={onBack} className="bg-gray-300 text-black p-2 rounded">Back</button>
        )}
        <button type="submit" className="bg-blue-500 text-white p-2 rounded">Next</button>
      </div>
    </form>
  );
}