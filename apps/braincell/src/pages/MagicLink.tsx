import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api, { verifyMagicLink } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import AuthErrorScreen from '../components/AuthErrorScreen';
import { enterWorkspace, findAccess, viaLabel, type Workspace } from '../features/auth/afterLogin';

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
  const runPostLogin = async (_accessToken: string, user: AuthUser) => {
    const access = await findAccess();
    if (access.kind === 'device') {
      await login(access.token, { ...user, tenantId: access.tenantId, isOnboarded: true });
      await reloadUser();
      navigate('/dashboard', { replace: true });
      return;
    }
    if (access.kind === 'workspaces') {
      // given access to exactly one restaurant and none of their own → straight in (no list to pick from)
      if (access.items.length === 1 && !user.tenantId) {
        try {
          await openWorkspace(access.items[0].id, user);
          return;
        } catch {
          /* show the list instead */
        }
      }
      setWorkspaces(access.items);
      return;
    }
    navigate(user.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
  };

  /** Into a restaurant they have access to (a Restaurant Access login then says which branch it's at). */
  const openWorkspace = async (tenantId: string, user: AuthUser) => {
    const { token: nextToken, next } = await enterWorkspace(tenantId);
    await login(nextToken, { ...user, tenantId, isOnboarded: true });
    await reloadUser();
    navigate(next, { replace: true });
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
        const res = await api.get<{ token?: string; user?: AuthUser }>(
          '/api/v1/access/confirm-invite',
          {
            params: { inviteToken: token },
            withCredentials: true,
          }
        );

        if (res.status !== 200) {
          setHardError(true);
          return;
        }

        const json = res.data;
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
    if (!verifiedUser || !verifiedToken) return;
    setJoining(tenantId);
    try {
      await openWorkspace(tenantId, verifiedUser);
    } catch {
      /* stays on the list; they can try again */
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
            Choose a restaurant
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
                    <div className="text-[12px] text-slate-500">{viaLabel(ws)}</div>
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
