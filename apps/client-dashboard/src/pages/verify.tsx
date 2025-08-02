import { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function Verify() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const fetched = useRef(false);

  // Reset fetched flag when token changes
  useEffect(() => {
    fetched.current = false;
  }, [searchParams.get('token')]);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token || fetched.current) {
      return;
    }
    fetched.current = true;
    fetch(`${API_BASE_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus('success');
          setMessage('Your email has been verified! You can now log in.');
        } else {
          const data = await res.json();
          setStatus('error');
          setMessage(data.message || 'Verification failed.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Verification failed.');
      });
  }, [searchParams]);

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