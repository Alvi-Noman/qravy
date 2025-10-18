import { useState } from 'react';

type ApiKey = { id: string; label: string; prefix: string; createdAt: string; lastUsed?: string | null; secret?: string | null };
type Wh = { id: string; url: string; secret: string; events: string[] };

export default function SettingsDeveloper(): JSX.Element {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([
    { id: 'key_1', label: 'Production key', prefix: 'sk_live_f4a9', createdAt: new Date().toISOString(), lastUsed: null },
  ]);
  const [webhooks, setWebhooks] = useState<Wh[]>([
    { id: 'wh_1', url: 'https://example.com/webhooks/app', secret: 'whsec_****abcd', events: ['order.created'] },
  ]);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const createApiKey = () => {
    const id = 'key_' + (apiKeys.length + 1);
    const pref = 'sk_live_' + Math.random().toString(36).slice(2, 6);
    const secret = pref + Math.random().toString(36).slice(2);
    setApiKeys((arr) => [{ id, label: 'New key', prefix: pref, createdAt: new Date().toISOString(), secret }, ...arr]);
    setDirty(true);
  };

  const rotateApiKey = (id: string) => {
    const pref = 'sk_live_' + Math.random().toString(36).slice(2, 6);
    const secret = pref + Math.random().toString(36).slice(2);
    setApiKeys((arr) => arr.map((k) => (k.id === id ? { ...k, prefix: pref, secret } : k)));
    setDirty(true);
  };

  const revokeApiKey = (id: string) => {
    setApiKeys((arr) => arr.filter((k) => k.id !== id));
    setDirty(true);
  };

  const addWebhook = () => {
    const id = 'wh_' + (webhooks.length + 1);
    setWebhooks((arr) => [{ id, url: 'https://example.com/webhooks/new', secret: 'whsec_****' + Math.random().toString(36).slice(2, 5), events: [] }, ...arr]);
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
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-slate-900">API Keys</div>
          <button
            onClick={createApiKey}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            New key
          </button>
        </div>
        <ul className="mt-3 divide-y divide-slate-100">
          {apiKeys.map((k) => (
            <li key={k.id} className="grid gap-2 py-2 sm:grid-cols-12 sm:items-center">
              <div className="sm:col-span-4">
                <div className="text-[13px] font-medium text-slate-900">{k.label}</div>
                <div className="text-[12px] text-slate-600">{new Date(k.createdAt).toLocaleString()}</div>
              </div>
              <div className="sm:col-span-4">
                <code className="rounded bg-slate-100 px-2 py-1 text-[12px] text-slate-800">{k.prefix}••••••••</code>
                {k.secret ? (
                  <div className="mt-1 text-[12px] text-emerald-700">New secret generated — copy now</div>
                ) : null}
              </div>
              <div className="flex gap-2 sm:col-span-4 sm:justify-end">
                <button
                  onClick={() => rotateApiKey(k.id)}
                  className="rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                >
                  Rotate
                </button>
                <button
                  onClick={() => revokeApiKey(k.id)}
                  className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[12px] text-red-700 hover:bg-red-50"
                >
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-slate-900">Webhooks</div>
          <button
            onClick={addWebhook}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            Add endpoint
          </button>
        </div>
        <ul className="mt-3 divide-y divide-slate-100">
          {webhooks.map((w, idx) => (
            <li key={w.id} className="grid gap-2 py-2 sm:grid-cols-12 sm:items-center">
              <div className="sm:col-span-6">
                <div className="grid gap-1.5">
                  <label className="text-[12px] font-medium text-slate-700">Endpoint URL #{idx + 1}</label>
                  <input
                    className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
                    value={w.url}
                    onChange={(e) => {
                      const v = e.target.value;
                      setWebhooks((arr) => arr.map((x) => (x.id === w.id ? { ...x, url: v } : x)));
                      setDirty(true);
                    }}
                  />
                </div>
              </div>
              <div className="sm:col-span-3">
                <div className="grid gap-1.5">
                  <label className="text-[12px] font-medium text-slate-700">Secret</label>
                  <input
                    className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
                    value={w.secret}
                    onChange={(e) => {
                      const v = e.target.value;
                      setWebhooks((arr) => arr.map((x) => (x.id === w.id ? { ...x, secret: v } : x)));
                      setDirty(true);
                    }}
                  />
                </div>
              </div>
              <div className="sm:col-span-3">
                <div className="grid gap-1.5">
                  <label className="text-[12px] font-medium text-slate-700">Events</label>
                  <select className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm" defaultValue="custom" onChange={() => {}}>
                    <option value="custom">{w.events.length} selected</option>
                  </select>
                  <div className="text-[12px] text-slate-500">(multi-select omitted)</div>
                </div>
              </div>
              <div className="sm:col-span-12">
                <button
                  onClick={async () => {
                    await new Promise((r) => setTimeout(r, 600));
                  }}
                  className="rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                >
                  Send test event
                </button>
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