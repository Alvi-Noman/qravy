import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import {
  attachAuthInterceptor,
  getMe,
  refreshToken as apiRefreshToken,
} from '../api/auth';

export interface AuthUser {
  id: string;
  email: string;
  isVerified?: boolean;
  isOnboarded?: boolean;
  tenantId?: string | null;
}

export type SessionInfo = {
  type: 'central' | 'member';
  locationId?: string | null;
};

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  session: SessionInfo | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type RefreshResponse = { token?: string | null; user?: AuthUser | null };
type MeResponse = { user: AuthUser; session?: SessionInfo | null };

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const setToken = useCallback((tok: string | null) => {
    setTokenState(tok);
    tokenRef.current = tok;
  }, []);

  /** Reload user from API using current token */
  const reloadUser = useCallback(async (): Promise<void> => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const me = await getMe<MeResponse>(t);
      setUser(me.user);
      setSession(me.session ?? null);
    } catch {
      setUser(null);
      setSession(null);
    }
  }, []);

  /** Attempt to refresh token and fetch user */
  const refreshToken = useCallback(async (): Promise<void> => {
    try {
      const data = await apiRefreshToken<RefreshResponse>();
      const newToken = data.token ?? null;
      setToken(newToken);

      if (data.user) {
        setUser(data.user);
        // fetch session details
        if (newToken) {
          try {
            const me = await getMe<MeResponse>(newToken);
            setUser(me.user);
            setSession(me.session ?? null);
          } catch {
            setSession(null);
          }
        } else {
          setSession(null);
        }
      } else if (newToken) {
        // fallback: fetch user + session with new token
        try {
          const me = await getMe<MeResponse>(newToken);
          setUser(me.user);
          setSession(me.session ?? null);
        } catch {
          setUser(null);
          setSession(null);
        }
      } else {
        setUser(null);
        setSession(null);
      }
    } catch {
      setToken(null);
      setUser(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [setToken]);

  /** Complete login (persist token + user in memory) */
  const login = useCallback(
    (tok: string, usr: AuthUser): void => {
      setToken(tok);
      setUser(usr);
      // session will be populated on next getMe/refresh
    },
    [setToken]
  );

  /** Logout and clear */
  const logout = useCallback(async (): Promise<void> => {
    setToken(null);
    setUser(null);
    setSession(null);
    try {
      await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/logout`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );
    } catch {}
  }, [setToken]);

  useEffect(() => {
    attachAuthInterceptor(
      () => tokenRef.current,
      refreshToken,
      logout
    );

    // Initial attempt to refresh on mount
    refreshToken();
  }, [refreshToken, logout]);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, session, login, logout, refreshToken, reloadUser }}
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