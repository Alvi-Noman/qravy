// apps/braincell/src/pages/Riders.tsx — the restaurant's own delivery riders. Staff open it every shift: who's on
// duty, who's out on a delivery, how many they've done today and the cash they're holding ("Mark cash handed in").
// Riders never sign in to the admin: each has one private link to their page (Picked up → Delivered), sent to them
// on WhatsApp once — "Reset link" makes a new one if a phone is lost (the old one stops working at once).
// Handing an order to a rider happens on the order board (the delivery card in Ready).
import { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowPathIcon, PlusIcon, QrCodeIcon, TruckIcon } from '@heroicons/react/24/outline';
import PageFrame, { HEADER_BUTTON } from '../components/PageFrame';
import Modal from '../components/Modal';
import { useTenant } from '../hooks/useTenant';
import { useLocations } from '../components/locations/useLocations';
import { useAuthContext } from '../context/AuthContext';
import RiderAppGuide, { useRiderApk } from '../components/riders/RiderAppGuide';
import {
  VEHICLE_LABEL,
  createRider,
  listRiders,
  removeRider,
  resetRiderLink,
  riderApkUrl,
  riderLink,
  settleRiderCash,
  updateRider,
  whatsappTo,
  type Rider,
  type RiderInput,
  type RiderVehicle,
} from '../api/riders';

