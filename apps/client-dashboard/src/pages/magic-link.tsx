import { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { verifyMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';

export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { login } = useAuthContext();
  const timeoutRef = useRef<number | null>(null);

  // React Query for verifying the magic link
  const { data, error, isPending, isSuccess, isError } = useQuery({
    queryKey: ['verify-magic-link', token],
    queryFn: () => verifyMagicLink(token!),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    // Only log in if both token and user are present (i.e., magic link is valid)
    if (isSuccess && data && data.token && data.user) {
      login(data.token, data.user);
      timeoutRef.current = window.setTimeout(() => {
        if (!data.user.name || !data.user.company) {
          navigate('/complete-profile');
        } else {
          navigate('/dashboard');
        }
      }, 1500);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isSuccess, data, login, navigate]);

  // Helper to show user-friendly error messages
  const getErrorMessage = () => {
    if (!error) return '';
    const msg =
      (error as any)?.response?.data?.message ||
      (error as Error).message ||
      '';
    if (msg.includes('expired magic link')) return 'Your magic link has expired. Please request a new one.';
    if (msg.includes('Invalid magic link')) return 'The magic link is invalid. Please check your email or request a new link.';
    if (msg.includes('429')) return 'Too many requests. Please wait and try again.';
    if (msg.includes('Network Error')) return 'Network error. Please check your connection.';
    return 'Could not verify your magic link. Please try again.';
  };

  let status: 'pending' | 'success' | 'error' = 'pending';
  let message = '';
  if (isPending) {
    status = 'pending';
  } else if (isSuccess) {
    status = 'success';
    message = 'You are now logged in!';
  } else if (isError) {
    status = 'error';
    message = getErrorMessage();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        {status === 'pending' && (
          <div className="flex flex-col items-center justify-center">
            <svg className="animate-spin h-8 w-8 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
            </svg>
            <div className="text-xl font-bold">Loading...</div>
          </div>
        )}
        {status === 'success' && <div className="text-green-600 text-xl font-bold mb-4">{message}</div>}
        {status === 'error' && <div className="text-red-600 text-xl font-bold mb-4">{message}</div>}
      </div>
    </div>
  );
}