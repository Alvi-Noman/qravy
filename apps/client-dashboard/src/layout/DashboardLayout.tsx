// apps/client-dashboard/src/layout/DashboardLayout.tsx
import { useState, lazy, Suspense } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import TopBar from '../components/TopBar/TopBar';
import AIAssistantPanel from '../components/AIAssistantPanel';
import { ScopeProvider } from '../context/ScopeContext';
import { useAuthContext } from '../context/AuthContext';

const Sidebar = lazy(() => import('../components/SideBar/Sidebar'));

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
  const { user, loading } = useAuthContext();
  const location = useLocation();

  // 🚨 Redirect guard: unify with Login + MagicLink
  if (!loading && user) {
    if (!user.tenantId && location.pathname !== '/create-restaurant') {
      return <Navigate to="/create-restaurant" replace />;
    }
    if (user.tenantId && location.pathname === '/create-restaurant') {
      return <Navigate to="/dashboard" replace />;
    }
  }

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
                gridTemplateColumns: aiOpen ? `minmax(0,1fr) ${AI_PANEL_WIDTH}px` : 'minmax(0,1fr) 0px',
                transition: 'grid-template-columns 220ms ease',
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
    </ScopeProvider>
  );
}