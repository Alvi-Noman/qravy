import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { attachAuthInterceptor, getMe, refreshToken as apiRefreshToken } from '../api/auth';
import { AuthUser } from '../types';

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// List of public routes that should NOT trigger refreshToken on mount
const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/magic-link',
  '/verify',
];

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isRefreshing = useRef(false);
  const location = useLocation();

  const refreshToken = async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;
    try {
      const data = await apiRefreshToken();
      setToken(data.token);
      if (data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          isOnboarded: data.user.isOnboarded,
          isVerified: data.user.isVerified,
        });
      } else if (data.token) {
        try {
          const me = await getMe(data.token);
          setUser({
            id: me.user.id,
            email: me.user.email,
            isOnboarded: me.user.isOnboarded,
            isVerified: me.user.isVerified,
          });
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      isRefreshing.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    attachAuthInterceptor(
      () => token,
      refreshToken,
      logout
    );

    // Only call refreshToken on mount if NOT on a public route
    if (!PUBLIC_ROUTES.some(route => location.pathname.startsWith(route))) {
      refreshToken();
    } else {
      setLoading(false); // Not loading if on a public page
    }

    // Tab sync for login/logout
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'logout') {
        setToken(null);
        setUser(null);
      }
      if (e.key === 'login') {
        window.location.reload();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
    // eslint-disable-next-line
  }, [location.pathname]);

  const login = (token: string, user: AuthUser) => {
    setToken(token);
    setUser(user);
    localStorage.setItem('login', Date.now().toString());
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    localStorage.setItem('logout', Date.now().toString());
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};