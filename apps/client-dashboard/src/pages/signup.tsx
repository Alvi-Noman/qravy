import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';

export default function Signup() {
  const { token, loading } = useAuthContext();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);

  // Route guard: Redirect if already logged in
  useEffect(() => {
    if (!loading && token) {
      navigate('/dashboard', { replace: true });
    }
  }, [token, loading, navigate]);

  // Listen for login/logout in other tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'login' && e.newValue) {
        navigate('/dashboard', { replace: true });
      }
      if (e.key === 'logout' && e.newValue) {
        // Optionally, you could redirect to login if logged out in another tab
        // navigate('/login', { replace: true });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [navigate]);

  if (showEmail) {
    return <EmailEntry onBack={() => setShowEmail(false)} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <img src="/logo.svg" alt="Logo" className="mx-auto mb-6" style={{ width: 48, height: 48 }} />
        <h2 className="text-2xl font-bold mb-6">Create your workspace</h2>
        <button className="w-full bg-blue-600 text-white p-2 rounded-md font-semibold mb-4" disabled>
          Continue with Google
        </button>
        <button
          className="w-full border p-2 rounded-md font-semibold mb-4"
          onClick={() => setShowEmail(true)}
        >
          Continue with email
        </button>
        <button className="w-full border p-2 rounded-md font-semibold mb-6" disabled>
          Continue with Facebook
        </button>
        <p className="text-xs text-gray-500 mb-4">
          By signing up, you agree to our <a href="#" className="underline">Terms of Service</a> and <a href="#" className="underline">Data Processing Agreement</a>.
        </p>
        <p>
          Already have an account? <Link to="/login" className="text-blue-500 hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}

function EmailEntry({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: (email: string) => sendMagicLink(email),
    onSuccess: () => setSent(true),
  });

  // User-friendly error extraction for Zod/backend errors
  const getErrorMessage = () => {
    if (!mutation.error) return '';
    const err = mutation.error as any;
    const msg =
      err?.response?.data?.errors?.[0]?.message ||
      err?.response?.data?.message ||
      err?.data?.message ||
      err?.message ||
      (typeof err === 'string' ? err : '');

    if (msg.includes('Invalid email address') || msg.includes('Validation failed'))
      return 'Please enter a valid email address.';
    if (msg.includes('429')) return 'Too many requests. Please wait and try again.';
    if (msg.includes('Network Error')) return 'Network error. Please check your connection.';
    return 'Something went wrong. Please try again.';
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(email);
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
        <form onSubmit={handleSend} noValidate>
          <input
            type="email"
            placeholder="Enter your email address..."
            className="mt-1 p-2 w-full border rounded-md mb-4"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={mutation.isPending}
          />
          {mutation.isError && (
            <div className="text-red-500 mb-2" aria-live="polite">
              {getErrorMessage()}
            </div>
          )}
          <button
            type="submit"
            className="w-full bg-blue-500 text-white p-2 rounded-md font-semibold mb-4"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Sending...' : 'Continue with email'}
          </button>
        </form>
        <button
          className="w-full text-gray-500 underline"
          onClick={onBack}
          disabled={mutation.isPending}
        >
          Back
        </button>
      </div>
    </div>
  );
}