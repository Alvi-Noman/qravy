import { useState } from 'react';

export default function SettingsNotifications(): JSX.Element {
  const [emailOrders, setEmailOrders] = useState(true);
  const [pushOrders, setPushOrders] = useState(false);
  const [smsOrders, setSmsOrders] = useState(false);
  const [digest, setDigest] = useState<'off' | 'daily' | 'weekly'>('daily');
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setDirty(false);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Orders & Events</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={emailOrders} onChange={(e) => (setEmailOrders(e.target.checked), setDirty(true))} /> Email for new orders
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pushOrders} onChange={(e) => (setPushOrders(e.target.checked), setDirty(true))} /> Push notifications
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={smsOrders} onChange={(e) => (setSmsOrders(e.target.checked), setDirty(true))} /> SMS alerts
          </label>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Digest</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={digest}
              onChange={(e) => (setDigest(e.target.value as any), setDirty(true))}
            >
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Quiet hours start</label>
            <input className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm" type="time" value={quietStart} onChange={(e) => (setQuietStart(e.target.value), setDirty(true))} />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Quiet hours end</label>
            <input className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm" type="time" value={quietEnd} onChange={(e) => (setQuietEnd(e.target.value), setDirty(true))} />
          </div>
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