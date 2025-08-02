import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { verifyMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';

export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { login } = useAuthContext();
  const fetched = useRef(false);
  const timeoutRef = useRef<number | null>(null); // Use number for browser

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token || fetched.current) {
      return;
    }
    fetched.current = true;
    setStatus('pending');
    verifyMagicLink(token)
      .then((data) => {
        login(data.token, data.user);
        setStatus('success');
        setMessage('You are now logged in!');
        timeoutRef.current = window.setTimeout(() => {
          if (!data.user.name || !data.user.company) {
            navigate('/complete-profile');
          } else {
            navigate('/dashboard');
          }
        }, 1500);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(
          err?.response?.data?.message ||
          'Magic link verification failed. Please try again or request a new link.'
        );
      });

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [searchParams, login, navigate]);

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