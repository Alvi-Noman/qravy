import { useState } from 'react';

export default function SettingsDomain(): JSX.Element {
  const [subdomain, setSubdomain] = useState('demo');
  const [apex, setApex] = useState('demo.example.com');
  const [enforceHttps, setEnforceHttps] = useState(true);
  const [visibility, setVisibility] = useState<'live' | 'offline'>('live');
  const [dns, setDns] = useState<'unknown' | 'checking' | 'valid' | 'invalid'>('unknown');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const verify = async () => {
    setDns('checking');
    await new Promise((r) => setTimeout(r, 800));
    setDns(Math.random() > 0.35 ? 'valid' : 'invalid');
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
        <div className="text-[14px] font-semibold text-slate-900">Custom domain</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Subdomain</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={subdomain}
              onChange={(e) => (setSubdomain(e.target.value), setDirty(true))}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Apex / Target</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={apex}
              onChange={(e) => (setApex(e.target.value), setDirty(true))}
            />
            <div className="text-[12px] text-slate-500">Point CNAME to cname.qravy.app</div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={enforceHttps}
              onChange={(e) => (setEnforceHttps(e.target.checked), setDirty(true))}
            />
            Enforce HTTPS
          </label>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Menu visibility</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={visibility}
              onChange={(e) => (setVisibility(e.target.value as any), setDirty(true))}
            >
              <option value="live">Live (public)</option>
              <option value="offline">Offline (hidden)</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={verify}
            className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px]"
          >
            Verify DNS
          </button>
          <span className="text-sm">
            {dns === 'unknown' && <span className="text-slate-600">Unknown</span>}
            {dns === 'checking' && <span className="text-slate-800">Checking…</span>}
            {dns === 'valid' && <span className="text-emerald-700">Valid</span>}
            {dns === 'invalid' && <span className="text-red-700">Invalid</span>}
          </span>
        </div>
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