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
  capabilities?: string[];
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  sessionType?: 'member' | 'branch';
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

/** Safely merge an incoming user into previous, preserving capabilities if missing */
function mergeUser(prev: AuthUser | null, incoming?: AuthUser | null): AuthUser | null {
  if (!incoming && !prev) return null;
  if (!incoming) return prev; // nothing to merge
  const capabilities = incoming.capabilities ?? prev?.capabilities;
  // We assert AuthUser because API `incoming` should always include required fields like `id`/`email`
  const merged: AuthUser = {
    ...(prev ?? ({} as AuthUser)),
    ...incoming,
    capabilities,
  } as AuthUser;
  return merged;
}

/** Derive client session shape from a user if possible (before /me returns). */
function sessionFromUser(u?: AuthUser | null): SessionInfo | null {
  if (!u?.sessionType) return null;
  return {
    type: u.sessionType === 'branch' ? 'central' : 'member',
    locationId: null,
  };
}

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
      setUser((prev) => mergeUser(prev, me.user));
      setSession(me.session ?? sessionFromUser(me.user));
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

      if (data.user != null) {
        // Merge provided user (may or may not include capabilities)
        setUser((prev) => mergeUser(prev, data.user));
        // Proactively derive a session from user in case /me isn't called or fails
        setSession((prev) => prev ?? sessionFromUser(data.user));

        // Optionally pull latest session/profile if we have a token
        if (newToken) {
          try {
            const me = await getMe<MeResponse>(newToken);
            setUser((prev) => mergeUser(prev, me.user));
            setSession(me.session ?? sessionFromUser(me.user));
          } catch {
            // keep any derived session if we had one
          }
        } else {
          // no token -> clear session
          setSession(null);
        }
      } else if (newToken) {
        // Fallback: fetch user + session with new token
        try {
          const me = await getMe<MeResponse>(newToken);
          setUser((prev) => mergeUser(prev, me.user));
          setSession(me.session ?? sessionFromUser(me.user));
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
      // Seed session immediately from user while /me loads
      setSession(sessionFromUser(usr));
      // session will be finalized on next getMe/refresh
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
