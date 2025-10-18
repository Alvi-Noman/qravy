import { useState } from 'react';

export default function SettingsAccessibility(): JSX.Element {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [fontScale, setFontScale] = useState<'100' | '110' | '120' | '130'>('100');
  const [focusOutline, setFocusOutline] = useState(true);

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
        <div className="text-[14px] font-semibold text-slate-900">Preferences</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reduceMotion} onChange={(e) => (setReduceMotion(e.target.checked), setDirty(true))} /> Reduce motion
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={highContrast} onChange={(e) => (setHighContrast(e.target.checked), setDirty(true))} /> High contrast
          </label>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Font scale</label>
            <select className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm" value={fontScale} onChange={(e) => (setFontScale(e.target.value as any), setDirty(true))}>
              <option value="100">100%</option>
              <option value="110">110%</option>
              <option value="120">120%</option>
              <option value="130">130%</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={focusOutline} onChange={(e) => (setFocusOutline(e.target.checked), setDirty(true))} /> Focus outlines
          </label>
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