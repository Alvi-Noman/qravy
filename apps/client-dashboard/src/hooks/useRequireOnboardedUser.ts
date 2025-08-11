import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

export function useRequireOnboardedUser() {
  const { user, loading } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (!user?.isVerified) {
        navigate('/verify', { replace: true });
      } else if (!user?.isOnboarded) {
        navigate('/create-restaurant', { replace: true });
      }
    }
  }, [user, loading, navigate]);
}