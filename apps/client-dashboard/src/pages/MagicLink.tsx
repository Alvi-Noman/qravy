import { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { verifyMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import AuthSuccessScreen from '../components/AuthSuccessScreen';
import AuthErrorScreen from '../components/AuthErrorScreen';

type AuthUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  isOnboarded?: boolean;
};

type VerifyResponse = {
  token: string;
  user: AuthUser;
};

/**
 * Page component for verifying a magic login link.
 * Displays success, error, or pending state.
 */
export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { login } = useAuthContext();
  const timeoutRef = useRef<number | null>(null);

  const { data, isPending, isSuccess, isError } = useQuery<VerifyResponse, Error>({
    queryKey: ['verify-magic-link', token],
    queryFn: () => verifyMagicLink<VerifyResponse>(token),
    enabled: token.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (isSuccess && data?.token && data.user) {
      login(data.token, data.user);
      timeoutRef.current = window.setTimeout(() => {
        navigate(data.user.isOnboarded ? '/dashboard' : '/create-restaurant');
      }, 1500);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isSuccess, data, login, navigate]);

  const status: 'pending' | 'success' | 'error' =
    isPending ? 'pending' : isSuccess ? 'success' : isError ? 'error' : 'pending';

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] font-inter">
      {status === 'success' && <AuthSuccessScreen />}
      {status === 'error' && <AuthErrorScreen />}
      {/* pending renders nothing */}
    </div>
  );
}
