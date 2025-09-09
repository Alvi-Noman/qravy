/**
 * Onboarding step: capture number of tables.
 * - On submit, completes onboarding on the server
 * - Reloads user in AuthContext then navigates to /dashboard
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeOnboarding } from '../../../api/auth';
import { useAuthContext } from '../../../context/AuthContext';

type StepProps = {
  onBack?: () => void;
};

export default function StepTableCount({ onBack }: StepProps) {
  const [tableCount, setTableCount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { reloadUser, token } = useAuthContext();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }
      // TODO: Persist tableCount in your domain service if needed
      await completeOnboarding(token); // explicitly send Authorization header
      await reloadUser();
      navigate('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Failed to complete onboarding.');
    } finally {
      setSubmitting(false);
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
      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
      <div className="flex justify-between">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="bg-gray-300 text-black p-2 rounded"
            disabled={submitting}
          >
            Back
          </button>
        )}
        <button
          type="submit"
          className="bg-blue-500 text-white p-2 rounded"
          disabled={submitting}
        >
          {submitting ? 'Finishing…' : 'Finish'}
        </button>
      </div>
    </form>
  );
}