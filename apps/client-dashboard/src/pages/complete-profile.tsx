import { useForm } from 'react-hook-form';
import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function CompleteProfile() {
  const { user, token, login } = useAuthContext();
  const { register, handleSubmit, formState: { errors } } = useForm<{ name: string; company: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
    }
  }, [token, navigate]);

  // React Query mutation for profile update
  const mutation = useMutation({
    mutationFn: async (data: { name: string; company: string }) => {
      // Update profile
      const res1 = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res1.ok) throw new Error('Profile update failed.');

      // Fetch updated user info
      const res2 = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });
      if (!res2.ok) throw new Error('Failed to fetch updated user info.');
      return res2.json();
    },
    onSuccess: (updated) => {
      if (updated.user && updated.user.name && updated.user.company) {
        login(token!, updated.user);
        navigate('/dashboard');
      } else {
        setError('Profile update failed.');
      }
    },
    onError: (err: Error) => {
      setError(err.message || 'An error occurred. Please try again.');
    },
  });

  // Helper to show user-friendly error messages
  const getErrorMessage = () => {
    if (!error) return '';
    if (error === 'Profile update failed.') return 'Could not update your profile. Please check your info and try again.';
    if (error === 'Failed to fetch updated user info.') return 'Could not load your updated profile. Please try again.';
    if (error.includes('429')) return 'Too many requests. Please wait and try again.';
    if (error.includes('Network Error')) return 'Network error. Please check your connection.';
    return error;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Complete your profile</h2>
        <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Full Name"
              className="mt-1 p-2 w-full border rounded-md"
              {...register('name', { required: 'Full name is required' })}
              disabled={mutation.isPending}
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
          </div>
          <div className="mb-6">
            <input
              type="text"
              placeholder="Company Name"
              className="mt-1 p-2 w-full border rounded-md"
              {...register('company', { required: 'Company name is required' })}
              disabled={mutation.isPending}
            />
            {errors.company && <p className="text-red-500 text-sm mt-1">{errors.company.message}</p>}
          </div>
          {error && <div className="text-red-500 text-sm mb-4">{getErrorMessage()}</div>}
          <button
            type="submit"
            className="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving...' : 'Save & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}