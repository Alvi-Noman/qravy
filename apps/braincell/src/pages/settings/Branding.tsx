// apps/braincell/src/pages/settings/Branding.tsx — Settings → Organization & Branding: how the restaurant looks to guests.
// Its name, its logo (the AI waiter's start screen, link previews) and its browser-tab icon (favicon). The AI waiter's
// own name, voice and answers are under Settings → AI Waiter.
import { useState, useEffect, useRef, type ReactNode } from 'react';
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tenant) setName(tenant.name || '');
  }, [tenant]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tenant', token] });

  const save = async () => {
    if (!token || !name.trim()) return;
    setSaving(true);
    try {
      await updateTenant({ name: name.trim() }, token);
      await refresh();
      setDirty(false);
      toastSuccess('Name saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the name');
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

  const shownName = name.trim() || tenant?.name || 'Your restaurant';
  const logoBg = tenant?.logoBackground === 'black' ? 'black' : 'white';
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Restaurant name</div>
        <p className="mt-0.5 text-[12px] text-slate-500">How guests see you: the AI waiter’s greeting, your site’s browser tab and shared links.</p>
        <input
          className="mt-3 w-full max-w-md rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
          value={name}
          maxLength={100}
          onChange={(e) => (setName(e.target.value), setDirty(true))}
          aria-label="Restaurant name"
        />
      </div>

      <ImageCard
        field="logoUrl"
        title="Logo"
        help="Guests see it with your name on the AI waiter’s start screen, and in previews when your link is shared on WhatsApp or Facebook. A square image works best — at least 512 × 512 px, PNG or SVG with a transparent background."
        url={tenant?.logoUrl ?? null}
        name={shownName}
        token={token as string}
        onSaved={refresh}
        preview={(src) =>
          src ? <img src={src} alt="" className="h-full w-full object-contain p-2" /> : <Initials name={shownName} dark={logoBg === 'black'} />
        }
        previewClassName={logoBg === 'black' ? 'bg-black' : 'bg-[#FFF5F7]'}
        extra={<LogoBackground value={logoBg} token={token as string} onSaved={refresh} />}
      />

      <ImageCard
        field="faviconUrl"
        title="Browser tab icon (favicon)"
        help="The small icon in the browser tab and bookmarks on your site. Without one, your logo is used. A simple square image works best — at least 64 × 64 px (PNG); fine detail won’t show at this size."
        url={tenant?.faviconUrl ?? null}
        name={shownName}
        token={token as string}
        onSaved={refresh}
        preview={(src) => <TabPreview icon={src || tenant?.logoUrl || '/qravy-icon.png'} name={shownName} />}
        wide
      />

      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-[#ececec] bg-white/95 p-3 shadow-md backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-800">{saving ? 'Saving…' : 'Unsaved changes'}</div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm"
                onClick={() => (setName(tenant?.name || ''), setDirty(false))}
              >
                Discard
              </button>
              <button disabled={saving || !name.trim()} onClick={save} className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-60">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Initials({ name, dark = false }: { name: string; dark?: boolean }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return <span className={'text-2xl font-semibold ' + (dark ? 'text-white' : 'text-[#FA2851]')}>{initials}</span>;
}

/** What the guest's browser tab looks like. */
function TabPreview({ icon, name }: { icon: string; name: string }) {
  return (
    <div className="w-full rounded-t-lg bg-[#dee1e6] px-2 pt-2" aria-label="Browser tab preview">
      <div className="flex w-56 max-w-full items-center gap-2 rounded-t-lg bg-white px-3 py-2 shadow-sm">
        <img src={icon} alt="" className="h-4 w-4 shrink-0 object-contain" />
        <span className="truncate text-[12px] text-slate-800">{name} · Order online</span>
        <span className="ml-auto text-[12px] text-slate-400">×</span>
      </div>
    </div>
  );
}

const API_BASE = (import.meta.env.VITE_API_URL as string) || '';
const MAX_BYTES = 5 * 1024 * 1024;

/** An image of the restaurant's (logo, favicon): saved as soon as it's uploaded — the same upload as menu photos. */
function ImageCard({
  field,
  title,
  help,
  url,
  name,
  token,
  onSaved,
  preview,
  wide = false,
  previewClassName = 'bg-[#FFF5F7]',
  extra,
}: {
  field: 'logoUrl' | 'faviconUrl';
  title: string;
  help: string;
  url: string | null;
  name: string;
  token: string;
  onSaved: () => Promise<unknown> | void;
  preview: (src: string | null) => ReactNode;
  wide?: boolean;
  /** the preview tile's background (the logo: white or black) */
  previewClassName?: string;
  extra?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const what = field === 'logoUrl' ? 'logo' : 'icon';

  const upload = async (file: File) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(file.type)) return toastError('Use a PNG, JPG, WebP, SVG or ICO image');
    if (file.size > MAX_BYTES) return toastError('The image must be under 5 MB');
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
      const src: string = data?.cdn?.original || data?.cdn?.medium || data?.url || data?.location || '';
      if (!src) throw new Error('Upload failed');
      await updateTenant({ [field]: src }, token);
      await onSaved();
      toastSuccess(`${what === 'logo' ? 'Logo' : 'Icon'} saved`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || e?.message || `Could not save the ${what}`);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await updateTenant({ [field]: null }, token);
      await onSaved();
      toastSuccess(`${what === 'logo' ? 'Logo' : 'Icon'} removed`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || `Could not remove the ${what}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">{title}</div>
      <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">{help}</p>
      <div className={`mt-4 flex flex-wrap items-center gap-4 ${wide ? '' : ''}`}>
        <div
          className={
            wide
              ? 'w-full max-w-sm overflow-hidden rounded-lg border border-[#ececec]'
              : `grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[22px] border border-[#ececec] ${previewClassName}`
          }
        >
          {preview(url)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
            className="hidden"
            aria-label={`Upload ${what} for ${name}`}
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
            {busy === 'upload' ? 'Uploading…' : url ? `Replace ${what}` : `Upload ${what}`}
          </button>
          {url && (
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
      {extra}
    </div>
  );
}

/** The tile behind the logo on the AI waiter's start screen: white (default) or black (for a white or light logo). */
function LogoBackground({ value, token, onSaved }: { value: 'white' | 'black'; token: string; onSaved: () => Promise<unknown> | void }) {
  const [saving, setSaving] = useState<'white' | 'black' | null>(null);
  const choose = async (v: 'white' | 'black') => {
    if (v === value || saving) return;
    setSaving(v);
    try {
      await updateTenant({ logoBackground: v }, token);
      await onSaved();
      toastSuccess(v === 'black' ? 'Logo background: black' : 'Logo background: white');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the background');
    } finally {
      setSaving(null);
    }
  };
  const active = saving ?? value;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="text-[12px] font-medium text-slate-700">Background behind the logo</span>
      <div role="radiogroup" aria-label="Logo background" className="inline-flex rounded-lg border border-[#e2e2e2] bg-slate-50 p-1">
        {(['white', 'black'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active === v}
            onClick={() => choose(v)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] ${active === v ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            <span className={`h-3 w-3 rounded-sm border border-slate-300 ${v === 'black' ? 'bg-black' : 'bg-white'}`} />
            {v === 'white' ? 'White' : 'Black'}
          </button>
        ))}
      </div>
      <span className="text-[12px] text-slate-500">Pick black if your logo is white or very light.</span>
    </div>
  );
}
