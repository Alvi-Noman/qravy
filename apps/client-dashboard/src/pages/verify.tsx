import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Query function for verifying email
async function verifyEmail(token: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Verification failed.');
  }
  return res.json();
}

export default function Verify() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // React Query for verifying the email
  const { data, error, isPending, isSuccess, isError } = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => verifyEmail(token!),
    enabled: !!token,
    retry: false,
  });

  // Helper to show user-friendly error messages
  const getErrorMessage = () => {
    if (!error) return '';
    const msg = (error as Error).message || '';
    if (msg.includes('Verification failed')) return 'Verification failed. Please check your link or request a new verification email.';
    if (msg.includes('429')) return 'Too many requests. Please wait and try again.';
    if (msg.includes('Network Error')) return 'Network error. Please check your connection.';
    return msg || 'Could not verify your email. Please try again.';
  };

  let status: 'pending' | 'success' | 'error' = 'pending';
  let message = '';
  if (isPending) {
    status = 'pending';
  } else if (isSuccess) {
    status = 'success';
    message = 'Your email has been verified! You can now log in.';
  } else if (isError) {
    status = 'error';
    message = getErrorMessage();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        {status === 'pending' && <div className="text-xl font-bold" aria-live="polite">Verifying...</div>}
        {status === 'success' && (
          <div aria-live="polite">
            <div className="text-green-600 text-xl font-bold mb-4">{message}</div>
            <Link to="/login" className="text-blue-500 hover:underline">Go to Login</Link>
          </div>
        )}
        {status === 'error' && (
          <div aria-live="polite">
            <div className="text-red-600 text-xl font-bold mb-4">{message}</div>
            <Link to="/signup" className="text-blue-500 hover:underline">Sign up again</Link>
          </div>
        )}
      </div>
    </div>
  );
}