const money = (n: number) => `৳${n.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
const errText = (e: unknown) => (e as any)?.response?.data?.message || (e as Error)?.message || 'Something went wrong.';

export function RiderAvatar({ r, size = 40 }: { r: Pick<Rider, 'name' | 'photoUrl'>; size?: number }) {
  return r.photoUrl ? (
    <img src={r.photoUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[#efe9df] font-semibold text-[#6b5e44]"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(r.name)}
    </span>
  );
}

function Status({ r }: { r: Rider }) {
  if (r.active.length)
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
        {r.active.some((a) => a.pickedUp) ? 'Out delivering' : 'Order assigned'} · #{r.active.map((a) => a.orderNumber).join(', #')}
      </span>
    );
  return r.onDuty ? (
    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">On duty</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Off duty</span>
  );
}

/** The message staff send the rider with their link (WhatsApp opens with it written) — with the Android app's
 *  download when it's there: install it, then open the link to sign in. */
function linkMessage(restaurant: string, link: string, withApp: boolean) {
  return withApp
    ? `${restaurant}: your deliveries.\n1. Install the Qravy Rider app (Android): ${riderApkUrl()}\n2. Then open your own link to sign in:\n${link}\n(iPhone: just open the link in Safari.)`
    : `${restaurant}: your deliveries page. Keep this link — new orders show up here.\n${link}`;
}

const API_BASE = (import.meta.env.VITE_API_URL as string) || '';

/** The rider's photo: uploaded like menu photos and logos (guests see it on their order page). */
function PhotoField({ name, url, onChange, onError }: { name: string; url: string; onChange: (u: string) => void; onError: (e: string | null) => void }) {
  const { token } = useAuthContext();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return onError('Use a PNG, JPG or WebP photo.');
    if (file.size > 5 * 1024 * 1024) return onError('The photo must be under 5 MB.');
    setBusy(true);
    onError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch(`${API_BASE}/api/uploads/images`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${token}` } });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Upload failed');
      const src: string = data?.cdn?.medium || data?.cdn?.original || data?.url || data?.location || '';
      if (!src) throw new Error('Upload failed');
      onChange(src);
    } catch (e) {
      onError((e as Error)?.message || 'Could not upload the photo.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-4">
      <RiderAvatar r={{ name: name || '?', photoUrl: url || null }} size={64} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[#2e2e30]">
          Photo <span className="text-xs font-normal text-[#6b6b70]">optional — guests see it on their order page</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            id="rider-photo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="user"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {busy ? 'Uploading…' : url ? 'Replace photo' : 'Upload photo'}
          </button>
          {url && !busy && (
            <button type="button" onClick={() => onChange('')} className="px-2 py-1.5 text-sm text-[#6b6b70] hover:text-red-600">
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A rider's QR code: they open the app → "Scan the QR code" → signed in (or scan it with the phone's camera). */
function RiderQr({ r, link, onClose }: { r: Rider; link: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="rounded-2xl border border-[#ececf0] bg-white p-4">
        <QRCodeSVG value={link} size={240} level="M" marginSize={0} />
      </div>
      <div>
        <div className="font-semibold text-[#2e2e30]">{r.name}</div>
        <p className="mt-1 max-w-sm text-sm text-[#6b6b70]">
          The rider opens the Qravy Rider app and taps <b>Scan the QR code</b> — or points the phone's camera here. It opens their deliveries and the
          app remembers them.
        </p>
      </div>
      <button type="button" onClick={onClose} className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm font-semibold text-white">
        Done
      </button>
    </div>
  );
}

function RiderForm({
  initial,
  branches,
  onSave,
  onCancel,
}: {
  initial?: Rider | null;
  branches: { id: string; name: string }[];
  onSave: (v: RiderInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [vehicle, setVehicle] = useState<RiderVehicle | ''>(initial?.vehicle ?? 'bike');
  const [locationId, setLocationId] = useState(initial?.locationId ?? '');
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-sm';
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Enter the rider's name.");
        if (!/^\+?[0-9][0-9 -]{5,18}$/.test(phone.trim())) return setError('Enter a valid phone number.');
        setBusy(true);
        setError(null);
        try {
          await onSave({
            name: name.trim(),
            phone: phone.trim(),
            vehicle: vehicle || null,
            locationId: locationId || null,
            photoUrl: photoUrl.trim() || null,
          });
        } catch (err) {
          setError(errText(err));
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-[#2e2e30]">
        Name
        <input id="rider-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rakib Hasan" autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-[#2e2e30]">
        Phone
        <input id="rider-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01711-234567" inputMode="tel" />
        <span className="text-xs font-normal text-[#6b6b70]">Guests see it behind the Call button on their order page. The rider's link goes to this number on WhatsApp.</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-[#2e2e30]">
          Vehicle
          <select id="rider-vehicle" className={field} value={vehicle} onChange={(e) => setVehicle(e.target.value as RiderVehicle | '')}>
            {(Object.keys(VEHICLE_LABEL) as RiderVehicle[]).map((v) => (
              <option key={v} value={v}>
                {VEHICLE_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        {branches.length > 1 && (
          <label className="flex flex-col gap-1 text-sm font-medium text-[#2e2e30]">
            Rides for
            <select id="rider-branch" className={field} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Every branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <PhotoField name={name} url={photoUrl} onChange={setPhotoUrl} onError={setError} />
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-[#e2e2e2] bg-white px-4 py-2 text-sm font-medium">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : initial ? 'Save' : 'Add rider'}
        </button>
      </div>
    </form>
  );
}

export default function Riders() {
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const { locations } = useLocations();
  const branches = useMemo(() => (locations ?? []).filter((l: any) => !l.disabled).map((l: any) => ({ id: String(l.id), name: String(l.name) })), [locations]);
  const riders = useQuery({ queryKey: ['riders'], queryFn: listRiders, refetchInterval: 30_000 });
  const list = riders.data ?? [];
  const [editing, setEditing] = useState<Rider | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'reset' | 'cash'; r: Rider } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<Rider | null>(null);
  const apk = useRiderApk();
  const appReady = apk !== 'loading' && apk !== null;
  const reload = () => qc.invalidateQueries({ queryKey: ['riders'] });
  const linkOf = (r: Rider) => riderLink(r.linkToken);
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? 'Branch' : branches.length > 1 ? 'Every branch' : '');

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      await reload();
      if (done) setNote(done);
    } catch (e) {
      setNote(errText(e));
    }
  };
  const copy = async (r: Rider) => {
    try {
      await navigator.clipboard.writeText(linkOf(r));
      setNote(`${r.name}'s link copied.`);
    } catch {
      setNote(linkOf(r));
    }
  };

  const onDuty = list.filter((r) => r.onDuty).length;
  const holding = list.reduce((n, r) => n + r.cashHolding, 0);

  return (
    <PageFrame
      title="Riders"
      badge={list.length ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{onDuty} on duty</span> : null}
      actions={
        <>
          <button type="button" onClick={() => void riders.refetch()} className={HEADER_BUTTON} aria-label="Refresh">
            <ArrowPathIcon className={`h-4 w-4 ${riders.isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-md bg-[#2e2e30] px-3 py-2 text-sm font-semibold text-white">
            <PlusIcon className="h-4 w-4" />
            Add rider
          </button>
        </>
      }
    >
      <p className="text-sm text-[#6b6b70]">
        Your own delivery riders. Hand them a delivery order on the order board — they get it on their page and tap Picked up, then Delivered. No app, no login.
        {holding > 0 && <span className="font-semibold text-[#2e2e30]"> Riders are holding {money(holding)} in cash.</span>}
      </p>
      <RiderAppGuide restaurant={tenant?.name ?? ''} onCopied={setNote} />
      {note && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-[#2e2e30] ring-1 ring-slate-200">
          <span className="break-all">{note}</span>
          <button type="button" onClick={() => setNote(null)} className="shrink-0 text-xs font-semibold text-[#6b6b70]">
            Dismiss
          </button>
        </div>
      )}

      {riders.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-[#f6f6f6]" />
      ) : riders.isError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load riders.</p>
      ) : !list.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#e2e2e2] bg-white px-6 py-16 text-center">
          <TruckIcon className="mb-3 h-10 w-10 text-slate-300" />
          <div className="font-semibold text-[#2e2e30]">No riders yet</div>
          <p className="mt-1 max-w-sm text-sm text-[#6b6b70]">
            Add the people who deliver for you. Once you have riders, delivery orders on the board get an "Assign rider" button and an "On the way" column.
          </p>
          <button type="button" onClick={() => setEditing('new')} className="mt-4 rounded-md bg-[#2e2e30] px-4 py-2 text-sm font-semibold text-white">
            Add your first rider
          </button>
        </div>
      ) : (
        <div className="divide-y divide-[#eee] overflow-hidden rounded-lg border border-[#e6e6ea] bg-white">
          {list.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
              <RiderAvatar r={r} />
              <div className="flex min-w-[180px] flex-1 flex-col">
                <span className="font-semibold text-[#2e2e30]">{r.name}</span>
                <span className="text-xs text-[#6b6b70]">
                  {[r.phone, r.vehicle ? VEHICLE_LABEL[r.vehicle] : '', branchName(r.locationId)].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="flex min-w-[150px] flex-col items-start gap-1">
                <Status r={r} />
                <span className="text-xs text-[#6b6b70]">
                  {r.deliveredToday} delivered today
                  {r.cashHolding > 0 ? <span className="font-semibold text-[#2e2e30]"> · holding {money(r.cashHolding)}</span> : null}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#2e2e30]">
                  <input
                    id={`duty-${r.id}`}
                    type="checkbox"
                    checked={r.onDuty}
                    onChange={(e) => void act(() => updateRider(r.id, { onDuty: e.target.checked }))}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  On duty
                </label>
                <a
                  href={whatsappTo(r.phone, linkMessage(tenant?.name ?? '', linkOf(r), appReady))}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"
                >
                  {appReady ? 'Send app & link' : 'Send link'}
                </a>
                <button type="button" onClick={() => void copy(r)} className="rounded-md border border-[#e2e2e2] px-3 py-1.5 text-xs font-medium">
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={() => setQrFor(r)}
                  aria-label={`${r.name}'s QR code`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#e2e2e2] px-2.5 py-1.5 text-xs font-medium"
                >
                  <QrCodeIcon className="h-4 w-4" />
                  QR
                </button>
                {r.cashHolding > 0 && (
                  <button type="button" onClick={() => setConfirm({ kind: 'cash', r })} className="rounded-md border border-[#e2e2e2] px-3 py-1.5 text-xs font-semibold">
                    Mark cash handed in
                  </button>
                )}
                <button type="button" onClick={() => setEditing(r)} className="rounded-md px-2 py-1.5 text-xs font-medium text-[#6b6b70] hover:text-[#2e2e30]">
                  Edit
                </button>
                <button type="button" onClick={() => setConfirm({ kind: 'reset', r })} className="rounded-md px-2 py-1.5 text-xs font-medium text-[#6b6b70] hover:text-[#2e2e30]">
                  Reset link
                </button>
                <button type="button" onClick={() => setConfirm({ kind: 'remove', r })} className="rounded-md px-2 py-1.5 text-xs font-medium text-red-600">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!qrFor} onClose={() => setQrFor(null)} title="Sign in with a QR code" size="sm">
        {qrFor && <RiderQr r={qrFor} link={linkOf(qrFor)} onClose={() => setQrFor(null)} />}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a rider' : 'Edit rider'} size="md">
        {editing && (
          <RiderForm
            initial={editing === 'new' ? null : editing}
            branches={branches}
            onCancel={() => setEditing(null)}
            onSave={async (v) => {
              if (editing === 'new') await createRider({ ...v, onDuty: true });
              else await updateRider(editing.id, v);
              setEditing(null);
              await reload();
            }}
          />
        )}
      </Modal>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'remove' ? 'Remove rider?' : confirm?.kind === 'reset' ? 'Make a new link?' : 'Cash handed in?'}
        size="sm"
      >
        {confirm && (
          <div className="flex flex-col gap-4 text-sm text-[#2e2e30]">
            <p>
              {confirm.kind === 'remove'
                ? `${confirm.r.name} comes off the list and their link stops working. Past orders still show their name.`
                : confirm.kind === 'reset'
                ? `${confirm.r.name}'s current link stops working right away. Send them the new one on WhatsApp.`
                : `${confirm.r.name} has handed in ${money(confirm.r.cashHolding)}. Their cash count goes back to zero.`}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-md border border-[#e2e2e2] bg-white px-4 py-2 font-medium">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { kind, r } = confirm;
                  setConfirm(null);
                  if (kind === 'remove') void act(() => removeRider(r.id), `${r.name} removed.`);
                  else if (kind === 'reset') void act(() => resetRiderLink(r.id), `New link made for ${r.name}. Send it to them on WhatsApp.`);
                  else void act(() => settleRiderCash(r.id), `${money(r.cashHolding)} from ${r.name} marked as handed in.`);
                }}
                className={`rounded-md px-4 py-2 font-semibold text-white ${confirm.kind === 'remove' ? 'bg-red-600' : 'bg-[#2e2e30]'}`}
              >
                {confirm.kind === 'remove' ? 'Remove' : confirm.kind === 'reset' ? 'Make new link' : 'Yes, handed in'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </PageFrame>
  );
}
