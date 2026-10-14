import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
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
import HomeInsights from '../components/Dashboard/HomeInsights';



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

  const tenantQuery = useQuery<TenantDTO>({
    queryKey: ['tenant', token],
    queryFn: () => getTenant(token as string),
    enabled: !!token,
  });
  // a restaurant with no menu yet gets the menu setup instead of empty charts
  const menuQuery = useQuery({ queryKey: ['menu-items', token], queryFn: () => getMenuItems(token as string), enabled: !!token });
  const catQuery = useQuery({ queryKey: ['categories', token], queryFn: () => getCategories(token as string), enabled: !!token });

  // wait until we know whether there is a menu yet — otherwise the full dashboard flashes before the setup screen
  if (tenantQuery.isLoading || menuQuery.isLoading || catQuery.isLoading) {
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

  if (menuQuery.isSuccess && catQuery.isSuccess && !(menuQuery.data ?? []).length && !(catQuery.data ?? []).length) {
    return <OnboardingPanel />;
  }

  // guests, QR scans and dine-in vs online (the order queue and waiter calls live on Orders)
  return <HomeInsights />;
}
