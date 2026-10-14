// apps/tastebud/src/components/CallWaiterButton.tsx
// "Call waiter" — in the dine-in pages' top bar (top-left; the language switch is top-right), so it never covers the
// page. `pill`: bell + label, styled like the language switch (the home screen); `icon`: a round bell beside the
// Back button where the bar is full (the menu, the order page). It opens a sheet: call a waiter, the bill, water,
// clean the table, or something else. The request goes to the restaurant's dashboard live; the button says so
// (pink dot: called · green: on the way). Online pages (pickup / delivery) never show it — no table to come to.
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { callForService, getServiceRequest, type ServiceKind, type ServiceStatus } from '../api/serviceRequests';
import { isDineInPath, normalizeTable, storeSubFromPath, useTable } from '../utils/table';
import { tr, uiLang, type UiLang } from '../utils/ui-lang';
import { ownMessage } from '../utils/guestMessages';
import { useGuestMessages } from '../utils/useGuestMessages';
import { track } from '../utils/track';

type Active = Partial<Record<ServiceKind, { token: string; status: ServiceStatus; at: number }>>;

const KEEP_MS = 2 * 60 * 60 * 1000; // a call older than this is forgotten (the guest has left)
const POLL_MS = 8000;

const OPTIONS: Array<{ kind: ServiceKind; icon: string; label: [string, string] }> = [
  { kind: 'waiter', icon: '🙋', label: ['ওয়েটার ডাকুন', 'Call a waiter'] },
  { kind: 'bill', icon: '🧾', label: ['বিল দিন', 'Bring the bill'] },
  { kind: 'water', icon: '💧', label: ['পানি দিন', 'Water, please'] },
  { kind: 'cleanup', icon: '🧽', label: ['টেবিল পরিষ্কার', 'Clean the table'] },
];

const storeKey = (sub: string, table: string) => `qravy:service:${sub}:${table}`;

function readActive(sub: string, table: string): Active {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(sub, table)) || '{}') as Active;
    const out: Active = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && v.status !== 'resolved' && Date.now() - v.at < KEEP_MS) out[k as ServiceKind] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeActive(sub: string, table: string, a: Active) {
  try {
    localStorage.setItem(storeKey(sub, table), JSON.stringify(a));
  } catch {
    /* storage blocked — the button still works, it just forgets on the next page */
  }
}

