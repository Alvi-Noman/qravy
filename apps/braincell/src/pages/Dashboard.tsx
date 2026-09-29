import { lazy, Suspense, useMemo, useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardDocumentListIcon,
  BellAlertIcon,
  Squares2X2Icon,
  ArrowPathIcon,
  DocumentArrowUpIcon,
  SparklesIcon,
  FolderPlusIcon,
  PlusIcon,
  ArrowUturnLeftIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../context/AuthContext';
import { getMenuItems } from '../api/menuItems';
import { getCategories } from '../api/categories';
import { getTenant } from '../api/tenant';
import type { TenantDTO } from '../../../../packages/shared/src/types/v1';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';


// Lazy load panels
const OrdersActivity = lazy(() => import('../components/Dashboard/OrdersActivity'));
const WaiterCalls = lazy(() => import('../components/Dashboard/WaiterCalls'));
const ChannelAvailability = lazy(() => import('../components/Dashboard/ChannelAvailability'));

/** Menu setup: upload a PDF or photos (real AI import), or build the menu manually. */
function OnboardingPanel() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'upload' | 'manual'>(() =>
    localStorage.getItem('menu-setup-mode') === 'manual' ? 'manual' : 'upload'
  );
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('menu-setup-mode', mode);
    window.dispatchEvent(new Event('menu-setup-mode-changed'));
  }, [mode]);

  /** Hands the files to the AI import page (PDF uploads at once; photos can be ordered first). */
  const startImport = (files: File[]) => {
    if (files.length) navigate('/menu-import', { state: { files } });
  };

  useEffect(() => {
    const handleAssistantFile = (e: Event) => {
      const file = (e as CustomEvent).detail?.file;
      if (file instanceof File) startImport([file]);
    };
    window.addEventListener('menu-file-selected', handleAssistantFile as EventListener);
    return () => window.removeEventListener('menu-file-selected', handleAssistantFile as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    startImport(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6 bg-transparent overflow-y-auto">
      <div className="w-full max-w-2xl relative">

        <AnimatePresence mode="wait">
          {mode === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col text-center"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-transparent text-indigo-600 mb-4">
                <SparklesIcon className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800">Build your menu using AI 🪄</h2>
              <p className="text-slate-500 text-sm mt-2 mb-6 max-w-md mx-auto">
                Upload a PDF or photos of your menu. AI organizes it into categories and items for you to review.
              </p>

              {/* Two Upload Options Side-by-Side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  className="group flex flex-col items-center p-8 rounded-xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md hover:border-slate-350 transition-all duration-200 text-center focus:outline-none w-full"
                >
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="h-12 w-12 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-slate-500 mb-4 group-hover:bg-slate-100 group-hover:text-slate-700 transition-colors">
                    <DocumentArrowUpIcon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Upload Menu PDF</span>
                  <span className="text-xs text-slate-400 mt-1.5 max-w-[180px] leading-normal">Upload your menu in PDF format (up to 50MB)</span>
                </button>

                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="group flex flex-col items-center p-8 rounded-xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md hover:border-slate-350 transition-all duration-200 text-center focus:outline-none w-full"
                >
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="h-12 w-12 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-slate-500 mb-4 group-hover:bg-slate-100 group-hover:text-slate-700 transition-colors">
                    <PhotoIcon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Upload Menu Photo</span>
                  <span className="text-xs text-slate-400 mt-1.5 max-w-[180px] leading-normal">Photos of your menu pages, one per page (up to 10 photos)</span>
                </button>
              </div>

              {/* Manual Switcher Link */}
              <div className="mt-8">
                <button
                  onClick={() => setMode('manual')}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600 underline underline-offset-4 transition-colors"
                >
                  Upload Menu Manually
                </button>
              </div>
            </motion.div>
          )}

          {mode === 'manual' && (
            <motion.div
              key="manual"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col text-center"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-600 ring-4 ring-slate-500/5 mb-4">
                <FolderPlusIcon className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800">Set up menu manually</h2>
              <p className="text-slate-500 text-sm mt-2 mb-8 max-w-md mx-auto">
                Add categories and menu items one by one using our manual creators.
              </p>

              {/* Manual Actions Side-by-Side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                <Link
                  to="/categories?new=category"
                  className="group flex flex-col items-center p-8 rounded-xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md hover:border-slate-350 transition-all duration-200 text-center focus:outline-none w-full"
                >
                  <div className="h-12 w-12 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-slate-500 mb-4 group-hover:bg-slate-100 group-hover:text-slate-700 transition-colors">
                    <FolderPlusIcon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Add Category</span>
                  <span className="text-xs text-slate-400 mt-1.5 max-w-[180px] leading-normal">Organize dishes into sections like Mains or Drinks.</span>
                </Link>

                <Link
                  to="/menu-items?new=product"
                  className="group flex flex-col items-center p-8 rounded-xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md hover:border-slate-350 transition-all duration-200 text-center focus:outline-none w-full"
                >
                  <div className="h-12 w-12 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-slate-500 mb-4 group-hover:bg-slate-100 group-hover:text-slate-700 transition-colors">
                    <PlusIcon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Add Menu Item</span>
                  <span className="text-xs text-slate-400 mt-1.5 max-w-[180px] leading-normal">Create dishes with prices, description, tags and photos.</span>
                </Link>
              </div>

              {/* Back to upload option */}
              <div className="mt-8">
                <button
                  onClick={() => setMode('upload')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 underline underline-offset-4 transition-colors"
                >
                  <ArrowUturnLeftIcon className="h-3 w-3" /> Back to AI Upload
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

export default function Dashboard(): JSX.Element {
  const { token } = useAuthContext();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showOrdersDialog, setShowOrdersDialog] = useState(false);
  const [showCallsDialog, setShowCallsDialog] = useState(false);


  // Tenant info query
  const tenantQuery = useQuery<TenantDTO>({
    queryKey: ['tenant', token],
    queryFn: () => getTenant(token as string),
    enabled: !!token,
  });

  // Menu + categories
  const menuQuery = useQuery({
    queryKey: ['menu-items', token],
    queryFn: () => getMenuItems(token as string),
    enabled: !!token,
    refetchInterval: autoRefresh ? 15000 : false,
  });
  const catQuery = useQuery({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
  });

  // Stats
  const stats = useMemo(() => {
    const items = menuQuery.data ?? [];
    const categories = catQuery.data ?? [];
    const active = items.filter((i: any) => i.status === 'active').length;
    const dineIn = items.filter((i: any) => i.visibility?.dineIn !== false).length;
    const online = items.filter((i: any) => i.visibility?.online !== false).length;
    return {
      totalProducts: items.length,
      activeProducts: active,
      totalCategories: categories.length,
      dineIn,
      online,
    };
  }, [menuQuery.data, catQuery.data]);

  // ----- UI states -----

  if (tenantQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#ececec] border-t-[#2e2e30]" />
          <p className="mt-3 text-sm text-[#6b6b70]">Loading dashboard...</p>
        </div>
      </div>
    );
  }
  if (tenantQuery.isError) return <div className="p-6 text-red-600">Failed to load tenant info.</div>;

  const tenant = tenantQuery.data;
  if (!tenant) return <div className="p-6 text-red-600">No tenant found.</div>;

  // 🚦 Show onboarding screen (first-time tenant, no data yet)
  if (!tenant.onboardingCompleted) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-center p-6">
        <h1 className="text-2xl font-semibold text-[#2e2e30] mb-3">
          Welcome to your Restaurant Dashboard 🍴
        </h1>
        <p className="text-[#6b6b70] mb-6 max-w-lg">
          Let’s get your account set up! Complete onboarding to start managing menu items,
          orders, and more.
        </p>
        <a
          href="/onboarding"
          className="rounded-md bg-[#2e2e30] text-white px-6 py-3 font-medium hover:opacity-90 transition"
        >
          Start Onboarding
        </a>
      </div>
    );
  }

  // 🟡 Enhancement: If tenant onboarded but has *no categories & no menu items* yet — show “getting started”
  if (!stats.totalProducts && !stats.totalCategories) {
    return (
      <OnboardingPanel />
    );
  }

  // ✅ Full dashboard UI
  return (
    <div className="flex h-full flex-col min-h-0 text-sm text-[#2e2e30]">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-[#ececec] px-6 bg-white/70 backdrop-blur-md"
        style={{ paddingTop: '16px', paddingBottom: '16px' }}
      >
        <h2 className="text-lg font-semibold text-[#2e2e30]">Dashboard</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => menuQuery.refetch()}
            className="flex items-center gap-2 rounded-md border border-[#cececec] px-3 py-1.5 hover:bg-[#f5f5f5]"
          >
            <ArrowPathIcon className="h-4 w-4" /> Refresh
          </button>
          <label className="flex items-center gap-2 text-xs text-[#6b6b70]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-[#cececec] text-indigo-600 focus:ring-indigo-500"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* KPI cards */}
        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="New Orders"
            subtitle="Live incoming"
            value="12"
            icon={<ClipboardDocumentListIcon className="h-6 w-6 text-indigo-500" />}
            onClick={() => setShowOrdersDialog(true)}
          />
          <KpiCard
            title="Waiter Calls"
            subtitle="Active requests"
            value="3"
            icon={<BellAlertIcon className="h-6 w-6 text-pink-500" />}
            onClick={() => setShowCallsDialog(true)}
          />
          <KpiCard
            title="Menu Items"
            subtitle="Active / Total"
            value={`${stats.activeProducts}/${stats.totalProducts}`}
            icon={<Squares2X2Icon className="h-6 w-6 text-slate-500" />}
          />
          <KpiCard
            title="Categories"
            subtitle="Organized menus"
            value={stats.totalCategories}
            icon={<Squares2X2Icon className="h-6 w-6 text-indigo-400" />}
          />
        </section>

        {/* Feeds */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Suspense fallback={<SkeletonBox />}>
            <OrdersActivity />
          </Suspense>
          <Suspense fallback={<SkeletonBox />}>
            <WaiterCalls />
          </Suspense>
        </section>

        {/* Channel Availability */}
        <section>
          <Suspense fallback={<SkeletonBox />}>
            <ChannelAvailability dineIn={stats.dineIn} online={stats.online} />
          </Suspense>
        </section>
      </div>

      {/* Dialog overlays */}
      {showOrdersDialog && (
        <Dialog title="Orders Breakdown" onClose={() => setShowOrdersDialog(false)}>
          <OrdersActivity />
        </Dialog>
      )}
      {showCallsDialog && (
        <Dialog title="Active Waiter Calls" onClose={() => setShowCallsDialog(false)}>
          <WaiterCalls />
        </Dialog>
      )}
    </div>
  );
}

// --- sub-components unchanged (KpiCard, SkeletonBox, Dialog) ---
function KpiCard({ title, subtitle, value, icon, onClick }: any) {
  return (
    <div
      className="flex flex-col rounded-lg border border-[#ececec] bg-white p-5 shadow-sm hover:shadow-lg cursor-pointer transition-all"
      onClick={onClick}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 ring-1 ring-[#ececec]">
          {icon}
        </div>
        <div>
          <div className="text-sm font-medium text-[#2e2e30]">{title}</div>
          {subtitle && <div className="text-xs text-[#6b6b70]">{subtitle}</div>}
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-[#2e2e30]">{value}</div>
    </div>
  );
}

function SkeletonBox() {
  return (
    <div className="h-64 w-full animate-pulse rounded-lg border border-[#ececec] bg-slate-100"></div>
  );
}

function Dialog({ title, children, onClose }: any) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-lg border border-[#ececec] bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 border border-[#cececec] hover:bg-[#f5f5f5]"
          >
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}