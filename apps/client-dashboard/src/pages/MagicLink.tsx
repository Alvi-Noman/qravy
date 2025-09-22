import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api, { verifyMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import AuthErrorScreen from '../components/AuthErrorScreen';
import { listAccessibleWorkspaces, lookupDeviceAssignment, getOrCreateDeviceKey } from '../api/access';

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

export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { login, reloadUser } = useAuthContext();
  const timeoutRef = useRef<number | null>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const [verifiedUser, setVerifiedUser] = useState<AuthUser | null>(null);

  const { data, isPending, isSuccess, isError } = useQuery<VerifyResponse, Error>({
    queryKey: ['verify-magic-link', token],
    queryFn: () => verifyMagicLink<VerifyResponse>(token),
    enabled: token.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (isSuccess && data?.token && data.user) {
      // Store session; do NOT navigate yet
      login(data.token, data.user);
      setVerifiedUser(data.user);

      // Fast path: if this device is already assigned, auto-join and go to dashboard
      (async () => {
        try {
          const lookup = await lookupDeviceAssignment(getOrCreateDeviceKey());
          if (lookup && 'found' in lookup && lookup.found) {
            const res = await api.post('/api/v1/access/select-tenant', { tenantId: lookup.tenantId });
            const nextToken = res.data?.token as string | undefined;
            if (nextToken) {
              if (lookup.locationId) {
                // Persist current branch for default selection in sidebar
                localStorage.setItem('muv_device_location', lookup.locationId);
                localStorage.setItem('locations:activeId', lookup.locationId);
              }
              await login(nextToken, { ...data.user, tenantId: lookup.tenantId, isOnboarded: true });
              await reloadUser();
              navigate('/dashboard', { replace: true });
              return;
            }
          }

          // Otherwise show workspaces (or fallback to owner create/dashboard)
          const items = await listAccessibleWorkspaces();
          if (!items || items.length === 0) {
            const u = data.user;
            navigate(u.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
          } else {
            setWorkspaces(items);
          }
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
      setJoining(tenantId);
      const res = await api.post('/api/v1/access/select-tenant', { tenantId });
      const nextToken = res.data?.token as string | undefined;
      if (!nextToken || !verifiedUser) throw new Error('Failed to join workspace');

      // Replace token with tenant-bound token and carry user + tenantId
      // Optimistically set isOnboarded true, then refresh from /me
      await login(nextToken, { ...verifiedUser, tenantId, isOnboarded: true });
      await reloadUser();

      navigate('/access/select-location', { replace: true });
    } catch (e) {
      // Fall back to error screen if anything fails
      navigate('/login', { replace: true });
    } finally {
      setJoining(null);
    }
  };

  const status: 'pending' | 'success' | 'error' =
    isPending ? 'pending' : isSuccess ? 'success' : isError ? 'error' : 'pending';

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] font-inter flex items-center justify-center px-4">
      {status === 'pending' && (
        <div className="w-full max-w-lg rounded-2xl border border-[#ececec] bg-white p-6 text-center">
          <div className="text-sm text-slate-700">Verifying…</div>
        </div>
      )}

      {status === 'error' && <AuthErrorScreen />}

      {status === 'success' && (
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

            {workspaces.length === 0 && (
              <div className="text-center text-[13px] text-slate-600">
                No workspaces available for this email.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}