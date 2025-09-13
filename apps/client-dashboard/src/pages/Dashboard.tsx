import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardDocumentListIcon,
  BellAlertIcon,
  Squares2X2Icon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../context/AuthContext';
import { getMenuItems } from '../api/menu';
import { getCategories } from '../api/categories';

// Lazy loaded panels
const OrdersActivity = lazy(() => import('../components/Dashboard/OrdersActivity'));
const WaiterCalls = lazy(() => import('../components/Dashboard/WaiterCalls'));
const ChannelAvailability = lazy(() => import('../components/Dashboard/ChannelAvailability'));

export default function Dashboard(): JSX.Element {
  const { token } = useAuthContext();
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 🔁 Auto-refresh every 15s if enabled
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

  // 🚀 Interactivity: Dialog openers for drills
  const [showOrdersDialog, setShowOrdersDialog] = useState(false);
  const [showCallsDialog, setShowCallsDialog] = useState(false);

  return (
    <div className="flex h-full flex-col min-h-0 text-sm text-[#2e2e30]">
      {/* Header Row */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-[#ececec] px-6 bg-white/70 backdrop-blur-md"
        style={{ paddingTop: '16px', paddingBottom: '16px' }}
      >
        <h2 className="text-lg font-semibold text-[#2e2e30]">
          Dashboard
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => menuQuery.refetch()}
            className="flex items-center gap-2 rounded-md border border-[#cecece] px-3 py-1.5 hover:bg-[#f5f5f5]"
          >
            <ArrowPathIcon className="h-4 w-4" /> Refresh
          </button>
          <label className="flex items-center gap-2 text-xs text-[#6b6b70]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-[#cecece] text-indigo-600 focus:ring-indigo-500"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* KPI Cards */}
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

        {/* Operational feeds */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Suspense fallback={<SkeletonBox />}>
            <OrdersActivity />
          </Suspense>
          <Suspense fallback={<SkeletonBox />}>
            <WaiterCalls />
          </Suspense>
        </section>

        {/* Channel Availability Panel */}
        <section>
          <Suspense fallback={<SkeletonBox />}>
            <ChannelAvailability dineIn={stats.dineIn} online={stats.online} />
          </Suspense>
        </section>
      </div>

      {/* Dialog overlays for KPI drills */}
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

function KpiCard({
  title,
  subtitle,
  value,
  icon,
  onClick,
}: {
  title: string;
  subtitle?: string;
  value: number | string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
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

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative w-full max-w-3xl rounded-lg border border-[#ececec] bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 border border-[#cecece] hover:bg-[#f5f5f5]"
          >
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}