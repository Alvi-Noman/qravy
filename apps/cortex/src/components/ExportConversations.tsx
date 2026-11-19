// apps/cortex/src/components/ExportConversations.tsx — download every AI waiter conversation in a date range: what the
// guest said, what the waiter said and showed (dish cards, upsell tray, offers, cart, orders) and each restaurant's menu.
// "Readable" (.txt) is made to hand to an AI ("find what the waiter got wrong"); JSON lines is for tools.
// Server: GET /cortex/conversations/export (auth-service services/cortex/conversationExport.ts).
import { useState } from 'react';
import { download, type TenantRow } from '../api';
import { ErrorBox } from './ui';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};
/** "2026-11-20" → that day's local midnight (the admin's own time zone) */
const midnight = (s: string, plusDays = 0) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d + plusDays);
};

export default function ExportConversations({ tenants, tenant: initialTenant }: { tenants: TenantRow[]; tenant: string }) {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(ymd(new Date()));
  const [tenant, setTenant] = useState(initialTenant);
  const [channel, setChannel] = useState('');
  const [format, setFormat] = useState<'txt' | 'jsonl'>('txt');
  const [menus, setMenus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const quick = (n: number) => {
    setFrom(daysAgo(n - 1));
    setTo(ymd(new Date()));
  };
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        from: midnight(from).toISOString(),
        to: midnight(to, 1).toISOString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka',
        format,
        menus: menus ? '1' : '0',
        ...(tenant ? { tenant } : {}),
        ...(channel ? { channel } : {}),
      });
      await download(`/conversations/export?${qs}`, `qravy-conversations-${from}_to_${to}.${format}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const input = 'rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-[13px]';
  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <div>
        <div className="text-[14px] font-semibold text-stone-900">Export conversations</div>
        <p className="text-[12px] text-stone-500">
          Every conversation in the dates you pick — what the guest said, what the waiter said and showed (dish cards, upsell tray, offers, cart
          changes, orders), automatic flags, and each restaurant&apos;s menu. Upload the readable file to an AI and ask it what the waiter got wrong —
          the file starts with instructions for it.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-[12px] text-stone-500">
          <div>From</div>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="space-y-1 text-[12px] text-stone-500">
          <div>To (including)</div>
          <input type="date" value={to} min={from} max={ymd(new Date())} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
        <div className="flex gap-1">
          {[1, 7, 30].map((n) => (
            <button key={n} type="button" onClick={() => quick(n)} className="rounded-md border border-stone-200 px-2 py-1.5 text-[12px] text-stone-600 hover:bg-stone-50">
              {n === 1 ? 'Today' : `Last ${n} days`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select value={tenant} onChange={(e) => setTenant(e.target.value)} className={input}>
          <option value="">All restaurants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className={input}>
          <option value="">Dine-in and online</option>
          <option value="dine-in">Dine-in only</option>
          <option value="online">Online only</option>
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value as 'txt' | 'jsonl')} className={input}>
          <option value="txt">Readable, for an AI (.txt)</option>
          <option value="jsonl">JSON lines, for tools (.jsonl)</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-stone-600">
          <input type="checkbox" checked={menus} onChange={(e) => setMenus(e.target.checked)} />
          Include menus
        </label>
        <button type="button" disabled={busy || !from || !to} onClick={go} className="rounded-lg bg-stone-900 px-4 py-2 text-[13px] text-white disabled:opacity-50">
          {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
      {error ? <ErrorBox error={error} /> : null}
    </div>
  );
}
