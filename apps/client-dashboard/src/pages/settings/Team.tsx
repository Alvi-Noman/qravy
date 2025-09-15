import { useState } from 'react';

type Member = { id: string; email: string; role: 'owner' | 'admin' | 'staff'; status: 'active' | 'invited' };

export default function SettingsTeam(): JSX.Element {
  const [team, setTeam] = useState<Member[]>([
    { id: 'u1', email: 'owner@demo.example', role: 'owner', status: 'active' },
    { id: 'u2', email: 'chef@demo.example', role: 'staff', status: 'active' },
  ]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const invite = () => {
    if (!inviteEmail) return;
    setTeam((t) => [{ id: 'u' + (t.length + 1), email: inviteEmail, role: 'staff', status: 'invited' }, ...t]);
    setInviteEmail('');
    setDirty(true);
  };

  const updateRole = (id: string, role: Member['role']) => {
    setTeam((t) => t.map((m) => (m.id === id ? { ...m, role } : m)));
    setDirty(true);
  };

  const remove = (id: string) => {
    setTeam((t) => t.filter((m) => m.id !== id));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Members</div>
        <div className="mb-3 mt-3 grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="text-[12px] font-medium text-slate-700">Invite by email</label>
            <input
              className="mt-1 w-full rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="newuser@demo.example"
            />
          </div>
          <div className="flex items-end">
            <button onClick={invite} className="rounded-md border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Send Invite
            </button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {team.map((m) => (
            <li key={m.id} className="grid gap-2 py-2 sm:grid-cols-12 sm:items-center">
              <div className="sm:col-span-5">
                <div className="text-sm font-medium text-slate-900">{m.email}</div>
                <div className="text-[12px] text-slate-600">{m.status === 'active' ? 'Active' : 'Invited'}</div>
              </div>
              <div className="sm:col-span-4">
                <select
                  className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
                  value={m.role}
                  onChange={(e) => updateRole(m.id, e.target.value as any)}
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </div>
              <div className="sm:col-span-3 sm:text-right">
                {m.role === 'owner' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Primary</span>
                ) : (
                  <button onClick={() => remove(m.id)} className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[12px] text-red-700 hover:bg-red-50">
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-[#ececec] bg-white/95 p-3 shadow-md backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-800">{saving ? 'Saving…' : 'Unsaved changes'}</div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm" onClick={() => setDirty(false)}>
                Discard
              </button>
              <button disabled={saving} onClick={save} className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}