import { useForm } from 'react-hook-form';
import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function CompleteProfile() {
  const { user, token, login } = useAuthContext();
  const { register, handleSubmit, formState: { errors } } = useForm<{ name: string; company: string }>();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
    }
  }, [token, navigate]);

  const onSubmit = async (data: { name: string; company: string }) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res1 = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });

      if (!res1.ok) {
        throw new Error('Profile update failed.');
      }

      // Fetch updated user info
      const res2 = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!res2.ok) {
        throw new Error('Failed to fetch updated user info.');
      }

      const updated = await res2.json();

      if (updated.user && updated.user.name && updated.user.company) {
        login(token!, updated.user);
        navigate('/dashboard');
      } else {
        setError('Profile update failed. Please try again.');
      }
    } catch (err) {
      setError((err as Error).message || 'An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Complete your profile</h2>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Full Name"
              className="mt-1 p-2 w-full border rounded-md"
              {...register('name', { required: 'Full name is required' })}
              disabled={isSubmitting}
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
          </div>
          <div className="mb-6">
            <input
              type="text"
              placeholder="Company Name"
              className="mt-1 p-2 w-full border rounded-md"
              {...register('company', { required: 'Company name is required' })}
              disabled={isSubmitting}
            />
            {errors.company && <p className="text-red-500 text-sm mt-1">{errors.company.message}</p>}
          </div>
          {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
          <button
            type="submit"
            className="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}