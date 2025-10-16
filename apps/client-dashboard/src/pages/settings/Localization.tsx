import { useState } from 'react';

export default function SettingsLocalization(): JSX.Element {
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [currency, setCurrency] = useState('INR');
  const [decimal, setDecimal] = useState('.');
  const [thousand, setThousand] = useState(',');
  const [firstDay, setFirstDay] = useState<'monday' | 'sunday'>('monday');
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>('metric');

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
        <div className="text-[14px] font-semibold text-slate-900">Regional settings</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Timezone</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={timezone}
              onChange={(e) => (setTimezone(e.target.value), setDirty(true))}
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">Europe/London (BST)</option>
              <option value="America/New_York">America/New_York (ET)</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Currency</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={currency}
              onChange={(e) => (setCurrency(e.target.value), setDirty(true))}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Unit system</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={unitSystem}
              onChange={(e) => (setUnitSystem(e.target.value as any), setDirty(true))}
            >
              <option value="metric">Metric (kg, cm)</option>
              <option value="imperial">Imperial (lb, in)</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Decimal separator</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={decimal}
              onChange={(e) => (setDecimal(e.target.value), setDirty(true))}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Thousand separator</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={thousand}
              onChange={(e) => (setThousand(e.target.value), setDirty(true))}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Week starts on</label>
            <select
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={firstDay}
              onChange={(e) => (setFirstDay(e.target.value as any), setDirty(true))}
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </select>
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