// apps/braincell/src/pages/settings/Domain.tsx — Settings → Domain: the restaurant's own domain.
// Like Shopify's "Connect existing domain": type the domain → add two records at the domain provider (with that
// provider's steps, detected from its name servers) → we check them (also on our own every 30 s) → HTTPS comes
// automatically → guests on "burger-house.qravy.com" are sent to the domain. Shop, dine-in, branches and table QR
// codes all work the same on it. Owners only (the server enforces it).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { addDomain, checkDomain, getDomain, removeDomain, setDomainRedirect, type DomainRecord, type DomainState } from '../../api/domain';

type Domain = NonNullable<DomainState['domain']>;

/* ------------------------------------------------------------------ provider guides */

type Guide = { name: string; open: ReactNode[]; tips: ReactNode[]; link?: string };

const GUIDES: Record<string, Guide> = {
  godaddy: {
    name: 'GoDaddy',
    link: 'https://dcc.godaddy.com/control/portfolio',
    open: ['Sign in to GoDaddy and open My Products.', <>Next to your domain, choose <b>DNS</b> (or “Manage DNS”).</>],
    tips: [
      <>GoDaddy already has an <b>A</b> record named <b>@</b> and a <b>CNAME</b> named <b>www</b> — click <b>Edit</b> on those instead of adding new ones.</>,
      <>Delete any “Forwarding” set up for the domain.</>,
    ],
  },
  namecheap: {
    name: 'Namecheap',
    link: 'https://ap.www.namecheap.com/domains/list/',
    open: [<>Go to <b>Domain List</b> and click <b>Manage</b> next to your domain.</>, <>Open the <b>Advanced DNS</b> tab.</>],
    tips: [
      <>Delete Namecheap’s default <b>URL Redirect Record</b> and the <b>parkingpage</b> CNAME if they’re there.</>,
      <>Click <b>Add New Record</b> for each record below, then the green tick to save it.</>,
    ],
  },
  cloudflare: {
    name: 'Cloudflare',
    link: 'https://dash.cloudflare.com/',
    open: ['Open your domain in Cloudflare.', <>Go to <b>DNS → Records</b>.</>],
    tips: [
      <>
        Set <b>Proxy status</b> to <b>DNS only</b> (grey cloud) on these records. With the orange cloud on, your domain won’t
        connect.
      </>,
    ],
  },
  squarespace: {
    name: 'Squarespace Domains (formerly Google Domains)',
    link: 'https://account.squarespace.com/domains',
    open: ['Open your domain in Squarespace Domains.', <>Go to <b>DNS → DNS Settings</b> and find <b>Custom records</b>.</>],
    tips: [<>Remove Squarespace’s default records for <b>@</b> and <b>www</b> if they’re there.</>],
  },
  hostinger: {
    name: 'Hostinger',
    link: 'https://hpanel.hostinger.com/domains',
    open: [<>In hPanel, open <b>Domains</b> and choose your domain.</>, <>Go to <b>DNS / Nameservers → DNS records</b>.</>],
    tips: [<>Delete the existing <b>A @</b> and <b>CNAME www</b> records first, then add the ones below.</>],
  },
  other: {
    name: 'another provider',
    open: [
      'Sign in where you bought the domain (or where its DNS is managed).',
      <>
        Find <b>DNS</b>, <b>DNS Management</b>, <b>Manage DNS</b> or <b>Zone Editor</b> (cPanel).
      </>,
    ],
    tips: ['Can’t find it? Copy the message below and send it to your domain seller’s support or your IT person.'],
  },
};

const PROBLEM: Record<NonNullable<DomainRecord['problem']>, (r: DomainRecord) => string> = {
  missing: () => 'Not found yet. Add it — or, if you just did, give it a few minutes.',
  wrong: (r) => `Points to ${r.found?.join(', ')} — change it to ${r.value}.`,
  extra: (r) => `There’s another ${r.type} record too (${r.found?.filter((f) => f !== r.value).join(', ')}) — delete it and keep only ${r.value}.`,
  'cloudflare-proxy': () => 'Cloudflare’s proxy is on (orange cloud). Set this record to “DNS only” (grey cloud).',
  ipv6: () => 'There’s also an AAAA (IPv6) record for this name — delete it; it sends some guests elsewhere.',
};

