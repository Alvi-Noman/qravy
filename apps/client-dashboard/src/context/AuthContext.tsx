/**
 * Auth context for user + token state and auth actions.
 * - Handles refresh flow on app start
 * - Exposes login/logout/refresh/reloadUser
 */
import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { attachAuthInterceptor, getMe, refreshToken as apiRefreshToken } from '../api/auth';

export interface AuthUser {
  id: string;
  email: string;
  isVerified?: boolean;
  isOnboarded?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshToken: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Response shapes from the API
type RefreshResponse = {
  token?: string | null;
  user?: AuthUser | null;
};

type MeResponse = {
  user: AuthUser;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isRefreshing = useRef(false);

  const refreshToken = async (): Promise<void> => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;
    try {
      const data = await apiRefreshToken<RefreshResponse>();
      setToken(data.token ?? null);

      if (data.user) {
        setUser(data.user);
      } else if (data.token) {
        try {
          const me = await getMe<MeResponse>(data.token);
          setUser(me.user);
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

  const reloadUser = async (): Promise<void> => {
    if (!token) return;
    try {
      const me = await getMe<MeResponse>(token);
      setUser(me.user);
    } catch {
      // ignore
    }
  };

  const login = (tok: string, usr: AuthUser): void => {
    setToken(tok);
    setUser(usr);
    localStorage.setItem('login', Date.now().toString());
  };

  const logout = async (): Promise<void> => {
    setToken(null);
    setUser(null);
    await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    localStorage.setItem('logout', Date.now().toString());
  };

  useEffect(() => {
    attachAuthInterceptor(
      () => token,
      refreshToken,
      logout
    );
    // Attempt refresh on app boot
    refreshToken();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshToken, reloadUser }}>
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