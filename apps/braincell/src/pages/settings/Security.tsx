import { useState } from 'react';

type Session = { id: string; device: string; ip: string; lastActive: string; current?: boolean };

export default function SettingsSecurity(): JSX.Element {
  const [require2FA, setRequire2FA] = useState(false);
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState(60);
  const [allowSSO, setAllowSSO] = useState(false);
  const [ssoProvider, setSsoProvider] = useState<'saml' | 'oidc'>('saml');
  const [ssoUrl, setSsoUrl] = useState('');
  const [sessions, setSessions] = useState<Session[]>([
    { id: 's1', device: 'Mac • Safari', ip: '102.87.23.5', lastActive: new Date().toISOString(), current: true },
    { id: 's2', device: 'iPhone • Safari', ip: '10.0.0.24', lastActive: new Date(Date.now() - 3600_000).toISOString() },
  ]);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const revoke = (id: string) => setSessions((xs) => xs.filter((s) => s.id !== id || s.current));

  const save = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Two‑Factor & SSO</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={require2FA}
              onChange={(e) => (setRequire2FA(e.target.checked), setDirty(true))}
            />
            Require 2FA for all members
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowSSO} onChange={(e) => (setAllowSSO(e.target.checked), setDirty(true))} />
            Enable SSO
          </label>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">SSO Provider</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={ssoProvider}
              onChange={(e) => (setSsoProvider(e.target.value as any), setDirty(true))}
            >
              <option value="saml">SAML 2.0</option>
              <option value="oidc">OpenID Connect</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">SSO Login URL / Metadata</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={ssoUrl}
              onChange={(e) => (setSsoUrl(e.target.value), setDirty(true))}
              placeholder="https://idp.example.com/sso/..."
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Session timeout (minutes)</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              type="number"
              value={sessionTimeoutMin}
              onChange={(e) => (setSessionTimeoutMin(Number(e.target.value || 0)), setDirty(true))}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Active sessions</div>
        <ul className="mt-2 divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">{s.device}</div>
                <div className="text-[12px] text-slate-600">
                  {s.ip} • Last active {new Date(s.lastActive).toLocaleString()}
                </div>
              </div>
              {s.current ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Current</span>
              ) : (
                <button
                  onClick={() => revoke(s.id)}
                  className="rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                >
                  Revoke
                </button>
              )}
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