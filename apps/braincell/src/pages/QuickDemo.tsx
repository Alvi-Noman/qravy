/**
 * QuickDemo.tsx — public, no login. Built for showing a restaurant owner a live demo on a phone, at their table.
 *
 *   /quick-demo        photos of their menu → upload (the AI starts reading at once) → their restaurant's name
 *   /quick-demo/:key   reading / building → the live dine-in storefront link (table 1) + a QR code to scan
 *
 * The demo restaurant and its menu are deleted automatically after 24 hours (services/auth-service quickDemo.ts).
 * The key in the URL is the demo's secret, so a refresh or a reopened tab picks up where it was.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ShareIcon,
  SparklesIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import MenuFileDropzone from '../components/menu-import/MenuFileDropzone';
import {
  demoErrorMessage,
  getQuickDemo,
  isDemoGone,
  nameQuickDemo,
  startQuickDemo,
  type QuickDemo,
} from '../api/quickDemo';
import { storefrontBase, tableUrl } from '../utils/storefront';

const LAST_DEMO_KEY = 'quickDemo:last';

function rememberDemo(key: string | null) {
  try {
    if (key) localStorage.setItem(LAST_DEMO_KEY, key);
    else localStorage.removeItem(LAST_DEMO_KEY);
  } catch {}
}
function lastDemo(): string | null {
  try {
    return localStorage.getItem(LAST_DEMO_KEY);
  } catch {
    return null;
  }
}

function demoUrl(demo: QuickDemo): string | null {
  if (!demo.subdomain) return null;
  return tableUrl(storefrontBase(demo.subdomain), demo.table, demo.tableKey ?? undefined);
}

function untilLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/* ---------------------------------- Layout --------------------------------- */

const STEPS = ['Photos', 'Name', 'Live'] as const;

