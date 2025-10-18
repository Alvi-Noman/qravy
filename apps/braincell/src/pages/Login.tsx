// apps/braincell/src/pages/Login.tsx
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '../components/Logo';

export default function Login() {
  const { token, user, loading } = useAuthContext();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);

  // 🚨 Redirect if already authenticated
  useEffect(() => {
    if (!loading && token && user) {
      if (!user.tenantId) {
        navigate('/create-restaurant', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [token, user, loading, navigate]);

  // 🚨 Watch for cross-tab login events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'login' && e.newValue && user) {
        if (!user.tenantId) {
          navigate('/create-restaurant', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [navigate, user]);

  // 🚨 If logged in, don't render login UI at all
  if (!loading && token && user) {
    return null; // Just let useEffect redirect
  }

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] flex flex-col font-inter">
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-60">
        <Logo />
        <AnimatePresence mode="wait">
          {!showEmail ? (
            <motion.div
              key="login"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center"
            >
              <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">Log in to Qravy</h2>
              <button
                className="w-96 h-12 bg-[#635bff] text-white rounded-md font-medium mb-4 transition font-inter"
                disabled
              >
                Continue with Google
              </button>
              <button
                className="w-96 h-12 bg-white border border-[#cecece] text-[#2e2e30] rounded-md font-medium mb-4 transition hover:bg-[#f5f5f5] font-inter"
                onClick={() => setShowEmail(true)}
              >
                Continue with email
              </button>
              <button
                className="w-96 h-12 bg-white border border-[#cecece] text-[#2e2e30] rounded-md font-medium mb-4 transition hover:bg-[#f5f5f5] font-inter"
                disabled
              >
                Continue with Facebook
              </button>
              <p className="text-sm text-[#5b5b5d] mt-4 font-normal font-inter">
                Don&apos;t have an account?{' '}
                <Link to="/signup" className="text-[#2e2f30] hover:underline">Sign up</Link> or{' '}
                <a href="#" className="text-[#2e2f30] hover:underline">Learn more</a>
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="email"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center"
            >
              <EmailEntry onBack={() => setShowEmail(false)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmailEntry({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation<void, Error, string>({
    mutationFn: (email: string) => sendMagicLink(email),
    onSuccess: () => setSent(true),
  });

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const getErrorMessage = (): string => {
    if (localError) return localError;
    if (!mutation.error) return '';

    const msg = mutation.error.message || 'Something went wrong. Please try again.';
    if (msg.includes('Invalid email address') || msg.includes('Validation failed')) {
      return 'Please enter a valid email address.';
    }
    if (msg.includes('429')) return 'Too many requests. Please wait and try again.';
    if (msg.includes('Network Error')) return 'Network error. Please check your connection.';
    return 'Something went wrong. Please try again.';
  };

  const handleSend = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim()) {
      setLocalError('Please enter your email address.');
      return;
    }
    if (!isValidEmail(email)) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    mutation.mutate(email);
  };

  if (sent) {
    return (
      <div className="w-full flex flex-col items-center font-inter">
        <h2 className="text-xl font-medium mb-4 text-[#2e2e30]">Check your email</h2>
        <p className="mb-2 text-[#5b5b5d] text-base font-normal text-center">
          We&apos;ve sent you a temporary login link.<br />Please check your inbox at
        </p>
        <p className="font-medium text-[#2e2e30] w-96 break-words text-center">{email}</p>
        <button
          className="w-96 h-12 text-sm text-[#5b5b5d] underline mt-6 font-normal"
          onClick={onBack}
        >
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center font-inter">
      <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">What&apos;s your email address?</h2>
      <form onSubmit={handleSend} noValidate className="w-full flex flex-col items-center">
        <input
          type="email"
          placeholder="Enter your email address..."
          className="p-3 w-96 border border-[#cecece] hover:border-[#b0b0b5] rounded-md mb-4 text-[#2e2e30] bg-transparent focus:outline-none text-base font-normal"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEmail(e.target.value);
            setLocalError(null);
          }}
          required
          disabled={mutation.isPending}
        />
        {(localError || mutation.isError) && (
          <div className="text-red-500 -mt-3 mb-4 text-sm w-96 font-normal text-left" aria-live="polite">
            {getErrorMessage()}
          </div>
        )}
        <button
          type="submit"
          className={`w-96 h-12 rounded-md font-medium mb-4 transition border text-center
            ${mutation.isPending
              ? 'bg-[#fefefe] border-[#cecece] text-[#b0b0b5] cursor-not-allowed'
              : 'bg-white border-[#cecece] text-[#2e2e30] hover:bg-[#f5f5f5]'
            }
          `}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Sending...' : 'Continue with email'}
        </button>
      </form>
      <button
        className="mt-2 text-sm text-[#2e2e30] hover:underline font-normal"
        onClick={onBack}
        disabled={mutation.isPending}
      >
        Back to login
      </button>
    </div>
  );
}