export default function CallWaiterButton({
  sub: subProp,
  branch,
  table: tableProp,
  variant = 'pill',
  className = '',
  lang: langProp,
}: {
  sub?: string | null;
  branch?: string | null;
  /** The order page has its table on the order, not in the link */
  table?: string | null;
  /** pill: bell + label (room for it) · icon: round bell only (a full top bar) */
  variant?: 'pill' | 'icon';
  className?: string;
  lang?: UiLang;
}) {
  const location = useLocation();
  const sub = subProp || storeSubFromPath(location.pathname);
  const [urlTable] = useTable(sub);
  const table = normalizeTable(tableProp) ?? (isDineInPath(location.pathname) ? urlTable : null);
  const lang = langProp ?? uiLang();
  const t = (bn: string, en: string) => tr(lang, bn, en);
  const guest = useGuestMessages(sub);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Active>(() => (sub && table ? readActive(sub, table) : {}));
  const [sending, setSending] = useState<ServiceKind | null>(null);
  const [sent, setSent] = useState<ServiceKind | null>(null);
  const [error, setError] = useState('');
  const [other, setOther] = useState('');
  const [writing, setWriting] = useState(false);

  const save = useCallback(
    (next: Active) => {
      setActive(next);
      if (sub && table) writeActive(sub, table, next);
    },
    [sub, table],
  );

  useEffect(() => {
    if (sub && table) setActive(readActive(sub, table));
  }, [sub, table]);

  // asked by voice ("bill please" to the AI waiter) — the waiter called the staff; follow that call here too
  useEffect(() => {
    if (!sub || !table) return;
    const onCall = (e: Event) => {
      const c = (e as CustomEvent).detail as { token?: string; kind?: ServiceKind; status?: ServiceStatus; table?: string };
      if (!c?.token || !c.kind || (c.table && normalizeTable(c.table) !== table)) return;
      save({ ...readActive(sub, table), [c.kind]: { token: c.token, status: c.status ?? 'open', at: Date.now() } });
    };
    window.addEventListener('qravy:service-call', onCall);
    return () => window.removeEventListener('qravy:service-call', onCall);
  }, [sub, table, save]);

  // follow the open calls: "On the way" once a staff member taps it, gone once they're done
  const tokens = Object.values(active)
    .map((v) => v!.token)
    .join(',');
  useEffect(() => {
    if (!sub || !table || !tokens) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = readActive(sub, table);
      let changed = false;
      for (const [kind, v] of Object.entries(current)) {
        const r = await getServiceRequest(v!.token).catch(() => undefined);
        if (r === undefined) continue; // offline — try again later
        if (!r || r.status === 'resolved') {
          delete current[kind as ServiceKind];
          changed = true;
        } else if (r.status !== v!.status) {
          if (r.status === 'acknowledged') {
            try {
              navigator.vibrate?.(150);
            } catch {
              /* unsupported */
            }
          }
          current[kind as ServiceKind] = { ...v!, status: r.status };
          changed = true;
        }
      }
      if (alive && changed) save(current);
    };
    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [sub, table, tokens, save]);

  const states = Object.values(active).map((v) => v!.status);
  const waiting = states.includes('open');
  const coming = !waiting && states.includes('acknowledged');

  if (!sub || !table) return null;

  const call = async (kind: ServiceKind, note?: string) => {
    setSending(kind);
    setError('');
    try {
      const r = await callForService({ subdomain: sub, branch, table, kind, note });
      track('call_waiter', { data: { kind } });
      save({ ...readActive(sub, table), [kind]: { token: r.token, status: r.status, at: Date.now() } });
      setSent(kind);
      setWriting(false);
      setOther('');
    } catch (e) {
      setError((e as Error)?.message || t('পাঠানো গেল না — আবার চেষ্টা করুন।', "Couldn't send — please try again."));
    } finally {
      setSending(null);
    }
  };

  const stateLabel = waiting
    ? t('ওয়েটার ডাকা হয়েছে', 'Waiter called')
    : coming
    ? t('ওয়েটার আসছেন', 'Waiter on the way')
    : t('ওয়েটার ডাকুন', 'Call waiter');
  const statusLabel = (s?: ServiceStatus) =>
    s === 'acknowledged' ? t('আসছেন', 'On the way') : s === 'open' ? t('ডাকা হয়েছে', 'Called') : '';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSent(null);
          setError('');
        }}
        // the same chrome as the language switch / Back button beside it: white, hairline border, 36px tall
        className={`relative inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-gray-900 shadow-sm backdrop-blur transition active:scale-95 ${
          variant === 'icon' ? 'w-9' : 'gap-1.5 pl-2.5 pr-3.5'
        } ${className}`}
        aria-label={stateLabel}
        title={variant === 'icon' ? stateLabel : undefined}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#FA2851" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {variant === 'pill' && (
          <span
            className="whitespace-nowrap text-[13px] font-medium leading-none"
            style={lang === 'bn' ? { fontFamily: `'Noto Sans Bengali', system-ui, sans-serif` } : undefined}
          >
            {waiting ? t('ডাকা হয়েছে', 'Waiter called') : coming ? t('আসছেন', 'On the way') : t('ওয়েটার ডাকুন', 'Call waiter')}
          </span>
        )}
        {(waiting || coming) && (
          <span
            aria-hidden="true"
            className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${waiting ? 'animate-pulse bg-[#FA2851]' : 'bg-emerald-500'}`}
          />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t('ওয়েটার ডাকুন', 'Call waiter')}>
          <button type="button" className="absolute inset-0 bg-black/40" aria-label={t('বন্ধ করুন', 'Close')} onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-md rounded-t-3xl bg-white px-5 pt-5 sm:rounded-3xl sm:pb-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('কী লাগবে?', 'How can we help?')}</h2>
                <p className="text-sm text-gray-500">{t(`টেবিল ${table}`, `Table ${table}`)}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                aria-label={t('বন্ধ করুন', 'Close')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {sent && (
              <p role="status" className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {ownMessage(guest.messages, 'waiterCall', lang === 'en' ? 'en' : 'bn', { table, restaurant: guest.restaurant, waiter: guest.waiter }) ??
                  t('স্টাফকে জানানো হয়েছে — কেউ এখনই আপনার টেবিলে আসছেন।', "We've let the staff know — someone will be at your table shortly.")}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {OPTIONS.map((o) => {
                const s = active[o.kind]?.status;
                return (
                  <button
                    key={o.kind}
                    type="button"
                    disabled={sending !== null}
                    onClick={() => void call(o.kind)}
                    className={`flex flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.98] disabled:opacity-60 ${
                      s ? 'border-[#FA2851]/40 bg-[#FFF5F7]' : 'border-gray-200 bg-white hover:border-[#FA2851]/40'
                    }`}
                  >
                    <span className="text-xl" aria-hidden="true">
                      {o.icon}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{t(o.label[0], o.label[1])}</span>
                    <span className="text-xs text-gray-500">
                      {sending === o.kind ? t('পাঠানো হচ্ছে…', 'Sending…') : s ? `${statusLabel(s)} · ${t('আবার ডাকুন', 'tap to call again')}` : ' '}
                    </span>
                  </button>
                );
              })}
            </div>

            {writing ? (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (other.trim()) void call('other', other);
                }}
              >
                <input
                  autoFocus
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  maxLength={200}
                  placeholder={t('যেমন: বাচ্চার জন্য একটা চেয়ার', 'e.g. a high chair for the baby')}
                  aria-label={t('অন্য কিছু', 'Something else')}
                  className="min-w-0 flex-1 rounded-full border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-[#FA2851]"
                />
                <button
                  type="submit"
                  disabled={!other.trim() || sending !== null}
                  className="rounded-full bg-[#FA2851] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending === 'other' ? t('পাঠানো হচ্ছে…', 'Sending…') : t('পাঠান', 'Send')}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setWriting(true)}
                className="mt-3 w-full rounded-2xl border border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-700"
              >
                ✏️ {t('অন্য কিছু লাগবে?', 'Something else?')}
                {active.other && <span className="ml-1 text-xs text-gray-500">· {statusLabel(active.other.status)}</span>}
              </button>
            )}

            {error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
