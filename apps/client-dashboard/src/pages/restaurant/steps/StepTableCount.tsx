// pages/restaurant/steps/StepTableCount.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

type StepProps = {
  onBack?: () => void;
};

export default function StepTableCount({ onBack }: StepProps) {
  const [tableCount, setTableCount] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // TODO: Save table count info
    navigate('/dashboard');
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow w-96">
      <h2 className="text-xl font-bold mb-4">Number of Tables</h2>
      <input
        className="border p-2 w-full mb-4"
        type="number"
        min="1"
        placeholder="Enter number of tables"
        value={tableCount}
        onChange={e => setTableCount(e.target.value)}
        required
      />
      <div className="flex justify-between">
        {onBack && (
          <button type="button" onClick={onBack} className="bg-gray-300 text-black p-2 rounded">Back</button>
        )}
        <button type="submit" className="bg-blue-500 text-white p-2 rounded">Finish</button>
      </div>
    </form>
  );
}