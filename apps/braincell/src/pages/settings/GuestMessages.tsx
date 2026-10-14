// apps/braincell/src/pages/settings/GuestMessages.tsx — Settings → Guest messages: the restaurant's own words for what
// guests see — the AI waiter's intro, the thank-you after a dine-in / delivery / pickup order, the waiter-call
// confirmation — in Bangla and English. Empty = Qravy's default (shown greyed). The storefront fills the placeholders
// (apps/tastebud/src/utils/guestMessages.ts).
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { toastError, toastSuccess } from '../../components/Toaster';

type Lang = 'bn' | 'en';
type Key = 'welcome' | 'dineInTitle' | 'dineInBody' | 'deliveryTitle' | 'deliveryBody' | 'pickupTitle' | 'pickupBody' | 'waiterCall';
type Messages = Partial<Record<Key, { bn?: string; en?: string }>>;

// Qravy's defaults — what guests see when the restaurant hasn't written its own (the storefront's wording)
const DEFAULTS: Record<Key, Record<Lang, string>> = {
  welcome: {
    bn: '{restaurant}-এ স্বাগতম, আমি {waiter} - আপনার ভার্চুয়াল ওয়েটার। মেনু থেকে যেকোনো কিছু জানতে চাইলে কিংবা অর্ডার করতে আমাকে বলুন।',
    en: "Welcome to {restaurant}! I'm {waiter}, your virtual waiter. Ask me anything about the menu, or tell me what you'd like to order.",
  },
  dineInTitle: { bn: 'ধন্যবাদ!', en: 'Thank you!' },
  dineInBody: { bn: 'অর্ডার পাঠানো হয়েছে', en: 'Your order has been sent' },
  deliveryTitle: { bn: 'ধন্যবাদ, {name}!', en: 'Thank you, {name}!' },
  deliveryBody: { bn: 'অর্ডার পাঠানো হয়েছে', en: 'Your order has been sent' },
  pickupTitle: { bn: 'ধন্যবাদ, {name}!', en: 'Thank you, {name}!' },
  pickupBody: { bn: 'অর্ডার পাঠানো হয়েছে', en: 'Your order has been sent' },
  waiterCall: {
    bn: 'স্টাফকে জানানো হয়েছে — কেউ এখনই আপনার টেবিলে আসছেন।',
    en: "We've let the staff know — someone will be at your table shortly.",
  },
};

const GROUPS: Array<{ title: string; help: string; fields: Array<{ key: Key; label: string; long?: boolean }>; vars: string[] }> = [
  {
    title: 'Intro',
    help: 'What the AI waiter says (and shows) when a guest starts — on every table and online.',
    fields: [{ key: 'welcome', label: 'Greeting', long: true }],
    vars: ['restaurant', 'waiter'],
  },
  {
    title: 'Thank you — dine-in',
    help: 'Shown right after a guest orders from their table.',
    fields: [
      { key: 'dineInTitle', label: 'Title' },
      { key: 'dineInBody', label: 'Message' },
    ],
    vars: ['restaurant', 'table', 'order'],
  },
  {
    title: 'Thank you — delivery',
    help: 'Shown right after an online order for delivery.',
    fields: [
      { key: 'deliveryTitle', label: 'Title' },
      { key: 'deliveryBody', label: 'Message' },
    ],
    vars: ['restaurant', 'name', 'order'],
  },
  {
    title: 'Thank you — pickup',
    help: 'Shown right after an online order for pickup.',
    fields: [
      { key: 'pickupTitle', label: 'Title' },
      { key: 'pickupBody', label: 'Message' },
    ],
    vars: ['restaurant', 'name', 'order'],
  },
  {
    title: 'Waiter call',
    help: 'Shown to the guest after they call a waiter to their table.',
    fields: [{ key: 'waiterCall', label: 'Message', long: true }],
    vars: ['restaurant', 'table'],
  },
];

const SAMPLE: Record<string, string> = { restaurant: '', waiter: 'Pixie', name: 'Rahim', table: '12', order: '27' };

