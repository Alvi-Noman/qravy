import { lazy, Suspense, useMemo, useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardDocumentListIcon,
  BellAlertIcon,
  Squares2X2Icon,
  ArrowPathIcon,
  DocumentArrowUpIcon,
  SparklesIcon,
  CheckCircleIcon,
  FolderPlusIcon,
  PlusIcon,
  ArrowUturnLeftIcon,
  ArrowUpTrayIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../context/AuthContext';
import { getMenuItems, createMenuItem } from '../api/menuItems';
import { getCategories, createCategory } from '../api/categories';
import { getTenant } from '../api/tenant';
import type { TenantDTO } from '../../../../packages/shared/src/types/v1';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';


// Lazy load panels
const OrdersActivity = lazy(() => import('../components/Dashboard/OrdersActivity'));
const WaiterCalls = lazy(() => import('../components/Dashboard/WaiterCalls'));
const ChannelAvailability = lazy(() => import('../components/Dashboard/ChannelAvailability'));

interface OnboardingPanelProps {
  token: string;
  queryClient: any;
}

const MOCK_PARSED_CATEGORIES = [
  { name: 'Appetizers' },
  { name: 'Mains' },
  { name: 'Drinks' },
];

const MOCK_PARSED_ITEMS = [
  {
    name: 'Crispy Onion Rings',
    price: 180,
    category: 'Appetizers',
    description: 'Hand-battered crispy golden rings served with signature dipping sauce.',
  },
  {
    name: 'Buffalo Chicken Wings',
    price: 340,
    category: 'Appetizers',
    description: 'Tossed in spicy cayenne pepper sauce and served with cool ranch.',
  },
  {
    name: 'Classic BBQ Beef Burger',
    price: 420,
    category: 'Mains',
    description: 'Flame-grilled patty, cheddar, crispy onion, and smokey house BBQ glaze.',
  },
  {
    name: 'Spicy Alfredo Pasta',
    price: 390,
    category: 'Mains',
    description: 'Penne pasta in creamy parmesan sauce with grilled chicken breast and red chili flakes.',
  },
  {
    name: 'Qravy Special Pizza',
    price: 680,
    category: 'Mains',
    description: 'Double pepperoni, loaded mozzarella, mushrooms, and house-made marinara sauce.',
  },
  {
    name: 'Fresh Lime Mint Soda',
    price: 120,
    category: 'Drinks',
    description: 'Refreshing squeeze of lime with fresh mint leaves and sparkling soda.',
  },
  {
    name: 'Creamy Cold Coffee',
    price: 160,
    category: 'Drinks',
    description: 'Rich espresso blended with chilled milk and a scoop of vanilla ice cream.',
  },
];

const PARSING_LOGS = [
  '🔍 Initiating document scan...',
  '📄 Extracting layout and text zones using OCR...',
  '⚡ Analyzing font weights and currency symbols...',
  '📂 Classifying categories: Appetizers, Mains, Drinks...',
  '🍔 Mapping menu item structures...',
  '💰 Extracting prices: verified 7 dishes & 3 sections...',
  '🪄 Structuring final menu catalog...',
];

function OnboardingPanel({ token, queryClient }: OnboardingPanelProps) {
  const [mode, setMode] = useState<'upload' | 'manual' | 'uploading' | 'parsing' | 'parsed'>(() => {
    const saved = localStorage.getItem('menu-setup-mode');
    if (saved === 'manual') return 'manual';
    return 'upload';
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentLogIndex, setCurrentLogIndex] = useState(0);
  const [activeLogs, setActiveLogs] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'upload' || mode === 'manual') {
      localStorage.setItem('menu-setup-mode', mode);
      window.dispatchEvent(new Event('menu-setup-mode-changed'));
    }
  }, [mode]);

  useEffect(() => {
    const handleAssistantFile = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.file) {
        startProcessing(customEvent.detail.file);
      }
    };
    window.addEventListener('menu-file-selected', handleAssistantFile as EventListener);
    return () => window.removeEventListener('menu-file-selected', handleAssistantFile as EventListener);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      startProcessing(e.target.files[0]);
    }
  };

  const startProcessing = (selectedFile: File) => {
    setFile(selectedFile);
    setMode('uploading');
    setUploadProgress(0);
  };

  // Upload simulation progress
  useEffect(() => {
    if (mode !== 'uploading') return;
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setMode('parsing');
            setCurrentLogIndex(0);
            setActiveLogs([]);
          }, 300);
          return 100;
        }
        return prev + 5;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [mode]);

  // AI parsing logs simulation
  useEffect(() => {
    if (mode !== 'parsing') return;
    if (currentLogIndex >= PARSING_LOGS.length) {
      const timer = setTimeout(() => {
        setMode('parsed');
      }, 800);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setActiveLogs((prev) => [...prev, PARSING_LOGS[currentLogIndex]]);
      setCurrentLogIndex((prev) => prev + 1);
    }, 700);

    return () => clearTimeout(timer);
  }, [mode, currentLogIndex]);

  // Database Seeding Logic
  const handleImport = async () => {
    setIsImporting(true);
    setImportError(null);
    try {
      // 1. Fetch existing categories
      const existing = await getCategories(token);
      const existingMap: Record<string, string> = {};
      existing.forEach((c: any) => {
        existingMap[c.name] = c._id || c.id;
      });

      // 2. Create missing categories
      const createdCats: Record<string, string> = {};
      for (const cat of MOCK_PARSED_CATEGORIES) {
        if (existingMap[cat.name]) {
          createdCats[cat.name] = existingMap[cat.name];
        } else {
          const res = await createCategory(cat.name, token);
          const catId = (res as any)._id || (res as any).id;
          if (catId) {
            createdCats[cat.name] = catId;
          }
        }
      }

      // 3. Create items
      for (const item of MOCK_PARSED_ITEMS) {
        const catId = createdCats[item.category];
        await createMenuItem(
          {
            name: item.name,
            price: item.price,
            description: item.description,
            category: item.category,
            categoryId: catId,
            status: 'active',
          },
          token
        );
      }

      // Trigger Confetti
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#4f46e5', '#ec4899', '#10b981', '#3b82f6'],
      });

      // Refresh Dashboard Queries
      setTimeout(async () => {
        await queryClient.invalidateQueries({ queryKey: ['categories'] });
        await queryClient.invalidateQueries({ queryKey: ['menu-items'] });
        await queryClient.invalidateQueries({ queryKey: ['tenant'] });
      }, 1000);
    } catch (err: any) {
      setImportError(err?.message || 'Failed to import menu items. Please try again.');
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setUploadProgress(0);
    setActiveLogs([]);
    setCurrentLogIndex(0);
    setMode('upload');
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
                Upload a picture or PDF of your menu, and our AI scanner will parse everything in seconds.
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
                  <span className="text-xs text-slate-400 mt-1.5 max-w-[180px] leading-normal">Upload your menu in PDF format (up to 10MB)</span>
                </button>

                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="group flex flex-col items-center p-8 rounded-xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md hover:border-slate-350 transition-all duration-200 text-center focus:outline-none w-full"
                >
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="h-12 w-12 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-slate-500 mb-4 group-hover:bg-slate-100 group-hover:text-slate-700 transition-colors">
                    <PhotoIcon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Upload Menu Photo</span>
                  <span className="text-xs text-slate-400 mt-1.5 max-w-[180px] leading-normal">Upload a picture or screenshot of your menu (up to 10MB)</span>
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

          {mode === 'uploading' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: -15 }}
              className="flex flex-col text-center py-6"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 animate-bounce mb-4">
                <ArrowUpTrayIcon className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Uploading your menu...</h2>
              <p className="text-xs text-slate-400 mt-1 truncate max-w-sm mx-auto">
                {file?.name} ({(file ? file.size / (1024 * 1024) : 0).toFixed(2)} MB)
              </p>

              {/* Progress Container */}
              <div className="w-full max-w-xs mx-auto mt-6 bg-slate-100 rounded-full h-2 overflow-hidden">
                <motion.div
                  className="bg-indigo-600 h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ ease: 'easeOut' }}
                />
              </div>
              <span className="text-xs font-bold text-indigo-600 mt-2">{uploadProgress}%</span>
            </motion.div>
          )}

          {mode === 'parsing' && (
            <motion.div
              key="parsing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col text-center"
            >
              <div className="relative mx-auto flex h-14 w-14 items-center justify-center mb-4">
                <div className="absolute inset-0 rounded-2xl border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
                <SparklesIcon className="h-6 w-6 text-indigo-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Structuring with AI Scanner</h2>
              <p className="text-xs text-slate-400 mt-1">Analyzing text blocks and matching pricing structure...</p>

              {/* Terminal Logs Box */}
              <div className="mt-6 mx-auto w-full max-w-md bg-slate-900 rounded-2xl p-5 text-left font-mono text-xs text-emerald-400 border border-slate-800 shadow-inner min-h-[160px] flex flex-col justify-start gap-2">
                <AnimatePresence>
                  {activeLogs.map((log, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="leading-relaxed"
                    >
                      {log}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {currentLogIndex < PARSING_LOGS.length && (
                  <span className="inline-block animate-pulse w-2 h-4 bg-emerald-400 ml-1 mt-0.5" />
                )}
              </div>
            </motion.div>
          )}

          {mode === 'parsed' && (
            <motion.div
              key="parsed"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col text-left"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircleIcon className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Menu Successfully Scanned!</h2>
                  <p className="text-xs text-slate-400">Found {MOCK_PARSED_CATEGORIES.length} categories and {MOCK_PARSED_ITEMS.length} dishes.</p>
                </div>
              </div>

              {/* Categorized Menu Preview */}
              <div className="mt-4 border border-slate-200 bg-slate-50/50 rounded-2xl p-5 max-h-[280px] overflow-y-auto space-y-4">
                {MOCK_PARSED_CATEGORIES.map((cat) => {
                  const catItems = MOCK_PARSED_ITEMS.filter((i) => i.category === cat.name);
                  return (
                    <div key={cat.name} className="space-y-2">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{cat.name}</h3>
                      <div className="divide-y divide-slate-100 bg-white border border-slate-100 rounded-xl px-3 py-1">
                        {catItems.map((item) => (
                          <div key={item.name} className="flex justify-between py-2 text-xs">
                            <div className="pr-4">
                              <span className="font-semibold text-slate-700 block">{item.name}</span>
                              <span className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{item.description}</span>
                            </div>
                            <span className="font-bold text-indigo-600 shrink-0">৳{item.price}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {importError && (
                <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">
                  {importError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={handleReset}
                  disabled={isImporting}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className={`px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition ${
                    isImporting ? 'cursor-wait opacity-80' : ''
                  }`}
                >
                  {isImporting ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1" />
                      Importing Menu...
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="h-4 w-4" /> Import Menu & Go Live
                    </>
                  )}
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
  const queryClient = useQueryClient();
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
      <OnboardingPanel token={token as string} queryClient={queryClient} />
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