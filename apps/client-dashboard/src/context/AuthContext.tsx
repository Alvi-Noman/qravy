/**
 * Auth context for user + token state and auth actions.
 * - Persists token in localStorage
 * - Uses a ref-backed getter for the interceptor (no stale closure)
 * - Handles refresh flow on app start
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
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
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Response shapes from the API
type RefreshResponse = {
  token?: string | null;
  user?: AuthUser | null;
};
type MeResponse = { user: AuthUser };

const TOKEN_KEY = (import.meta.env.VITE_JWT_TOKEN_KEY as string) || 'auth_token';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Initialize from localStorage so we have a token on first paint if present
  const [token, setTokenState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep a ref so interceptor getter always has the latest value
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
    } catch {
      /* ignore storage failures in dev */
    }
  }, []);

  const reloadUser = useCallback(async (): Promise<void> => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const me = await getMe<MeResponse>(t);
      setUser(me.user);
    } catch {
      // ignore
    }
  }, []);

  const refreshToken = useCallback(async (): Promise<void> => {
    try {
      const data = await apiRefreshToken<RefreshResponse>();
      const newToken = data.token ?? null;
      setToken(newToken);

      if (data.user) {
        setUser(data.user);
      } else if (newToken) {
        try {
          const me = await getMe<MeResponse>(newToken);
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
      setLoading(false);
    }
  }, [setToken]);

  const login = useCallback(
    (tok: string, usr: AuthUser): void => {
      setToken(tok); // persist + ref update
      setUser(usr);
      // tab sync ping
      try {
        localStorage.setItem('login', Date.now().toString());
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
    } catch {
      // ignore network errors on logout
    }
    try {
      localStorage.setItem('logout', Date.now().toString());
    } catch {}
  }, [setToken]);

  // Attach interceptors once, with a stable token getter
  useEffect(() => {
    attachAuthInterceptor(
      () => tokenRef.current ?? localStorage.getItem(TOKEN_KEY),
      refreshToken,
      logout
    );
    // Attempt refresh on app boot (populate token/user if cookie exists)
    refreshToken();

    // Tab sync for login/logout
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'logout') {
        setToken(null);
        setUser(null);
      }
      if (e.key === 'login') {
        // Another tab logged in; reload to pick up state
        window.location.reload();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, logout, refreshToken, reloadUser }}
    >
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