/** The storefront's filling (utils/guestMessages.ts in tastebud): values in, an empty one tidied away. */
function preview(t: string, vars: Record<string, string>): string {
  return t
    .replace(/\{(restaurant|waiter|name|table|order)\}/g, (_m, k: string) => vars[k] ?? '')
    .replace(/\s*,\s*([!।.?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export default function SettingsGuestMessages(): JSX.Element {
  const { token } = useAuthContext();
  const qc = useQueryClient();
  const { data: tenant, isLoading } = useTenant();
  const saved = (tenant?.guestMessages ?? {}) as Messages;
  const [draft, setDraft] = useState<Messages>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(saved), [tenant?.guestMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  const norm = (m: Messages) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(m)
          .map(([k, v]) => [k, { bn: v?.bn?.trim() || undefined, en: v?.en?.trim() || undefined }])
          .filter(([, v]) => (v as { bn?: string; en?: string }).bn || (v as { bn?: string; en?: string }).en)
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
      )
    );
  const dirty = norm(draft) !== norm(saved);
  const vars = useMemo(() => ({ ...SAMPLE, restaurant: tenant?.name || 'Your restaurant', waiter: tenant?.waiterName || 'Pixie' }), [tenant?.name, tenant?.waiterName]);

  const set = (key: Key, lang: Lang, value: string) => setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? {}), [lang]: value } }));
  const reset = (keys: Key[]) =>
    setDraft((d) => {
      const n = { ...d };
      for (const k of keys) delete n[k];
      return n;
    });

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ guestMessages: draft }, token as string);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Messages saved — guests see them right away');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the messages');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Guest messages</div>
        <p className="mt-0.5 max-w-3xl text-[12px] text-slate-500">
          Say things your way. Leave a box empty to keep the default (shown in grey). Words in curly brackets are filled in for each guest:{' '}
          <code className="rounded bg-slate-100 px-1">{'{restaurant}'}</code> <code className="rounded bg-slate-100 px-1">{'{waiter}'}</code>{' '}
          <code className="rounded bg-slate-100 px-1">{'{name}'}</code> <code className="rounded bg-slate-100 px-1">{'{table}'}</code>{' '}
          <code className="rounded bg-slate-100 px-1">{'{order}'}</code> (the order number).
        </p>
      </div>

      {GROUPS.map((g) => {
        const custom = g.fields.some((f) => draft[f.key]?.bn?.trim() || draft[f.key]?.en?.trim());
        return (
          <section key={g.title} className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[14px] font-semibold text-slate-900">{g.title}</div>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {g.help} Can use: {g.vars.map((v) => `{${v}}`).join(' ')}
                </p>
              </div>
              {custom && (
                <button
                  type="button"
                  onClick={() => reset(g.fields.map((f) => f.key))}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
                >
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Reset to default
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {(['bn', 'en'] as const).map((lang) => (
                <div key={lang} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{lang === 'bn' ? 'বাংলা' : 'English'}</div>
                  {g.fields.map((f) => {
                    const value = draft[f.key]?.[lang] ?? '';
                    const shown = preview(value.trim() || DEFAULTS[f.key][lang], vars);
                    return (
                      <label key={f.key} className="grid gap-1">
                        <span className="text-[12px] text-slate-600">{f.label}</span>
                        {f.long ? (
                          <textarea
                            value={value}
                            rows={3}
                            maxLength={400}
                            onChange={(e) => set(f.key, lang, e.target.value)}
                            placeholder={DEFAULTS[f.key][lang]}
                            className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm placeholder:text-slate-400"
                          />
                        ) : (
                          <input
                            value={value}
                            maxLength={400}
                            onChange={(e) => set(f.key, lang, e.target.value)}
                            placeholder={DEFAULTS[f.key][lang]}
                            className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm placeholder:text-slate-400"
                          />
                        )}
                        <span className="text-[11px] text-slate-400">Guests see: {shown}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-[#ececec] bg-white/95 p-3 shadow-md backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-800">{saving ? 'Saving…' : 'Unsaved changes'}</div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm" onClick={() => setDraft(saved)}>
                Discard
              </button>
              <button disabled={saving} onClick={save} className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-60">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
