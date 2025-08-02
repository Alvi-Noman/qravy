import { Link } from 'react-router-dom';
import { useState } from 'react';
import { sendMagicLink } from '../api/auth';

export default function Login() {
  const [showEmail, setShowEmail] = useState(false);

  if (showEmail) {
    return <EmailEntry onBack={() => setShowEmail(false)} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <img src="/logo.svg" alt="Logo" className="mx-auto mb-6" style={{ width: 48, height: 48 }} />
        <h2 className="text-2xl font-bold mb-6">Log in to Linear</h2>
        <button className="w-full bg-blue-600 text-white p-2 rounded-md font-semibold mb-4" disabled>
          Continue with Google
        </button>
        <button
          className="w-full border p-2 rounded-md font-semibold mb-4"
          onClick={() => setShowEmail(true)}
        >
          Continue with email
        </button>
        <button className="w-full border p-2 rounded-md font-semibold mb-4" disabled>
          Continue with Facebook
        </button>
        <p className="text-xs text-gray-500 mb-4"></p>
        <p>
          Don’t have an account? <Link to="/signup" className="text-blue-500 hover:underline">Sign up</Link> or <a href="#" className="text-blue-500 hover:underline">Learn more</a>
        </p>
      </div>
    </div>
  );
}

function EmailEntry({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err) {
      setError('Failed to send magic link. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
          <img src="/logo.svg" alt="Logo" className="mx-auto mb-6" style={{ width: 48, height: 48 }} />
          <h2 className="text-2xl font-bold mb-4">Check your email</h2>
          <p className="mb-2">We've sent you a temporary login link.<br />Please check your inbox at</p>
          <p className="font-semibold">{email}</p>
          <button
            className="w-full text-gray-500 underline mt-6"
            onClick={onBack}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <img src="/logo.svg" alt="Logo" className="mx-auto mb-6" style={{ width: 48, height: 48 }} />
        <h2 className="text-2xl font-bold mb-6">What's your email address?</h2>
        <form onSubmit={handleSend}>
          <input
            type="email"
            placeholder="Enter your email address..."
            className="mt-1 p-2 w-full border rounded-md mb-4"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={isLoading}
          />
          {error && <div className="text-red-500 mb-2" aria-live="polite">{error}</div>}
          <button
            type="submit"
            className="w-full bg-blue-500 text-white p-2 rounded-md font-semibold mb-4"
            disabled={isLoading}
          >
            {isLoading ? 'Sending...' : 'Continue with email'}
          </button>
        </form>
        <button
          className="w-full text-gray-500 underline"
          onClick={onBack}
          disabled={isLoading}
        >
          Back
        </button>
      </div>
    </div>
  );
}