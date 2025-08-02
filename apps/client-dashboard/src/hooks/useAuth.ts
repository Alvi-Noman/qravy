import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export const useAuth = () => {
  const { login: setAuth, logout: clearAuth } = useAuthContext();
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const login = async (
    token: string,
    user: { id: string; email: string; name: string; company: string }
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      setAuth(token, user);
      navigate('/dashboard');
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string) => {
    // No-op for magic link flow
  };

  const logout = () => {
    try {
      clearAuth();
    } catch (err) {
      setError(err as Error);
    }
  };

  return {
    login,
    signup,
    logout,
    isLoading,
    error,
  };
};