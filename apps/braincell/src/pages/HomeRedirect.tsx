import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

export default function HomeRedirect() {
  const { token, loading } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (token) {
        navigate('/dashboard', { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    }
  }, [token, loading, navigate]);

  return null;
}