// MagicLink.tsx
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { verifyMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import AuthErrorScreen from '../components/AuthErrorScreen';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || '';

type AuthUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  tenantId?: string | null;
  isOnboarded?: boolean;
};

type VerifyResponse = {
  token: string;
  user: AuthUser;
};

type Workspace = { id: string; name: string };
type DeviceLookup =
  | { found: false }
  | { found: true; tenantId: string; locationId: string | null; locationName: string | null };

export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { login, reloadUser } = useAuthContext();
  const timeoutRef = useRef<number | null>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const [verifiedUser, setVerifiedUser] = useState<AuthUser | null>(null);
  const [verifiedToken, setVerifiedToken] = useState<string>('');
  const [hardError, setHardError] = useState<boolean>(false);

  // 1) Try the normal magic-link verify first
  const { data, isPending, isSuccess, isError } = useQuery<VerifyResponse, Error>({
    queryKey: ['verify-magic-link', token],
    queryFn: () => verifyMagicLink<VerifyResponse>(token),
    enabled: token.length > 0,
    retry: false,
  });

  // Shared post-login flow (used by both magic-link and admin-invite)
  const runPostLogin = async (accessToken: string, user: AuthUser) => {
    try {
      // Device lookup (auto-select tenant if the device already belongs to one)
      const lookupRes = await fetch(`${API_BASE_URL}/api/v1/access/devices/lookup`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });

      if (lookupRes.ok) {
        const lookup: DeviceLookup = await lookupRes.json();
        if (lookup && 'found' in lookup && lookup.found) {
          const sel = await fetch(`${API_BASE_URL}/api/v1/access/select-tenant`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            credentials: 'include',
            body: JSON.stringify({ tenantId: lookup.tenantId }),
          });
          if (sel.ok) {
            const selJson = await sel.json();
            const nextToken = selJson?.token as string | undefined;
            if (nextToken) {
              await login(nextToken, { ...user, tenantId: lookup.tenantId, isOnboarded: true });
              await reloadUser();
              navigate('/dashboard', { replace: true });
              return;
            }
          }
        }
      }

      // Otherwise show workspaces (for central email users), or route by tenantId
      const wsRes = await fetch(`${API_BASE_URL}/api/v1/access/workspaces`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });

      if (wsRes.ok) {
        const wsJson = await wsRes.json();
        const items: Workspace[] = wsJson?.items || [];
        if (items.length > 0) {
          setWorkspaces(items);
          return;
        }
      }

      // Default: if user has tenantId go dashboard, else onboarding
      navigate(user.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
    } catch {
      navigate(user.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
    }
  };

  // 2) Handle success of normal magic-link
  useEffect(() => {
    if (isSuccess && data?.token && data.user) {
      setVerifiedToken(data.token);
      setVerifiedUser(data.user);
      login(data.token, data.user);
      runPostLogin(data.token, data.user);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data]);

  // 3) Fallback: if magic-link verify fails, try admin invite confirm
  useEffect(() => {
    const runFallback = async () => {
      if (!token || !isError) return;

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/v1/access/confirm-invite?inviteToken=${encodeURIComponent(token)}`,
          { method: 'GET', credentials: 'include' }
        );

        if (!res.ok) {
          setHardError(true);
          return;
        }

        const json = await res.json();
        const accessToken = json?.token as string | undefined;
        const user = json?.user as AuthUser | undefined;

        if (!accessToken || !user) {
          setHardError(true);
          return;
        }

        setVerifiedToken(accessToken);
        setVerifiedUser(user);
        await login(accessToken, user);
        await runPostLogin(accessToken, user);
      } catch {
        setHardError(true);
      }
    };

    runFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, token]);

  const onJoin = async (tenantId: string) => {
    try {
      if (!verifiedUser || !verifiedToken) return;
      setJoining(tenantId);

      const sel = await fetch(`${API_BASE_URL}/api/v1/access/select-tenant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${verifiedToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({ tenantId }),
      });
      if (!sel.ok) throw new Error('Failed to join workspace');

      const selJson = await sel.json();
      const nextToken = selJson?.token as string | undefined;
      if (!nextToken) throw new Error('No token returned');

      await login(nextToken, { ...verifiedUser, tenantId, isOnboarded: true });
      await reloadUser();

      navigate('/access/select-location', { replace: true });
    } catch {
      setJoining(null);
    } finally {
      setJoining(null);
    }
  };

  const status: 'pending' | 'success' | 'error' =
    isPending ? 'pending' : isSuccess ? 'success' : hardError ? 'error' : 'pending';

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] font-inter flex items-center justify-center px-4">
      {status === 'error' && <AuthErrorScreen />}

      {status === 'success' && workspaces.length > 0 && (
        <div className="w-full max-w-lg rounded-2xl border border-[#ececec] bg-white p-6 shadow">
          <h1 className="text-center text-[18px] font-semibold text-slate-900">
            You have access to these workspaces
          </h1>

          <div className="mt-6 space-y-4">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="rounded-lg border border-[#e5e5e5] bg-white p-4 shadow-sm flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-slate-800 text-white grid place-items-center text-[12px] font-semibold">
                    {ws.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[14px] font-medium text-slate-900">{ws.name}</div>
                    <div className="text-[12px] text-slate-500">1 member</div>
                  </div>
                </div>
                <button
                  onClick={() => onJoin(ws.id)}
                  disabled={joining === ws.id}
                  className="rounded-md border border-[#e2e2e2] px-3 py-1.5 text-[12px] hover:bg-slate-50 disabled:opacity-60"
                >
                  {joining === ws.id ? 'Joining…' : 'Join'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
