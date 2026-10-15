// apps/braincell/src/pages/settings/Branding.tsx — Settings → Organization & Branding: how the restaurant looks to guests.
// Its name, its logo (link previews, and the AI waiter's start screen — with or without a shape behind it, its
// corners and size), its browser-tab icon (favicon) and the digits its prices show in. The AI waiter's
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
  const logoBg = tenant?.logoBackground === 'black' || tenant?.logoBackground === 'none' ? tenant.logoBackground : 'white';
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
      />

      <StartScreenLogo
        logoUrl={tenant?.logoUrl ?? null}
        name={shownName}
        saved={{ background: logoBg, radius: tenant?.logoRadius ?? RADIUS, size: tenant?.logoSize ?? SIZE }}
        token={token as string}
        onSaved={refresh}
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

      <PriceDigits value={tenant?.priceDigits === 'bn' ? 'bn' : 'latin'} token={token as string} onSaved={refresh} />

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

// the start screen's defaults (apps/tastebud/src/components/ai-waiter/StartScreen.tsx)
const SIZE = 96;
const RADIUS = 29; // % of the size

type LogoLook = { background: 'white' | 'black' | 'none'; radius: number; size: number };

/** The logo on the AI waiter's start screen: the shape behind it (white, black or none), how round its corners are, its size. */
function StartScreenLogo({
  logoUrl,
  name,
  saved,
  token,
  onSaved,
}: {
  logoUrl: string | null;
  name: string;
  saved: LogoLook;
  token: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const [look, setLook] = useState<LogoLook>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLook(saved), [saved.background, saved.radius, saved.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = look.background !== saved.background || look.radius !== saved.radius || look.size !== saved.size;
  const set = (patch: Partial<LogoLook>) => setLook((l) => ({ ...l, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ logoBackground: look.background, logoRadius: look.radius, logoSize: look.size }, token);
      await onSaved();
      toastSuccess('Start screen logo saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save it');
    } finally {
      setSaving(false);
    }
  };

  const bare = look.background === 'none';
  const px = Math.round((look.size * look.radius) / 100);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '•';
  const shapes = [
    ['white', 'White shape'],
    ['black', 'Black shape'],
    ['none', 'No shape'],
  ] as const;

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Start screen logo</div>
      <p className="mt-0.5 text-[12px] text-slate-500">How your logo sits on the AI waiter’s first screen, above “Get started”.</p>
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="grid content-start gap-4">
          <div>
            <div className="text-[12px] font-medium text-slate-700">Behind the logo</div>
            <div role="radiogroup" aria-label="Behind the logo" className="mt-1.5 inline-flex flex-wrap rounded-lg border border-[#e2e2e2] bg-slate-50 p-1">
              {shapes.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={look.background === v}
                  onClick={() => set({ background: v })}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] ${look.background === v ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`}
                >
                  <span
                    className={`h-3 w-3 rounded-sm border ${v === 'black' ? 'border-slate-300 bg-black' : v === 'white' ? 'border-slate-300 bg-white' : 'border-dashed border-slate-400'}`}
                  />
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-slate-500">
              {bare ? 'Your logo alone, in its own shape — best for a logo with a transparent background.' : 'Pick black if your logo is white or very light.'}
            </p>
          </div>
          <label className="grid gap-1">
            <span className="flex justify-between text-[12px] font-medium text-slate-700">
              {bare ? 'Logo corners' : 'Shape corners'}
              <span className="font-normal text-slate-500">{look.radius === 0 ? 'Square' : look.radius >= 50 ? 'Circle' : `${look.radius}%`}</span>
            </span>
            <input type="range" min={0} max={50} value={look.radius} onChange={(e) => set({ radius: Number(e.target.value) })} aria-label="Corner roundness" />
          </label>
          <label className="grid gap-1">
            <span className="flex justify-between text-[12px] font-medium text-slate-700">
              Size
              <span className="font-normal text-slate-500">{look.size}px</span>
            </span>
            <input type="range" min={56} max={200} step={4} value={look.size} onChange={(e) => set({ size: Number(e.target.value) })} aria-label="Logo size" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!dirty || saving} onClick={save} className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {dirty && (
              <button type="button" onClick={() => setLook(saved)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={() => setLook({ background: 'white', radius: RADIUS, size: SIZE })}
              className="ml-auto text-[12px] text-slate-500 underline-offset-2 hover:underline"
            >
              Back to default
            </button>
          </div>
        </div>

        {/* what guests see */}
        <div className="flex h-[360px] flex-col items-center overflow-hidden rounded-[28px] border-[6px] border-slate-900 bg-gradient-to-b from-[#FFF1F4] via-white to-white px-4">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            {bare && logoUrl ? (
              <img src={logoUrl} alt="" style={{ height: look.size, width: 'auto', maxWidth: 220, objectFit: 'contain', borderRadius: px }} />
            ) : (
              <div
                className={
                  'grid place-items-center overflow-hidden ' +
                  (bare
                    ? 'bg-[#FA2851]/10'
                    : look.background === 'black'
                      ? 'bg-black shadow-[0_12px_32px_rgba(0,0,0,0.28)]'
                      : 'bg-white shadow-[0_12px_32px_rgba(250,40,81,0.14)] ring-1 ring-black/[0.04]')
                }
                style={{ width: look.size, height: look.size, borderRadius: px }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-full w-full object-contain" style={{ padding: Math.round(look.size * (0.083 + look.radius / 500)) }} />
                ) : (
                  <span
                    className={`font-semibold ${look.background === 'black' ? 'text-white' : 'text-[#FA2851]'}`}
                    style={{ fontSize: Math.round(look.size * 0.35) }}
                  >
                    {initials}
                  </span>
                )}
              </div>
            )}
            <div className="mt-3 max-w-[200px] text-[17px] font-semibold leading-tight text-[#1F1F1F]">{name}</div>
          </div>
          <div className="mb-5 h-9 w-full rounded-full bg-[#FA2851] text-center text-[13px] font-semibold leading-9 text-white">Get started</div>
        </div>
      </div>
    </div>
  );
}

/** The digits guests see prices in: 250 or ২৫০. A menu import sets it from how the menu prints its prices. */
function PriceDigits({ value, token, onSaved }: { value: 'latin' | 'bn'; token: string; onSaved: () => Promise<unknown> | void }) {
  const [saving, setSaving] = useState<'latin' | 'bn' | null>(null);
  const choose = async (v: 'latin' | 'bn') => {
    if (v === value || saving) return;
    setSaving(v);
    try {
      await updateTenant({ priceDigits: v }, token);
      await onSaved();
      toastSuccess(v === 'bn' ? 'Prices show as ৳২৫০' : 'Prices show as ৳250');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save it');
    } finally {
      setSaving(null);
    }
  };
  const active = saving ?? value;
  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Price digits</div>
      <p className="mt-0.5 text-[12px] text-slate-500">
        How guests see prices on your menu, cart and checkout. Importing a menu sets this from how the menu prints its prices.
      </p>
      <div role="radiogroup" aria-label="Price digits" className="mt-3 inline-flex rounded-lg border border-[#e2e2e2] bg-slate-50 p-1">
        {([
          ['latin', 'English · ৳1,250'],
          ['bn', 'Bangla · ৳১,২৫০'],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active === v}
            onClick={() => choose(v)}
            className={`rounded-md px-3 py-1 text-[13px] ${active === v ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
