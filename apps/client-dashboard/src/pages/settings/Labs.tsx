import { useState } from 'react';

export default function SettingsLabs(): JSX.Element {
  const [newMenuEditor, setNewMenuEditor] = useState(true);
  const [realtimeWaiterCalls, setRealtimeWaiterCalls] = useState(false);
  const [aiMenuSuggestions, setAiMenuSuggestions] = useState(false);
  const [sandboxMode, setSandboxMode] = useState(false);

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
        <div className="text-[14px] font-semibold text-slate-900">Labs</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newMenuEditor} onChange={(e) => (setNewMenuEditor(e.target.checked), setDirty(true))} /> New Menu Editor
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={realtimeWaiterCalls}
              onChange={(e) => (setRealtimeWaiterCalls(e.target.checked), setDirty(true))}
            />
            Realtime Waiter Calls
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aiMenuSuggestions} onChange={(e) => (setAiMenuSuggestions(e.target.checked), setDirty(true))} /> AI Menu Suggestions
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sandboxMode} onChange={(e) => (setSandboxMode(e.target.checked), setDirty(true))} /> Sandbox Mode
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