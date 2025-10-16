import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/auth';
import axios from 'axios';

type VerifyResult = { ok: true };

async function verifyEmail(token: string): Promise<VerifyResult> {
  try {
    // withCredentials is already true on `api`; params avoids manual encoding
    await api.get('/api/v1/auth/verify-email', { params: { token } });
    return { ok: true };
  } catch (err) {
    // Normalize error message for the UI
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const msg =
        (err.response?.data as { message?: string } | undefined)?.message ||
        err.message ||
        'Verification failed';
      // bubble status code text for your getErrorMessage() matcher
      throw new Error(status ? `${status} ${msg}` : msg);
    }
    throw new Error(err instanceof Error ? err.message : 'Verification failed');
  }
}

export default function Verify() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const { error, isPending, isSuccess, isError } = useQuery<VerifyResult, Error>({
    queryKey: ['verify-email', token],
    queryFn: () => verifyEmail(token),
    enabled: token.length > 0,
    retry: false,
  });

  const getErrorMessage = (): string => {
    if (!error) return '';
    const msg = error.message || '';
    if (msg.toLowerCase().includes('verification failed')) {
      return 'Verification failed. Please check your link or request a new verification email.';
    }
    if (msg.includes('429')) return 'Too many requests. Please wait and try again.';
    if (msg.includes('Network Error') || msg.includes('Failed to fetch')) {
      return 'Network error. Please check your connection.';
    }
    return msg || 'Could not verify your email. Please try again.';
  };

  const status: 'pending' | 'success' | 'error' =
    isPending ? 'pending' : isSuccess ? 'success' : isError ? 'error' : 'pending';

  const message =
    status === 'success'
      ? 'Your email has been verified! You can now log in.'
      : status === 'error'
      ? getErrorMessage()
      : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        {status === 'pending' && (
          <div className="text-xl font-bold" aria-live="polite">
            Verifying...
          </div>
        )}
        {status === 'success' && (
          <div aria-live="polite">
            <div className="text-green-600 text-xl font-bold mb-4">{message}</div>
            <Link to="/login" className="text-blue-500 hover:underline">
              Go to Login
            </Link>
          </div>
        )}
        {status === 'error' && (
          <div aria-live="polite">
            <div className="text-red-600 text-xl font-bold mb-4">{message}</div>
            <Link to="/signup" className="text-blue-500 hover:underline">
              Sign up again
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
