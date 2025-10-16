import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

type User = { id: string; email: string; name: string; company: string };

/**
 * Custom hook for handling user authentication.
 * Provides login, signup (no-op), and logout functions.
 */
export const useAuth = () => {
  const { login: setAuth, logout: clearAuth } = useAuthContext();
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Log in a user by setting auth context and redirecting.
   * @param token - Access token
   * @param user - User object
   */
  const login = async (token: string, user: User): Promise<void> => {
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

  /**
   * Signup no-op for magic link flow.
   */
  const signup = async (): Promise<void> => {
    // intentionally empty
  };

  /**
   * Log out a user by clearing auth context.
   */
  const logout = (): void => {
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
