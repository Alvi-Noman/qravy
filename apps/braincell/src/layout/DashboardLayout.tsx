import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import TopBar from '../components/TopBar/TopBar';
import AIAssistantPanel from '../components/AIAssistantPanel';
import { useAuthContext } from '../context/AuthContext';

// Trial UI
import TrialToast from '../components/billing/TrialToast';
import PaywallModal from '../components/billing/PaywallModal';
import { useTrial } from '../hooks/useTrial';

// NEW
import { useTenant } from '../hooks/useTenant';
import { planInfoFromId } from '../api/billing';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeAndSaveBilling } from '../api/tenant';

const Sidebar = lazy(() => import('../components/SideBar/Sidebar'));

const AI_PANEL_WIDTH = 380;

function SidebarFallback() {
  return (
    <aside
      className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4 animate-pulse"
      aria-busy="true"
      aria-label="Loading sidebar"
    >
      <div className="mb-0 flex items-center">
        <div className="h-8 w-28 rounded bg-slate-200" />
      </div>
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
      <nav className="flex-1 overflow-y-auto">
        <div className="mb-6">
          <div className="mb-3 h-3 w-16 rounded bg-slate-200" />
          <ul className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i}>
                <div className="group flex items-center gap-3 rounded-md border-l-4 border-transparent px-3 py-2.5">
                  <div className="h-5 w-5 rounded bg-slate-200" />
                  <div className="h-4 w-40 rounded bg-slate-200" />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="mb-6">
          <div className="mb-3 h-3 w-20 rounded bg-slate-200" />
          <ul className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i}>
                <div className="group flex items-center gap-3 rounded-md border-l-4 border-transparent px-3 py-2.5">
                  <div className="h-5 w-5 rounded bg-slate-200" />
                  <div className="h-4 w-40 rounded bg-slate-200" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </aside>
  );
}

export default function DashboardLayout(): JSX.Element {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDismissed, setAiDismissed] = useState(false); // remember user closed the panel
  const { user, loading, token } = useAuthContext();
  const location = useLocation();
  const queryClient = useQueryClient();
  const prevPathRef = useRef(location.pathname);

  // One-time paywall suppression (e.g., after successful subscribe)
  const [skipPaywallOnce, setSkipPaywallOnce] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('skipPaywallOnce') === '1';
    } catch {
      return false;
    }
  });

  // Tenant + plan (from backend)
  const { data: tenant, isLoading: tenantLoading } = useTenant();
  const resolvedPlan = planInfoFromId(tenant?.planInfo?.planId);

  // Trial state — wired to backend via tenant
  const trial = useTrial(tenant);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Redirects
  if (!loading && user) {
    if (!user.tenantId && location.pathname !== '/create-restaurant') {
      return <Navigate to="/create-restaurant" replace />;
    }
    if (user.tenantId && location.pathname === '/create-restaurant') {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // Auto-open AI panel for new users (based on server progress) after 1.5s.
  useEffect(() => {
    if (tenantLoading || aiDismissed) return; // don't reopen if user dismissed
    const hasCat = !!tenant?.onboardingProgress?.hasCategory;
    const hasItem = !!tenant?.onboardingProgress?.hasMenuItem;
    if (!hasCat || !hasItem) {
      const t = setTimeout(() => setAiOpen(true), 1500);
      return () => clearTimeout(t);
    }
  }, [
    tenantLoading,
    tenant?.onboardingProgress?.hasCategory,
    tenant?.onboardingProgress?.hasMenuItem,
    aiDismissed,
  ]);

  // Derived flags
  const isSubscribed = (tenant?.subscriptionStatus ?? '').toLowerCase() === 'active';
  const isCanceled = !isSubscribed && !!(tenant?.cancelEffectiveAt || tenant?.cancelRequestedAt);
  const endedAt = tenant?.cancelEffectiveAt ?? tenant?.trialEndsAt ?? undefined;
  const hasCard = !!tenant?.hasCardOnFile;

  // Show trial toast if trial ongoing and not subscribed
  const showTrialToast = !!tenant && !tenantLoading && !isSubscribed && !trial.expired;

  // Open paywall when trial ends OR when plan is canceled (immediate)
  useEffect(() => {
    if (
      !tenantLoading &&
      !isSubscribed &&
      (trial.expired || isCanceled) &&
      !subscribing &&
      !skipPaywallOnce
    ) {
      setPaywallOpen(true);
    }
  }, [tenantLoading, isSubscribed, trial.expired, isCanceled, subscribing, skipPaywallOnce]);

  // Clear the one-time suppression shortly after landing
  useEffect(() => {
    if (!skipPaywallOnce) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem('skipPaywallOnce');
      } catch {}
      setSkipPaywallOnce(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [skipPaywallOnce]);

  // If user returns from /settings/plan*, force-refresh tenant once so subscription state is fresh
  useEffect(() => {
    const prev = prevPathRef.current;
    const wasPlan = prev.startsWith('/settings/plan');
    const nowPlan = location.pathname.startsWith('/settings/plan');
    if (wasPlan && !nowPlan) {
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tenant',
      });
    }
    prevPathRef.current = location.pathname;
  }, [location.pathname, queryClient]);

  return (
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
            {/* Left */}
            <div
              className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain"
              style={{ scrollbarGutter: 'stable' }}
            >
              <TopBar onAIClick={() => { setAiDismissed(false); setAiOpen(true); }} />
              <div className="flex-1 min-h-0 min-w-0">
                <Outlet />
              </div>
            </div>

            {/* Right */}
            <AIAssistantPanel
              open={aiOpen}
              onClose={() => { setAiDismissed(true); setAiOpen(false); }}
              onRequestOpen={() => { if (!aiDismissed) setAiOpen(true); }} // allow auto-open unless dismissed
              width={AI_PANEL_WIDTH}
            />
          </div>
        </div>
      </main>

      {/* Trial toast (shifts left when AI panel is open) */}
      <TrialToast
        open={showTrialToast}
        daysLeft={trial.daysLeft ?? 0}
        hoursLeft={trial.hoursLeft ?? 0}
        onUpgrade={() => setPaywallOpen(true)}
        onCompare={() => setPaywallOpen(true)}
        offsetRight={aiOpen ? AI_PANEL_WIDTH + 20 : 20}
      />

      {/* Paywall */}
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
        // Optional: keep tracking origin if you use it elsewhere
        managePlanHref="/settings/plan/select?step=select&from=paywall"
        endedAt={endedAt}
        hasCardOnFile={hasCard}
        onSubscribe={async ({ name, cardToken, planId, billing, brand, last4, expMonth, expYear }) => {
          if (!token) return;
          setSubscribing(true);
          try {
            const updated = await subscribeAndSaveBilling(
              {
                name,
                cardToken,
                planId,
                payment: {
                  provider: 'mock',
                  brand: (brand ?? 'unknown') as any,
                  last4,
                  expMonth,
                  expYear,
                },
              },
              billing ?? {
                companyName: tenant?.name || '—',
                billingEmail: user?.email || '—',
                address: {
                  line1: '',
                  city: '',
                  state: '',
                  postalCode: '',
                  country: 'US',
                },
              },
              token
            );
            // Update tenant cache so UI flips to active immediately
            queryClient.setQueryData(['tenant', token], updated);
            await queryClient.invalidateQueries({
              predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tenant',
            });
            setPaywallOpen(false);
          } catch (e) {
            console.error('Subscribe failed', e);
          } finally {
            setSubscribing(false);
          }
        }}
      />
    </div>
  );
}