/* ------------------------------------------------------------------ small pieces */

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
      aria-label={`${label}: ${text}`}
    >
      <ClipboardDocumentIcon className="h-3.5 w-3.5" />
      {done ? 'Copied' : label}
    </button>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#ececec] bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

function Step({ n, title, state, children }: { n: number; title: ReactNode; state: 'done' | 'now' | 'later'; children?: ReactNode }) {
  return (
    <li className="relative pl-10">
      <span
        className={`absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ${
          state === 'done' ? 'bg-emerald-600 text-white' : state === 'now' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {state === 'done' ? <CheckCircleIcon className="h-5 w-5" /> : n}
      </span>
      <div className={`text-[14px] font-semibold ${state === 'later' ? 'text-slate-400' : 'text-slate-900'}`}>{title}</div>
      {children && <div className="mt-2">{children}</div>}
    </li>
  );
}

const errMessage = (e: unknown): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Something went wrong. Please try again.';

/* ------------------------------------------------------------------ the page */

export default function SettingsDomain(): JSX.Element {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['custom-domain'], queryFn: getDomain, retry: false });
  const set = (d: DomainState) => {
    qc.setQueryData(['custom-domain'], d);
    void qc.invalidateQueries({ queryKey: ['tenant'] }); // QR codes follow the main address
  };

  const forbidden = (q.error as { response?: { status?: number } } | null)?.response?.status === 403;
  if (forbidden) {
    return (
      <Card>
        <div className="text-[14px] font-semibold text-slate-900">Domain</div>
        <p className="mt-1 text-[13px] text-slate-600">Only the restaurant’s owner can connect or change its domain.</p>
      </Card>
    );
  }
  if (q.isLoading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (q.error || !q.data) return <Card>Could not load your domain settings. Please refresh the page.</Card>;

  const { qravyAddress, domain } = q.data;
  return (
    <div className="grid gap-4">
      <QravyAddress address={qravyAddress} domain={domain} />
      {domain ? <Connecting domain={domain} qravyAddress={qravyAddress} onChange={set} /> : <AddDomain onAdded={set} />}
    </div>
  );
}

function QravyAddress({ address, domain }: { address: string; domain: DomainState['domain'] }) {
  const forwards = domain?.status === 'connected' && domain.https && domain.redirect;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-slate-500">Your Qravy address</div>
          <div className="mt-0.5 text-[16px] font-semibold text-slate-900">{address}</div>
          <p className="mt-1 text-[12px] text-slate-500">
            {forwards
              ? `Always works — guests who open it are sent to ${domain!.primary}, with the same page, branch and table.`
              : 'Always works, even after you connect your own domain.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Copy text={`https://${address}`} />
          <a
            href={`https://${address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Open
          </a>
        </div>
      </div>
    </Card>
  );
}

function AddDomain({ onAdded }: { onAdded: (d: DomainState) => void }) {
  const [value, setValue] = useState('');
  const m = useMutation({ mutationFn: addDomain, onSuccess: onAdded });
  return (
    <Card>
      <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
        <GlobeAltIcon className="h-5 w-5 text-slate-500" /> Connect your own domain
      </div>
      <p className="mt-1 max-w-2xl text-[13px] text-slate-600">
        Use a domain you’ve bought, like <b>burgerhouse.com</b>. Your online shop, the AI waiter, every branch and every table’s QR
        code work on it exactly as they do now — and HTTPS (the padlock) is set up for you, free.
      </p>
      <form
        className="mt-4 flex max-w-xl flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) m.mutate(value.trim());
        }}
      >
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            m.reset();
          }}
          placeholder="burgerhouse.com"
          aria-label="Your domain"
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-[#e2e2e2] px-3 py-2 text-[14px] outline-none focus:border-slate-400"
        />
        <button type="submit" disabled={m.isPending || !value.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">
          {m.isPending ? 'Adding…' : 'Next'}
        </button>
      </form>
      {m.error && <p className="mt-2 text-[13px] text-red-700">{errMessage(m.error)}</p>}
      <ul className="mt-4 space-y-1 text-[12px] text-slate-500">
        <li>• A whole domain (burgerhouse.com) works with and without “www”. A subdomain (order.burgerhouse.com) works too.</li>
        <li>• Don’t have a domain yet? Buy one from any domain seller (Namecheap, GoDaddy, Cloudflare, or a local one), then come back.</li>
        <li>• Nothing changes for your guests until the domain is fully connected and secured.</li>
      </ul>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-900">{value}</code>
      <Copy text={value} />
    </div>
  );
}

/** One card per record — Type / Name / Value on their own lines, each with Copy; after a check, right or what to fix. */
function RecordsTable({ records, checked }: { records: DomainRecord[]; checked: boolean }) {
  return (
    <div className="space-y-2.5">
      {records.map((r, i) => (
        <div key={`${r.type}-${r.host}-${r.value}`} className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-slate-700">Record {i + 1}</span>
            {checked &&
              (r.ok ? (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700">
                  <CheckCircleIcon className="h-4 w-4" /> Correct
                </span>
              ) : (
                <span className="text-[12px] font-medium text-amber-800">Not right yet</span>
              ))}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3">
              <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type</span>
              <span className="text-[13px] font-semibold text-slate-900">{r.type}</span>
            </div>
            <Field label="Name / Host" value={r.name} />
            <Field label="Value" value={r.value} />
          </div>
          {checked && !r.ok && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {r.problem ? PROBLEM[r.problem](r) : 'Not right yet.'}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Connecting({ domain, qravyAddress, onChange }: { domain: Domain; qravyAddress: string; onChange: (d: DomainState) => void }) {
  const connected = domain.status === 'connected';
  const live = connected && domain.https;
  const checked = !!domain.checkedAt && domain.records.some((r) => r.ok !== undefined);
  const guideIds = Object.keys(GUIDES);
  const [guideId, setGuideId] = useState(domain.provider && GUIDES[domain.provider.id] ? domain.provider.id : 'other');
  useEffect(() => {
    if (domain.provider && GUIDES[domain.provider.id]) setGuideId(domain.provider.id);
  }, [domain.provider]);
  const guide = GUIDES[guideId];

  const check = useMutation({ mutationFn: checkDomain, onSuccess: onChange });
  const redirect = useMutation({ mutationFn: setDomainRedirect, onSuccess: onChange });
  const remove = useMutation({ mutationFn: removeDomain, onSuccess: onChange });

  // keep checking while the owner waits on this page: every 30 s for 15 minutes, until it's live
  const tries = useRef(0);
  const checkNow = useRef(check);
  checkNow.current = check;
  useEffect(() => {
    if (live) return;
    const id = window.setInterval(() => {
      const c = checkNow.current;
      if (document.visibilityState !== 'visible' || c.isPending || tries.current >= 30) return;
      tries.current += 1;
      c.mutate();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [live]);

  const supportMessage = useMemo(
    () =>
      [
        `Hello, please add these DNS records for ${domain.host}:`,
        ...domain.records.map((r) => `- ${r.type} record, name/host "${r.name}", value "${r.value}"`),
        domain.kind === 'apex' ? `Please remove any other A records for "@" and any AAAA records for "@" and "www".` : '',
        'Thank you!',
      ]
        .filter(Boolean)
        .join('\n'),
    [domain]
  );

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-slate-500">Your domain</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[18px] font-semibold text-slate-900">{domain.primary}</span>
            {live ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">
                <LockClosedIcon className="h-3.5 w-3.5" /> Connected
              </span>
            ) : connected ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[12px] font-medium text-sky-700">Securing…</span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-800">Waiting for DNS records</span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Disconnect ${domain.host}? Guests will use ${qravyAddress} again.`)) remove.mutate();
          }}
          className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] text-red-700 hover:bg-red-50"
        >
          {remove.isPending ? 'Removing…' : 'Remove domain'}
        </button>
      </div>

      {live && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[14px] font-semibold text-emerald-900">Guests can now order at {domain.primary} 🎉</div>
            <a
              href={`https://${domain.primary}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-emerald-800 shadow-sm"
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Open
            </a>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={domain.redirect}
              disabled={redirect.isPending}
              onChange={(e) => redirect.mutate(e.target.checked)}
            />
            <span className="text-[13px] text-emerald-900">
              <b>Make {domain.primary} the main address.</b> Guests who open {qravyAddress} — including printed QR codes — are sent
              to {domain.primary}, on the same page, branch and table. New QR codes show {domain.primary}.
              {domain.redirect && (
                <>
                  {' '}
                  <Link to="/qr-codes" className="underline">
                    See QR codes
                  </Link>
                </>
              )}
            </span>
          </label>
          <p className="mt-3 text-[12px] text-emerald-900">
            Tip: you and your staff can open this dashboard from <b>{domain.primary}/admin</b>.
          </p>
        </div>
      )}

      <ol className="mt-5 space-y-6">
        <Step n={1} title={`Domain added: ${domain.host}`} state="done" />

        <Step n={2} title={<>Add {domain.records.length === 1 ? 'this record' : 'these records'} where you manage your domain</>} state={connected ? 'done' : 'now'}>
          {!connected && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                {domain.provider && domain.provider.id !== 'other' ? (
                  <span>
                    Your domain’s DNS is at <b className="text-slate-900">{domain.provider.name}</b>.
                  </span>
                ) : (
                  <span>Where do you manage your domain?</span>
                )}
                <select value={guideId} onChange={(e) => setGuideId(e.target.value)} className="rounded-md border border-[#e2e2e2] px-2 py-1 text-[13px]" aria-label="Domain provider">
                  {guideIds.map((id) => (
                    <option key={id} value={id}>
                      {id === 'other' ? 'Another provider' : GUIDES[id].name}
                    </option>
                  ))}
                </select>
              </div>

              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-slate-700">
                {guide.open.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
                <li>
                  Add {domain.records.length === 1 ? 'this record' : 'each record below'} — the <b>Name / Host</b> and <b>Value</b> exactly as
                  shown{domain.kind === 'apex' ? <> (some providers call <b>@</b> “root” or want it left empty)</> : null}:
                </li>
              </ol>
              <RecordsTable records={domain.records} checked={checked} />
              <ul className="space-y-1 text-[12px] text-slate-600">
                {guide.tips.map((t, i) => (
                  <li key={i}>• {t}</li>
                ))}
                {domain.kind === 'apex' && <li>• Delete any other <b>A</b> records for <b>@</b>, and any <b>AAAA</b> records for <b>@</b> or <b>www</b>.</li>}
                <li>• If there’s a TTL setting, choose the lowest (or “Automatic”).</li>
              </ul>
              {guide.link && (
                <a href={guide.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-900 underline">
                  Open {guide.name} <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </a>
              )}
              <details className="text-[13px] text-slate-600">
                <summary className="cursor-pointer select-none font-medium text-slate-800">Someone else manages your domain?</summary>
                <p className="mt-2">Send them this message:</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[12px] text-slate-800">{supportMessage}</pre>
                <div className="mt-2">
                  <Copy text={supportMessage} label="Copy message" />
                </div>
              </details>
            </div>
          )}
        </Step>

        <Step n={3} title="Check the connection" state={connected ? 'done' : 'now'}>
          {!connected && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => check.mutate()}
                  disabled={check.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${check.isPending ? 'animate-spin' : ''}`} />
                  {check.isPending ? 'Checking…' : 'Check connection'}
                </button>
                {domain.checkedAt && (
                  <span className="text-[12px] text-slate-500">Last checked {new Date(domain.checkedAt).toLocaleTimeString()} · we keep checking while this page is open</span>
                )}
              </div>
              <p className="text-[12px] text-slate-500">
                New records usually work within minutes; some providers take a few hours (rarely up to 48).
              </p>
              {check.error && <p className="text-[13px] text-red-700">{errMessage(check.error)}</p>}
            </div>
          )}
        </Step>

        <Step n={4} title="Secure connection (HTTPS)" state={live ? 'done' : connected ? 'now' : 'later'}>
          {connected && !live && (
            <div className="space-y-2 text-[13px] text-slate-600">
              <p>Your records are right. We’re getting the free security certificate for {domain.hosts.join(' and ')} — usually under a minute.</p>
              <button
                type="button"
                onClick={() => check.mutate()}
                disabled={check.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-medium text-slate-800"
              >
                <ArrowPathIcon className={`h-4 w-4 ${check.isPending ? 'animate-spin' : ''}`} /> Check again
              </button>
            </div>
          )}
          {!connected && <p className="text-[12px] text-slate-400">Automatic and free, once the records are right.</p>}
        </Step>
      </ol>
    </Card>
  );
}
