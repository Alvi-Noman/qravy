import { useState, useEffect, lazy, Suspense } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import TopBar from '../components/topbar/TopBar';
import AIAssistantPanel from '../components/AIAssistantPanel';
import { ScopeProvider } from '../context/ScopeContext';
import { useAuthContext } from '../context/AuthContext';

// Trial UI
import TrialToast from '../components/billing/TrialToast';
import PaywallModal from '../components/billing/PaywallModal';
import { useTrial } from '../hooks/useTrial';

// NEW
import { useTenant } from '../hooks/useTenant';
import { planInfoFromId } from '../api/billing';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeTenant } from '../api/tenant'; // or '../api/tenants' if that’s your file

const Sidebar = lazy(() => import('../components/sidebar/Sidebar'));

const AI_PANEL_WIDTH = 380;

function SectionSkeleton({ rows = 6, headingWidth = 'w-24' }: { rows?: number; headingWidth?: string }) {
  return (
    <div className="mb-6">
      <div className={`mb-3 h-3 ${headingWidth} rounded bg-slate-200`} />
      <ul className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i}>
            <div className="group flex items-center gap-3 rounded-md border-l-4 border-transparent px-3 py-2.5">
              <div className="h-5 w-5 rounded bg-slate-200" />
              <div className="h-4 w-40 rounded bg-slate-200" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SidebarFallback() {
  return (
    <aside
      className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4 animate-pulse"
      aria-busy="true"
      aria-label="Loading sidebar"
    >
      {/* Brand */}
      <div className="mb-0 flex items-center">
        <div className="h-8 w-28 rounded bg-slate-200" />
      </div>

      {/* Branch selector */}
      <div className="mt-7 mb-6">
        <div className="flex w-full items-center justify-between rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <div className="h-5 w-5 rounded bg-slate-200" />
            <div className="h-4 w-32 rounded bg-slate-200" />
          </span>
          <span className="ml-2 grid h-5 w-5 place-items-center rounded-full bg-slate-100">
            <div className="h-3 w-3 rounded-full bg-slate-200" />
          </span>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto">
        <SectionSkeleton headingWidth="w-16" rows={10} />
        <SectionSkeleton headingWidth="w-20" rows={2} />
      </nav>
    </aside>
  );
}

export default function DashboardLayout(): JSX.Element {
  const [aiOpen, setAiOpen] = useState(false);
  const { user, loading, token } = useAuthContext();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Tenant + plan (from backend)
  const { data: tenant, isLoading: tenantLoading } = useTenant();
  const resolvedPlan = planInfoFromId(tenant?.planInfo?.planId);

  // Trial state — wired to backend via tenant
  const trial = useTrial(tenant);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // 🚨 Redirect guard: unify with Login + MagicLink
  if (!loading && user) {
    if (!user.tenantId && location.pathname !== '/create-restaurant') {
      return <Navigate to="/create-restaurant" replace />;
    }
    if (user.tenantId && location.pathname === '/create-restaurant') {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // ✅ Auto-open AI Assistant for first timers with a 1.5s delay
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ai-setup-steps');
      if (saved) {
        const parsed = JSON.parse(saved);
        const allDone =
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((s: any) => s.done);
        if (!allDone) {
          const timer = setTimeout(() => setAiOpen(true), 1500);
          return () => clearTimeout(timer);
        }
      } else {
        const timer = setTimeout(() => setAiOpen(true), 1500);
        return () => clearTimeout(timer);
      }
    } catch {
      const timer = setTimeout(() => setAiOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Derived subscription flag from backend
  const isSubscribed = tenant?.subscriptionStatus === 'active';

  // Open paywall immediately when trial expires and user is not subscribed
  useEffect(() => {
    if (trial.expired && !isSubscribed && !subscribing) setPaywallOpen(true);
  }, [trial.expired, isSubscribed, subscribing]);

  return (
    <ScopeProvider>
      <div className="flex h-screen bg-[#f5f5f5] overflow-hidden">
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar />
        </Suspense>

        <main className="flex-1 min-w-0 min-h-0 flex items-start justify-center bg-[#f5f5f5]">
          <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] min-h-0 min-w-0">
            <div
              className="h-full min-h-0 min-w-0 rounded-xl border border-[#ececec] bg-[#fcfcfc] overflow-hidden grid"
              style={{
                gridTemplateColumns: `minmax(0,1fr) ${aiOpen ? AI_PANEL_WIDTH : 0}px`,
                transition: 'grid-template-columns 300ms ease',
              }}
            >
              {/* Left: app content */}
              <div
                className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain"
                style={{ scrollbarGutter: 'stable' }}
              >
                <TopBar onAIClick={() => setAiOpen(true)} />
                <div className="flex-1 min-h-0 min-w-0">
                  <Outlet />
                </div>
              </div>

              {/* Right: AI panel */}
              <AIAssistantPanel open={aiOpen} onClose={() => setAiOpen(false)} width={AI_PANEL_WIDTH} />
            </div>
          </div>
        </main>
      </div>

      {/* Trial toast during trial, hidden if subscribed */}
      <TrialToast
        open={!trial.expired && !isSubscribed}
        daysLeft={trial.daysLeft}
        hoursLeft={trial.hoursLeft}
        onUpgrade={() => setPaywallOpen(true)}
        onCompare={() => setPaywallOpen(true)}
      />

      {/* Paywall — blocks app after trial ends and not subscribed */}
      <PaywallModal
        open={Boolean(paywallOpen && !tenantLoading && !isSubscribed)}
        allowClose={false}
        plan={{
          id: resolvedPlan.id,
          name: resolvedPlan.name,
          interval: resolvedPlan.interval,
          priceCents: resolvedPlan.priceCents,
          currency: resolvedPlan.currency as any,
        }}
        lineItems={[]}
        discountCents={0}
        taxRate={0}
        managePlanHref="/settings/plan/select"
        onSubscribe={async ({ name, cardToken, planId }) => {
          if (!token) return;

          setSubscribing(true);
          try {
            // 1) Call backend to activate subscription and end trial
            const updated = await subscribeTenant({ name, cardToken, planId }, token);

            // 2) Optimistically update tenant cache so isSubscribed flips immediately
            queryClient.setQueryData(['tenant', token], updated);

            // 3) Close modal
            setPaywallOpen(false);
          } catch (e) {
            console.error('Subscribe failed', e);
          } finally {
            setSubscribing(false);
          }
        }}
      />
    </ScopeProvider>
  );
}