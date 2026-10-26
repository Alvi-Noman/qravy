import { useEffect, useMemo, useState } from 'react';
import {
  inviteAdmin as apiInviteAdmin,
  resendInvite as apiResendInvite,
  revokeAdmin as apiRevokeAdmin,
  // ⬇️ add this in your access api if not present:
  // export async function listAdmins(): Promise<Member[]>
  listAdmins as apiListAdmins,
} from '../../api/access';
import { useLocations } from '../../components/locations/useLocations';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../../api/auth';
import { useAuthContext } from '../../context/AuthContext';

/**
 * Admin-only Team Settings
 * - Single authority role: "admin" (plus the immutable tenant "owner").
 * - Email-based invites: Admin access across all branches — or, with two or more branches, "<branch> only": that
 *   branch's orders, table calls and menu switches, nothing else (a branch login; see middleware/auth lockedBranch).
 * - Server-driven state: fetch on mount and after mutations.
 */

export type Member = {
  id: string;
  email: string;
  role: 'owner' | 'admin';
  status: 'active' | 'invited';
  branchId?: string | null;
  branchName?: string | null;
};

export default function SettingsAdminAccess(): JSX.Element {
  const [team, setTeam] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBranch, setInviteBranch] = useState(''); // '' → every branch
  const { locations } = useLocations();
  const branches = useMemo(() => locations.filter((l) => !l.disabled), [locations]);
  const multiBranch = branches.length >= 2;
  const [confirm, setConfirm] = useState<{ id: string; email: string } | null>(null);

  const owner = useMemo(() => team.find((m) => m.role === 'owner'), [team]);

  // opened from Cortex (Qravy support access): the server refuses team changes — only the restaurant's owner adds people
  const { token } = useAuthContext();
  const me = useQuery({
    queryKey: ['me-support', !!token],
    queryFn: () => getMe<{ support?: { by: string; until: string } }>(token ?? undefined),
    enabled: !!token,
    staleTime: 60_000,
  });
  const supportSession = !!me.data?.support;

  const toast = (text: string) => {
    setMessage(text);
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setMessage(null), text.length > 40 ? 6000 : 2400);
  };

  // the server's reason (e.g. "Not available during Qravy support access…"), not just "failed"
  const why = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiListAdmins(); // must return Member[]
      setTeam(Array.isArray(data) ? data : []);
    } catch (e) {
      // Keep any existing state so UI isn't empty if a transient error occurs.
      toast('Could not load team. Pull to refresh or try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invite = async () => {
    const mail = inviteEmail.trim();
    if (!mail) return;
    if (!validateEmail(mail)) return toast('Enter a valid email');
    if (team.some((m) => m.email.toLowerCase() === mail.toLowerCase())) {
      return toast('This email is already on your team');
    }

    // optimistic row
    const tempId = `tmp-${Date.now()}`;
    const branch = branches.find((b) => b.id === inviteBranch);
    const optimistic: Member = {
      id: tempId,
      email: mail,
      role: 'admin',
      status: 'invited',
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
    };
    setTeam((t) => [optimistic, ...t]);

    try {
      await apiInviteAdmin(mail, branch?.id ?? null);
      toast(branch ? `Invite sent — ${branch.name} only` : 'Admin invite sent');
      // Revalidate to get canonical id/status from server
      await load();
      setInviteEmail('');
    } catch (e) {
      // rollback
      setTeam((t) => t.filter((m) => m.id !== tempId));
      toast(why(e, 'Failed to send invite'));
    }
  };

  const resendInvite = async (id: string) => {
    const m = team.find((u) => u.id === id);
    if (!m) return;
    try {
      await apiResendInvite(m.email);
      toast(`Invite re-sent to ${m.email}`);
    } catch (e) {
      toast(why(e, 'Failed to resend invite'));
    }
  };

  const revokeAdmin = (id: string) => {
    const m = team.find((u) => u.id === id);
    if (!m || m.role === 'owner') return;
    setConfirm({ id, email: m.email });
  };

  const confirmRevoke = async () => {
    if (!confirm) return;
    const { id, email } = confirm;

    // optimistic remove
    const prev = team;
    setTeam((t) => t.filter((u) => u.id !== id));

    try {
      await apiRevokeAdmin(email);
      toast('Admin access revoked');
      await load(); // ensure server truth
    } catch (e) {
      setTeam(prev); // rollback
      toast(why(e, 'Failed to revoke admin'));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <div className="w-full">
      <div className="w-full border-b border-[#ededed] bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="px-6 py-4">
          <h1 className="text-[18px] font-semibold text-slate-900">Admin Access</h1>
          <p className="mt-0.5 max-w-prose text-[13px] leading-5 text-slate-600">
            <span className="font-medium text-slate-900">Admin</span> controls everything across all branches just like
            the Owner, except billing. <br />
            The <span className="font-medium">Owner</span> is permanent and cannot be removed.
          </p>
        </div>
      </div>

      <div className="w-full px-6 py-5">
        {supportSession && (
          <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            You opened this dashboard with Qravy support access. Adding or removing admins isn&apos;t possible here — the
            restaurant&apos;s owner does it from their own login.
          </p>
        )}
        <section className="w-full rounded-xl border border-[#ececec] bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
            <div className="md:col-span-5">
              <label htmlFor="invite" className="text-[12px] font-medium text-slate-700">
                Invite Admin by email
              </label>
              <div className="mt-1 flex w-full gap-2">
                {multiBranch && (
                  <select
                    value={inviteBranch}
                    onChange={(e) => setInviteBranch(e.target.value)}
                    aria-label="Which branches"
                    className="shrink-0 rounded-lg border border-[#e2e2e2] bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">All branches (Admin)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} only
                      </option>
                    ))}
                  </select>
                )}
                <input
                  id="invite"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="name@restaurant.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') invite();
                  }}
                  className="min-w-0 grow rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
                <button
                  onClick={invite}
                  disabled={loading || supportSession}
                  className="shrink-0 rounded-lg bg-[#2e2e30] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 active:opacity-90 disabled:opacity-60"
                  aria-label="Send Admin invite"
                >
                  Send Invite
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {inviteBranch ? (
                  <>
                    They&apos;ll see and run <span className="font-medium text-slate-800">only this branch</span>: its
                    orders (dine-in and online), table calls and menu switches — no settings.
                  </>
                ) : (
                  <>
                    This invite grants <span className="font-medium text-slate-800">Admin</span> access to the entire
                    restaurant.
                  </>
                )}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 w-full overflow-hidden rounded-xl border border-[#ececec] bg-white shadow-sm">
          <div className="px-4 py-3">
            <div className="text-[13px] font-semibold text-slate-900">Members</div>
            <p className="text-[12px] text-slate-600">Owner and Admins for this restaurant tenant</p>
          </div>

          <div className="hidden w-full border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] font-medium text-slate-600 sm:grid sm:grid-cols-12">
            <div className="sm:col-span-6">Email</div>
            <div className="sm:col-span-3">Role</div>
            <div className="sm:col-span-3 text-right">Actions</div>
          </div>

          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-slate-600">Loading members…</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {team.map((m) => (
                <li key={m.id} className="grid gap-3 px-4 py-3 sm:grid-cols-12 sm:items-center">
                  <div className="sm:col-span-6">
                    <div className="text-sm font-medium text-slate-900">{m.email}</div>
                    <div className="text-[12px] text-slate-600">{m.status === 'active' ? 'Active' : 'Invited'}</div>
                  </div>
                  <div className="sm:col-span-3">
                    {m.role === 'owner' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                        Owner (Primary)
                      </span>
                    ) : m.branchId ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900"
                        title="Sees and runs this branch only"
                      >
                        <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {m.branchName ?? 'One branch'} only
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-medium text-slate-900">
                        <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-black/70" />
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="sm:col-span-3 sm:text-right">
                    {m.role === 'owner' ? (
                      <span className="text-[11px] text-slate-500">Immutable</span>
                    ) : m.status === 'invited' ? (
                      <div className="flex gap-2 sm:justify-end">
                        <button
                          onClick={() => resendInvite(m.id)}
                          className="rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] text-slate-800 transition hover:bg-slate-50"
                        >
                          Resend Invite
                        </button>
                        <button
                          onClick={() => revokeAdmin(m.id)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[12px] text-red-700 transition hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => revokeAdmin(m.id)}
                        className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[12px] text-red-700 transition hover:bg-red-50"
                      >
                        Revoke Admin
                      </button>
                    )}
                  </div>
                </li>
              ))}

              {team.length === 0 && (
                <li className="px-4 py-10">
                  <div className="text-center">
                    <div className="mx-auto h-10 w-10 rounded-full border border-dashed border-slate-300" />
                    <h3 className="mt-3 text-sm font-medium text-slate-900">No Admins yet</h3>
                    <p className="mx-auto mt-1 max-w-xs text-[12px] text-slate-600">
                      Invite a user above. They’ll receive an email and get{' '}
                      <span className="font-medium">Admin</span> access to your entire tenant.
                    </p>
                  </div>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[#ececec] bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[15px] font-semibold text-slate-900">Revoke Admin access?</h2>
            <p className="mt-1 text-[13px] text-slate-600">
              {confirm.email} will immediately lose access to all branches, menus, and settings.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm transition hover:bg-slate-50"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50"
                onClick={confirmRevoke}
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="max-w-[90vw] rounded-2xl border border-[#e8e8e8] bg-white px-4 py-2 text-center text-[12px] text-slate-900 shadow-sm sm:max-w-md">
            {message}
          </div>
        </div>
      )}
    </div>
  );
}
