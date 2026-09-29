/**
 * MenuImport.tsx
 *
 * AI menu import: upload a PDF or photos → AI extracts categories & items → review/edit → import.
 *   /menu-import        upload (also accepts files via router state from the Dashboard)
 *   /menu-import/:id    processing / review / result for one import
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { ArrowLeftIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import {
  commitMenuImport,
  getMenuImport,
  importErrorMessage,
  listMenuImports,
  uploadMenuFiles,
  type DraftMenu,
  type MenuImport,
} from '../api/menuImports';
import { useScope } from '../context/ScopeContext';
import MenuFileDropzone from '../components/menu-import/MenuFileDropzone';
import ImportProgress from '../components/menu-import/ImportProgress';
import DraftReview from '../components/menu-import/DraftReview';
import { toastError } from '../components/Toaster';

function broadcastMenuChanged() {
  try {
    window.dispatchEvent(new CustomEvent('categories:updated'));
    window.dispatchEvent(new CustomEvent('menu:updated'));
    const BC = (window as any).BroadcastChannel;
    if (BC) {
      for (const name of ['categories', 'menu']) {
        const c = new BC(name);
        c.postMessage({ type: 'updated', at: Date.now() });
        c.close?.();
      }
    }
    localStorage.setItem('categories:updated', String(Date.now()));
    localStorage.setItem('menu:updated', String(Date.now()));
  } catch {}
}

const STATUS_LABEL: Record<MenuImport['status'], string> = {
  processing: 'Reading…',
  ready: 'Ready to review',
  failed: 'Failed',
  committing: 'Importing…',
  committed: 'Imported',
};

function UploadStep() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeLocationId } = useScope();
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const { data: recent = [] } = useQuery({
    queryKey: ['menu-imports'],
    queryFn: listMenuImports,
    staleTime: 10_000,
  });

  // Branch to import into: handed over by "add location", else the active branch (or all)
  const [targetLocationId, setTargetLocationId] = useState<string | null>(null);

  const start = async (files: File[]) => {
    setError(null);
    setPct(0);
    try {
      const job = await uploadMenuFiles(files, {
        locationId: targetLocationId ?? activeLocationId,
        onProgress: setPct,
      });
      navigate(`/menu-import/${job.id}`, { replace: true });
    } catch (err) {
      setPct(null);
      setError(importErrorMessage(err, 'Upload failed. Please try again.'));
    }
  };

  // Files handed over from the Dashboard onboarding panel
  const [handedPhotos, setHandedPhotos] = useState<File[] | null>(null);
  useEffect(() => {
    const st = location.state as { file?: unknown; files?: unknown; locationId?: unknown } | null;
    if (typeof st?.locationId === 'string') setTargetLocationId(st.locationId);
    const files = [
      ...(st?.file instanceof File ? [st.file] : []),
      ...(Array.isArray(st?.files) ? st!.files.filter((f): f is File => f instanceof File) : []),
    ];
    if (started.current || !files.length) return;
    started.current = true;
    navigate(location.pathname, { replace: true, state: null });
    // A PDF starts right away; photos are shown so the owner can check their order
    if (files.length === 1 && /pdf$/i.test(files[0].type || files[0].name)) void start(files);
    else setHandedPhotos(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pct !== null) {
    return <ImportProgress title="Uploading your menu…" done={pct} total={100} />;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <MenuFileDropzone key={handedPhotos ? 'handed' : 'empty'} onSubmit={start} initialFiles={handedPhotos ?? undefined} />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <ul className="mt-6 space-y-1.5 text-sm text-[#6b6b70]">
        <li>• Upload a PDF, or photos of each menu page taken with your phone.</li>
        <li>• Sections become categories; dishes become menu items with descriptions, prices and compare-at prices.</li>
        <li>• Size or portion price columns (S/M/L, Half/Full…) become variations automatically.</li>
        <li>• Nothing is added to your menu until you review it and click Import.</li>
      </ul>

      {recent.length > 0 && (
        <div className="mt-10">
          <h4 className="mb-2 text-sm font-semibold text-[#2e2e30]">Recent imports</h4>
          <ul className="divide-y divide-[#f0f0f0] rounded-xl border border-[#e5e5e5] bg-white">
            {recent.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link
                  to={`/menu-import/${r.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-[#fafafa]"
                >
                  <span className="truncate text-[#2e2e30]">{r.fileName}</span>
                  <span className="ml-4 flex-none text-xs text-[#6b6b70]">
                    {STATUS_LABEL[r.status]} · {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ResultStep({ job }: { job: MenuImport }) {
  const r = job.result;
  if (!r) return null;
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-[#e5e5e5] bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <CheckCircleIcon className="h-8 w-8 text-emerald-600" />
        <div>
          <h3 className="text-lg font-semibold text-[#2e2e30]">Menu imported</h3>
          <p className="text-sm text-[#6b6b70]">{job.fileName}</p>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        {(
          [
            ['New categories', r.categoriesCreated],
            ['Merged categories', r.categoriesMerged],
            ['Items added', r.itemsCreated],
            ['Items updated', r.itemsUpdated],
            ['Items skipped', r.itemsSkipped],
            ['Errors', r.errors.length],
          ] as Array<[string, number]>
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-[#fafafa] p-3">
            <dt className="text-xs text-[#6b6b70]">{k}</dt>
            <dd className={`text-xl font-semibold ${k === 'Errors' && v ? 'text-red-600' : 'text-[#2e2e30]'}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {r.errors.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold text-[#2e2e30]">These items were not imported</h4>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-lg border border-red-100 bg-red-50 p-3 text-sm">
            {r.errors.map((e) => (
              <li key={e.tempId} className="text-red-700">
                <span className="font-medium">{e.name}</span> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/menu-items" className="rounded-md bg-[#2e2e30] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
          Go to menu items
        </Link>
        <Link
          to="/menu-import"
          className="rounded-md border border-[#dbdbdb] px-5 py-2.5 text-sm font-medium text-[#2e2e30] hover:bg-[#f6f6f6]"
        >
          Import another menu
        </Link>
      </div>
    </div>
  );
}

function JobStep({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['menu-import', id],
    queryFn: () => getMenuImport(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'processing' || s === 'committing' ? 2000 : false;
    },
    refetchOnWindowFocus: false,
  });

  const commit = useMutation({
    mutationFn: (draft: DraftMenu) => commitMenuImport(id, draft),
    onSuccess: async (job) => {
      queryClient.setQueryData(['menu-import', id], job);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-items'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
        queryClient.invalidateQueries({ queryKey: ['tenant'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-imports'] }),
      ]);
      broadcastMenuChanged();
      if (job.result && job.result.itemsCreated + job.result.itemsUpdated > 0) {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }
    },
    onError: (err) => {
      toastError(importErrorMessage(err, 'Import failed. Please try again.'));
      void query.refetch();
    },
  });

  const job = query.data;
  if (query.isLoading) return <ImportProgress title="Loading…" done={0} total={1} />;
  if (query.isError || !job) {
    return (
      <div className="mx-auto max-w-xl text-center text-sm text-red-600">
        {importErrorMessage(query.error, 'Import not found.')}{' '}
        <Link to="/menu-import" className="underline">
          Start over
        </Link>
      </div>
    );
  }

  switch (job.status) {
    case 'processing':
      return (
        <ImportProgress
          title="Reading your menu…"
          subtitle={`Detecting categories, items, prices and variations · ${
            job.sourceType === 'photos' ? 'photo' : 'page'
          } ${Math.min(job.progress.done, job.progress.total)} of ${job.progress.total}. This usually takes under a minute.`}
          done={job.progress.done}
          total={job.progress.total}
        />
      );
    case 'committing':
      return <ImportProgress title="Adding items to your menu…" done={1} total={2} />;
    case 'failed':
      return (
        <div className="mx-auto max-w-xl rounded-xl border border-[#e5e5e5] bg-white p-8 text-center shadow-sm">
          <XCircleIcon className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <h3 className="text-lg font-semibold text-[#2e2e30]">We couldn’t import this menu</h3>
          <p className="mt-1 text-sm text-[#6b6b70]">{job.error || 'Something went wrong.'}</p>
          <button
            type="button"
            onClick={() => navigate('/menu-import')}
            className="mt-6 rounded-md bg-[#2e2e30] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Try another file
          </button>
        </div>
      );
    case 'committed':
      return <ResultStep job={job} />;
    case 'ready':
      return (
        <DraftReview
          key={job.id}
          job={job}
          committing={commit.isPending}
          onCommit={(draft) => commit.mutate(draft)}
          onStartOver={() => navigate('/menu-import')}
        />
      );
  }
}

export default function MenuImportPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="px-6 py-5">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/menu-items" className="rounded-md p-1.5 text-[#6b6b70] hover:bg-[#f0f0f0]" aria-label="Back to menu items">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-lg font-semibold text-[#2e2e30]">Import menu</h2>
          <p className="text-sm text-[#6b6b70]">AI reads your menu and organizes it into categories and items.</p>
        </div>
      </div>
      {id ? <JobStep id={id} /> : <UploadStep />}
    </div>
  );
}
