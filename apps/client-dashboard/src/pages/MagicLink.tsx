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

  const { data, isPending, isSuccess, isError } = useQuery<VerifyResponse, Error>({
    queryKey: ['verify-magic-link', token],
    queryFn: () => verifyMagicLink<VerifyResponse>(token),
    enabled: token.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (isSuccess && data?.token && data.user) {
      setVerifiedToken(data.token);
      setVerifiedUser(data.user);
      login(data.token, data.user);

      (async () => {
        try {
          const lookupRes = await fetch(`${API_BASE_URL}/api/v1/access/devices/lookup`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${data.token}` },
            credentials: 'include',
          });
          if (lookupRes.ok) {
            const lookup: DeviceLookup = await lookupRes.json();
            if (lookup && 'found' in lookup && lookup.found) {
              const sel = await fetch(`${API_BASE_URL}/api/v1/access/select-tenant`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${data.token}`,
                },
                credentials: 'include',
                body: JSON.stringify({ tenantId: lookup.tenantId }),
              });
              if (sel.ok) {
                const selJson = await sel.json();
                const nextToken = selJson?.token as string | undefined;
                if (nextToken) {
                  await login(nextToken, { ...data.user, tenantId: lookup.tenantId, isOnboarded: true });
                  await reloadUser();
                  navigate('/dashboard', { replace: true });
                  return;
                }
              }
            }
          }

          const wsRes = await fetch(`${API_BASE_URL}/api/v1/access/workspaces`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${data.token}` },
            credentials: 'include',
          });
          if (!wsRes.ok) throw new Error('workspaces failed');
          const wsJson = await wsRes.json();
          const items: Workspace[] = wsJson?.items || [];

          if (items.length > 0) {
            setWorkspaces(items);
            return;
          }

          const u = data.user;
          navigate(u.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
        } catch {
          const u = data.user;
          navigate(u.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
        }
      })();
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isSuccess, data, login, reloadUser, navigate]);

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
    isPending ? 'pending' : isSuccess ? 'success' : isError ? 'error' : 'pending';

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
