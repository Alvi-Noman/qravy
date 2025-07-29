import { useAuthContext } from '../context/AuthContext';
import { useLogin, useSignup } from '../api/auth';
import { useNavigate } from 'react-router-dom';

export const useAuth = () => {
  const { login: setAuth, logout: clearAuth } = useAuthContext();
  const loginMutation = useLogin();
  const signupMutation = useSignup();
  const navigate = useNavigate();

  const login = async (email: string, password: string) => {
    await loginMutation.mutateAsync({ email, password }, {
      onSuccess: (response) => {
        setAuth(response.token, response.user);
        navigate('/dashboard');
      },
      onError: () => {},
    });
  };

  const signup = async (email: string, password: string, name: string) => {
    await signupMutation.mutateAsync({ email, password, name }, {
      onSuccess: (response) => {
        setAuth(response.token, response.user);
        navigate('/dashboard');
      },
      onError: () => {},
    });
  };

  const logout = () => {
    localStorage.removeItem('token');
    clearAuth();
  };

  return {
    login,
    signup,
    logout,
    isLoading: loginMutation.isPending || signupMutation.isPending,
    error: loginMutation.error || signupMutation.error,
  };
};