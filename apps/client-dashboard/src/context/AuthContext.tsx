import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { attachAuthInterceptor, getMe } from '../api/auth';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  company: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Use useRef for isRefreshing to avoid race conditions
  const isRefreshing = useRef(false);

  const refreshToken = async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh-token`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        if (data.user) {
          setUser(data.user);
        } else if (data.token) {
          try {
            const me = await getMe(data.token);
            setUser(me.user);
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } else {
        setToken(null);
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
    refreshToken();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'logout') {
        setToken(null);
        setUser(null);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
    // eslint-disable-next-line
  }, []);

  const login = (token: string, user: AuthUser) => {
    setToken(token);
    setUser(user);
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    await fetch(`${API_BASE_URL}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
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