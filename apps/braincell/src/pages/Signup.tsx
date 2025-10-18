import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '../components/Logo';

export default function Signup() {
  const { token, loading } = useAuthContext();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    if (!loading && token) {
      navigate('/dashboard', { replace: true });
    }
  }, [token, loading, navigate]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'login' && e.newValue) {
        navigate('/dashboard', { replace: true });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [navigate]);

  return (
    <div className="min-h-screen w-full bg-gray-100 flex flex-col font-inter">
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-60">
        <Logo />
        <AnimatePresence mode="wait">
          {!showEmail ? (
            <motion.div
              key="signup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center"
            >
              <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">Create your workspace</h2>
              <button
                className="w-96 h-12 bg-blue-600 text-white rounded-md font-medium mb-4 transition font-inter"
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
                className="w-96 h-12 bg-white border border-[#cecece] text-[#2e2e30] rounded-md font-medium mb-6 transition hover:bg-[#f5f5f5] font-inter"
                disabled
              >
                Continue with Facebook
              </button>
              <p className="w-96 text-center text-sm text-[#5b5b5d] mb-4">
                By signing up, you agree to our{' '}
                <a href="#" className="font-medium underline">Terms of Service</a>.
              </p>
              <p className="text-sm text-[#5b5b5d] font-normal">
                Already have an account?{' '}
                <Link to="/login" className="text-[#2e2f30] hover:underline">Log in</Link>
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
    mutationFn: (value: string) => sendMagicLink(value),
    onSuccess: () => setSent(true),
  });

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const getErrorMessage = (): string => {
    if (localError) return localError;
    if (!mutation.error) return '';
    const msg = mutation.error.message || '';
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
        <p className="mb-2 text-base font-normal text-center text-[#5b5b5d]">
          We&apos;ve sent you a temporary login link.<br />Please check your inbox at
        </p>
        <p className="font-medium text-[#2e2e30] w-96 break-words text-center">{email}</p>
        <button
          className="w-96 h-12 text-sm text-[#5b5b5d] underline mt-6 font-normal"
          onClick={onBack}
        >
          Back
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
        className="w-96 mt-2 text-sm text-[#2e2e30] hover:underline font-normal"
        onClick={onBack}
        disabled={mutation.isPending}
      >
        Back
      </button>
    </div>
  );
}