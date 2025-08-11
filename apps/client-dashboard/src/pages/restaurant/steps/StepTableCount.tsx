import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeOnboarding } from '../../../api/auth';
import { useAuthContext } from '../../../context/AuthContext';

type StepProps = {
  onBack?: () => void;
};

export default function StepTableCount({ onBack }: StepProps) {
  const [tableCount, setTableCount] = useState('');
  const navigate = useNavigate();
  const { refreshToken } = useAuthContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Optionally: Save table count info to backend here

      // 1. Mark onboarding complete in backend
      await completeOnboarding();

      // 2. Refresh user context (so isOnboarded is true)
      await refreshToken();

      // 3. Redirect to dashboard
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to complete onboarding');
    } finally {
      setLoading(false);
    }
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
        <button
          type="submit"
          className="bg-blue-500 text-white p-2 rounded"
          disabled={loading}
        >
          {loading ? 'Finishing...' : 'Finish'}
        </button>
      </div>
      {error && <div className="text-red-500 mt-2">{error}</div>}
    </form>
  );
}