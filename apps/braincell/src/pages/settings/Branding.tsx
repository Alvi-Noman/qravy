import { useState, useEffect, useRef } from 'react';
import { toastError, toastSuccess } from '../../components/Toaster';
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
      <LogoCard
        logoUrl={tenant?.logoUrl ?? null}
        name={tenant?.name || ''}
        token={token as string}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['tenant', token] })}
      />

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

const API_BASE = (import.meta.env.VITE_API_URL as string) || '';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** The restaurant's logo: guests see it (with the name) on the AI waiter's start screen. Saved as soon as it's
 *  uploaded — the same image upload as menu photos. */
function LogoCard({
  logoUrl,
  name,
  token,
  onSaved,
}: {
  logoUrl: string | null;
  name: string;
  token: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);

  const upload = async (file: File) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) return toastError('Use a PNG, JPG, WebP or SVG image');
    if (file.size > MAX_LOGO_BYTES) return toastError('The logo must be under 5 MB');
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch(`${API_BASE}/api/uploads/images`, {
        method: 'POST',
        body: fd,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Upload failed');
      const url: string = data?.cdn?.original || data?.cdn?.medium || data?.url || data?.location || '';
      if (!url) throw new Error('Upload failed');
      await updateTenant({ logoUrl: url }, token);
      await onSaved();
      toastSuccess('Logo saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || e?.message || 'Could not save the logo');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await updateTenant({ logoUrl: null }, token);
      await onSaved();
      toastSuccess('Logo removed');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not remove the logo');
    } finally {
      setBusy(null);
    }
  };

  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Logo</div>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Guests see it with your name on the AI waiter's start screen. A square image works best — at least 512 × 512
        px, PNG or SVG with a transparent background.
      </p>
      <div className="mt-4 flex items-center gap-4">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[22px] border border-[#ececec] bg-[#FFF5F7]">
          {logoUrl ? (
            <img src={logoUrl} alt={`${name} logo`} className="h-full w-full object-contain" />
          ) : (
            <span className="text-2xl font-semibold text-[#FA2851]">{initials}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-md bg-[#2e2e30] px-3 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {busy === 'upload' ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          </button>
          {logoUrl && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void remove()}
              className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