function Shell({ step, children }: { step: 0 | 1 | 2; children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#f7f7f8] text-[#2e2e30]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between py-2">
          <Link to="/quick-demo" className="flex items-center gap-2" aria-label="Qravy quick demo">
            <img src="/qravy-icon-200X200.png" alt="" className="h-9 w-9 rounded-lg" />
            <span className="text-lg font-semibold tracking-tight">Qravy</span>
          </Link>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            Live demo
          </span>
        </header>

        <ol className="mb-5 mt-3 grid grid-cols-3 gap-2" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${i <= step ? 'bg-[#2e2e30]' : 'bg-[#e2e2e5]'}`} />
              <span className={`text-xs ${i <= step ? 'font-medium text-[#2e2e30]' : 'text-[#9a9aa0]'}`}>{label}</span>
            </li>
          ))}
        </ol>

        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

function ProgressCard({ title, subtitle, pct }: { title: string; subtitle?: string; pct: number }) {
  return (
    <div className="rounded-2xl border border-[#e8e8ea] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ rotate: [0, 12, -12, 0] }}
          transition={{ repeat: Infinity, duration: 2.4 }}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#f3f3f3]"
        >
          <SparklesIcon className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          {subtitle && <p className="text-sm text-[#6b6b70]">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#eeeeee]">
        <motion.div
          className="h-full rounded-full bg-[#2e2e30]"
          initial={false}
          animate={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
          transition={{ ease: 'easeOut', duration: 0.4 }}
        />
      </div>
    </div>
  );
}

/** The restaurant-name form, shown while the photos upload and the AI reads them. */
function NameForm({
  initial,
  saving,
  saved,
  onSubmit,
}: {
  initial: string;
  saving: boolean;
  saved: boolean;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="rounded-2xl border border-[#e8e8ea] bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <label htmlFor="demo-name" className="block text-lg font-semibold">
        What’s the restaurant called?
      </label>
      <p className="mt-0.5 text-sm text-[#6b6b70]">Shown on the storefront. The menu is read meanwhile.</p>
      <input
        ref={inputRef}
        id="demo-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
        placeholder="e.g. Sultan’s Dine"
        className="mt-3 w-full rounded-xl border border-[#dbdbdb] bg-white px-4 py-3.5 text-base outline-none focus:border-[#2e2e30] focus:ring-2 focus:ring-[#2e2e30]/10"
      />
      <button
        type="submit"
        disabled={!name.trim() || saving}
        className="mt-3 w-full rounded-xl bg-[#2e2e30] px-5 py-4 text-base font-semibold text-white active:opacity-90 disabled:opacity-40"
      >
        {saving ? 'Saving…' : saved ? 'Update name' : 'Create storefront'}
      </button>
    </form>
  );
}

/* ---------------------------------- Steps ---------------------------------- */

/** No demo yet: pick photos, then upload while asking for the name. */
function StartStep() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState('');
  const pendingNameRef = useRef('');
  const resume = lastDemo();

  const start = async (files: File[]) => {
    setError(null);
    setUploadPct(0);
    try {
      let demo = await startQuickDemo(files, setUploadPct);
      // A name typed during the upload is sent right away
      if (pendingNameRef.current) demo = await nameQuickDemo(demo.key, pendingNameRef.current);
      queryClient.setQueryData(['quick-demo', demo.key], demo);
      rememberDemo(demo.key);
      navigate(`/quick-demo/${demo.key}`, { replace: true });
    } catch (err) {
      setUploadPct(null);
      setError(demoErrorMessage(err, 'Upload failed. Check the connection and try again.'));
    }
  };

  if (uploadPct !== null) {
    return (
      <Shell step={1}>
        <div className="space-y-4">
          <ProgressCard
            title={uploadPct < 100 ? 'Uploading the menu…' : 'Starting the AI…'}
            subtitle={uploadPct < 100 ? `${uploadPct}%` : 'Almost there'}
            pct={uploadPct * 0.9}
          />
          <NameForm
            initial={pendingName}
            saving={false}
            saved={!!pendingName}
            onSubmit={(n) => {
              pendingNameRef.current = n;
              setPendingName(n);
            }}
          />
          {pendingName && (
            <p className="text-center text-sm text-[#6b6b70]">
              “{pendingName}” is saved — it’s used as soon as the upload finishes.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell step={0}>
      <h1 className="text-2xl font-bold leading-tight tracking-tight">Their menu, live in a minute</h1>
      <p className="mb-5 mt-1.5 text-[15px] text-[#6b6b70]">
        Take a photo of each menu page. The AI turns it into a storefront the guests order from at the table.
      </p>
      <MenuFileDropzone onSubmit={start} />
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {resume && (
        <Link
          to={`/quick-demo/${resume}`}
          className="mt-6 block rounded-xl border border-[#e2e2e5] bg-white px-4 py-3.5 text-center text-sm font-medium"
        >
          Back to the last demo
        </Link>
      )}
      <p className="mt-auto pt-8 text-center text-xs text-[#9a9aa0]">
        Demo restaurants and their menus are deleted automatically after 24 hours.
      </p>
    </Shell>
  );
}

function ReadyStep({ demo, onRestart }: { demo: QuickDemo; onRestart: () => void }) {
  const url = demoUrl(demo)!;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const k = `quickDemo:celebrated:${demo.key}`;
    try {
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
    } catch {}
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.4 } });
  }, [demo.key]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  const share = async () => {
    try {
      await navigator.share({ title: demo.name ?? 'Menu', url });
    } catch {}
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  if (demo.itemCount === 0) {
    return (
      <Shell step={2}>
        <div className="rounded-2xl border border-[#e8e8ea] bg-white p-6 text-center shadow-sm">
          <XCircleIcon className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="mt-2 text-lg font-semibold">No dishes found</h2>
          <p className="mt-1 text-sm text-[#6b6b70]">
            The photos didn’t show readable dishes and prices. Try again with the menu flat, in good light.
          </p>
          <button
            type="button"
            onClick={onRestart}
            className="mt-5 w-full rounded-xl bg-[#2e2e30] px-5 py-4 text-base font-semibold text-white"
          >
            Take new photos
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell step={2}>
      <div className="flex items-center gap-3">
        <CheckCircleIcon className="h-9 w-9 flex-none text-emerald-600" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight">{demo.name} is live</h1>
          <p className="text-sm text-[#6b6b70]">
            {demo.itemCount} dish{demo.itemCount === 1 ? '' : 'es'} in {demo.categoryCount} categor
            {demo.categoryCount === 1 ? 'y' : 'ies'} · Table {demo.table}
          </p>
        </div>
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2e2e30] px-5 py-4 text-base font-semibold text-white active:opacity-90"
      >
        Open storefront <ArrowTopRightOnSquareIcon className="h-5 w-5" />
      </a>

      <div className={`mt-3 grid gap-3 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={copy}
          className="flex items-center justify-center gap-2 rounded-xl border border-[#dbdbdb] bg-white px-4 py-3.5 text-sm font-medium active:bg-[#f3f3f3]"
        >
          <ClipboardDocumentIcon className="h-5 w-5" /> {copied ? 'Copied!' : 'Copy link'}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="flex items-center justify-center gap-2 rounded-xl border border-[#dbdbdb] bg-white px-4 py-3.5 text-sm font-medium active:bg-[#f3f3f3]"
          >
            <ShareIcon className="h-5 w-5" /> Share
          </button>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-[#e8e8ea] bg-white p-5 text-center shadow-sm">
        <p className="text-sm font-medium">Let the owner scan it with their phone</p>
        <div className="mx-auto mt-3 w-fit rounded-xl bg-white p-2">
          <QRCodeSVG value={url} size={208} level="M" marginSize={1} />
        </div>
        <p className="mt-3 break-all text-xs text-[#9a9aa0]">{url}</p>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[#6b6b70]">
        <ClockIcon className="h-4 w-4" /> Live until {untilLabel(demo.expiresAt)}, then deleted automatically
      </p>

      <button
        type="button"
        onClick={onRestart}
        className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl px-4 pt-8 text-sm font-medium text-[#6b6b70]"
      >
        <ArrowPathIcon className="h-4 w-4" /> Start a new demo
      </button>
    </Shell>
  );
}

function DemoStep({ demoKey }: { demoKey: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const restart = () => {
    rememberDemo(null);
    navigate('/quick-demo');
  };

  const query = useQuery({
    queryKey: ['quick-demo', demoKey],
    queryFn: () => getQuickDemo(demoKey),
    staleTime: 0,
    retry: (n, err) => !isDemoGone(err) && n < 3,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'reading' || s === 'building' ? 2000 : false;
    },
  });

  const rename = useMutation({
    mutationFn: (name: string) => nameQuickDemo(demoKey, name),
    onSuccess: (demo) => queryClient.setQueryData(['quick-demo', demoKey], demo),
  });

  useEffect(() => {
    if (query.data) rememberDemo(demoKey);
  }, [query.data, demoKey]);

  const demo = query.data;

  if (!demo) {
    if (query.isError) {
      const gone = isDemoGone(query.error);
      if (gone) rememberDemo(null);
      return (
        <Shell step={0}>
          <div className="rounded-2xl border border-[#e8e8ea] bg-white p-6 text-center shadow-sm">
            <XCircleIcon className="mx-auto h-10 w-10 text-[#9a9aa0]" />
            <h2 className="mt-2 text-lg font-semibold">{gone ? 'This demo has ended' : 'Couldn’t load the demo'}</h2>
            <p className="mt-1 text-sm text-[#6b6b70]">
              {gone ? 'Demos are deleted 24 hours after they’re made.' : demoErrorMessage(query.error)}
            </p>
            <button
              type="button"
              onClick={gone ? restart : () => void query.refetch()}
              className="mt-5 w-full rounded-xl bg-[#2e2e30] px-5 py-4 text-base font-semibold text-white"
            >
              {gone ? 'Start a new demo' : 'Try again'}
            </button>
          </div>
        </Shell>
      );
    }
    return (
      <Shell step={1}>
        <ProgressCard title="Loading…" pct={10} />
      </Shell>
    );
  }

  if (demo.status === 'ready') return <ReadyStep demo={demo} onRestart={restart} />;

  if (demo.status === 'failed') {
    return (
      <Shell step={1}>
        <div className="rounded-2xl border border-[#e8e8ea] bg-white p-6 text-center shadow-sm">
          <XCircleIcon className="mx-auto h-10 w-10 text-red-500" />
          <h2 className="mt-2 text-lg font-semibold">We couldn’t read this menu</h2>
          <p className="mt-1 text-sm text-[#6b6b70]">{demo.error}</p>
          <button
            type="button"
            onClick={restart}
            className="mt-5 w-full rounded-xl bg-[#2e2e30] px-5 py-4 text-base font-semibold text-white"
          >
            Take new photos
          </button>
        </div>
      </Shell>
    );
  }

  const { done, total } = demo.progress;
  const unit = demo.sourceType === 'photos' ? 'photo' : 'page';
  const reading = (
    <ProgressCard
      title={demo.status === 'building' ? 'Building the storefront…' : 'Reading the menu…'}
      subtitle={
        demo.status === 'building'
          ? 'Adding categories, dishes and tables'
          : `Dishes, prices and sizes · ${unit} ${Math.min(done + 1, total)} of ${total}`
      }
      pct={demo.status === 'building' ? 92 : 5 + (total ? (done / total) * 80 : 0)}
    />
  );

  // No name yet: ask for it while the AI reads
  if (!demo.name) {
    return (
      <Shell step={1}>
        <div className="space-y-4">
          {demo.status === 'needs-name' ? (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <CheckCircleIcon className="h-5 w-5 flex-none" /> Menu read — just the name left.
            </p>
          ) : (
            reading
          )}
          <NameForm initial="" saving={rename.isPending} saved={false} onSubmit={(n) => rename.mutate(n)} />
          {rename.isError && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {demoErrorMessage(rename.error)}
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell step={1}>
      <h1 className="mb-4 truncate text-xl font-bold">{demo.name}</h1>
      {reading}
      <p className="mt-4 text-center text-sm text-[#6b6b70]">
        This usually takes under a minute. The link appears here when it’s ready.
      </p>
    </Shell>
  );
}

export default function QuickDemoPage() {
  const { key } = useParams<{ key?: string }>();
  return key ? <DemoStep key={key} demoKey={key} /> : <StartStep />;
}
