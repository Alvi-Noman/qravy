import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { attachAuthInterceptor, getMe, refreshToken as apiRefreshToken } from '../api/auth';

export interface AuthUser {
  id: string;
  email: string;
  isVerified?: boolean;
  isOnboarded?: boolean;
  tenantId?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type RefreshResponse = { token?: string | null; user?: AuthUser | null };
type MeResponse = { user: AuthUser };

const TOKEN_KEY = (import.meta.env.VITE_JWT_TOKEN_KEY as string) || 'auth_token';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setTokenState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const setToken = useCallback((tok: string | null) => {
    setTokenState(tok);
    tokenRef.current = tok;
    try {
      if (tok) localStorage.setItem(TOKEN_KEY, tok);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }, []);

  const reloadUser = useCallback(async (): Promise<void> => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const me = await getMe<MeResponse>(t);
      setUser(me.user);
      // 🚨 broadcast user changes (tenant created, onboarding done, etc.)
      try {
        localStorage.setItem('user_updated', Date.now().toString());
      } catch {}
    } catch {}
  }, []);

  const refreshToken = useCallback(async (): Promise<void> => {
    try {
      const data = await apiRefreshToken<RefreshResponse>();
      const newToken = data.token ?? null;
      setToken(newToken);
      if (data.user) {
        setUser(data.user);
        // 🚨 broadcast updated user
        try {
          localStorage.setItem('user_updated', Date.now().toString());
        } catch {}
      } else if (newToken) {
        try {
          const me = await getMe<MeResponse>(newToken);
          setUser(me.user);
          try {
            localStorage.setItem('user_updated', Date.now().toString());
          } catch {}
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
      setLoading(false);
    }
  }, [setToken]);

  const login = useCallback(
    (tok: string, usr: AuthUser): void => {
      setToken(tok);
      setUser(usr);
      try {
        localStorage.setItem('login', Date.now().toString());
        // 🚨 also trigger user_updated right away
        localStorage.setItem('user_updated', Date.now().toString());
      } catch {}
    },
    [setToken]
  );

  const logout = useCallback(async (): Promise<void> => {
    setToken(null);
    setUser(null);
    try {
      await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {}
    try {
      localStorage.setItem('logout', Date.now().toString());
    } catch {}
  }, [setToken]);

  useEffect(() => {
    attachAuthInterceptor(
      () => tokenRef.current ?? localStorage.getItem(TOKEN_KEY),
      refreshToken,
      logout
    );
    refreshToken();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'logout') {
        setToken(null);
        setUser(null);
      }
      if (e.key === 'login') {
        window.location.reload();
      }
      if (e.key === 'user_updated') {
        // 🚨 re-fetch latest user in other tabs
        reloadUser();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshToken, logout, reloadUser]);

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