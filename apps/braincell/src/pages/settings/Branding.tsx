import { useState, useEffect } from 'react';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { useAuthContext } from '../../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';

export default function SettingsBranding(): JSX.Element {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: tenant, isLoading } = useTenant();

  const [name, setName] = useState('');

  // Preserve other mock fields
  const [legalName, setLegalName] = useState('Demo Restaurant LLC');
  const [color, setColor] = useState('#2e2e30');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || '');
    }
  }, [tenant]);

  const handleDiscard = () => {
    if (tenant) {
      setName(tenant.name || '');
    }
    setDirty(false);
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await updateTenant(
        {
          name,
        },
        token
      );
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save tenant branding settings:', err);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2e2e30] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Brand basics</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Display name</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={name}
              onChange={(e) => (setName(e.target.value), setDirty(true))}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Legal name</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={legalName}
              onChange={(e) => (setLegalName(e.target.value), setDirty(true))}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Primary color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-12 rounded-md border"
                value={color}
                onChange={(e) => (setColor(e.target.value), setDirty(true))}
              />
              <input
                className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
                value={color}
                onChange={(e) => (setColor(e.target.value), setDirty(true))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Theme</label>
            <div className="flex items-center gap-2">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => (setTheme(t), setDirty(true))}
                  className={`rounded-md border px-3 py-1.5 text-[12px] ${
                    theme === t ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-[#e5e5e5] text-slate-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-[#ececec] bg-white/95 p-3 shadow-md backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-800">{saving ? 'Saving…' : 'Unsaved changes'}</div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm" onClick={handleDiscard}>
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