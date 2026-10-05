// apps/tastebud/src/components/DineInGate.tsx
// The dine-in side ("/t/burger-house/dine-in…") always runs with a table in the link (?table=12, from the table's
// QR code). A link without one — the number erased, a typed URL — asks for the table first; the guest's page opens
// once it's given. Numbers are checked against the restaurant's own tables (the ones it has QR codes for).
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getTable, getTableKey, normalizeTable, storeSubFromPath } from '../utils/table';
import { useStoreChannels } from '../utils/order-mode';
import { tr, uiLang } from '../utils/ui-lang';

export default function DineInGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const urlTable = normalizeTable(new URLSearchParams(location.search).get('table'));
  if (urlTable) return <>{children}</>;
  return <AskTable />;
}

function AskTable() {
  const location = useLocation();
  const navigate = useNavigate();
  const lang = uiLang();
  const sub = storeSubFromPath(location.pathname);
  const { tables } = useStoreChannels(sub);
  const [value, setValue] = useState(() => getTable(sub) ?? ''); // this phone's table from earlier, one tap away
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = normalizeTable(value);
    if (!t) return setError(tr(lang, 'টেবিল নম্বরটা লিখুন।', 'Please enter your table number.'));
    if (tables.length && !tables.map((x) => x.toUpperCase()).includes(t)) {
      return setError(
        tr(lang, `${t} নম্বরে কোনো টেবিল নেই — টেবিলে লেখা নম্বরটা দেখে দিন।`, `There's no table ${t} — please check the number on your table.`),
      );
    }
    const params = new URLSearchParams(location.search);
    params.set('table', t);
    const k = getTableKey(sub, t); // this phone scanned this table earlier → its QR key comes back too
    if (k) params.set('k', k);
    else params.delete('k');
    navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: location.hash }, { replace: true });
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF5F7] flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-gray-900">{tr(lang, 'আপনি কোন টেবিলে বসেছেন?', 'Which table are you at?')}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {tr(lang, 'টেবিলে লেখা নম্বরটা দিন, অথবা টেবিলের QR কোডটা স্ক্যান করুন।', 'Enter the number on your table, or scan its QR code.')}
        </p>
        <input
          autoFocus
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          placeholder={tr(lang, 'যেমন 12', 'e.g. 12')}
          aria-label={tr(lang, 'টেবিল নম্বর', 'Table number')}
          aria-invalid={!!error}
          className="mt-5 w-full rounded-2xl border border-gray-200 px-4 py-3 text-center text-2xl font-semibold tracking-wide outline-none focus:border-[#FA2851]"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button type="submit" className="mt-5 w-full rounded-full bg-[#FA2851] px-5 py-3 font-medium text-white">
          {tr(lang, 'শুরু করুন', 'Continue')}
        </button>
      </form>
    </main>
  );
}
