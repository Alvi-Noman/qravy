import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { ScopeProvider } from '../context/ScopeContext';
import SettingsSidebar from '../components/SideBar/SettingsSidebar';

export default function SettingsLayout(): JSX.Element {
  const [panelReady, setPanelReady] = useState(false);
  // phones: the settings list is a drawer, closed again on every page change
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    const id = requestAnimationFrame(() => setPanelReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <ScopeProvider>
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Left Part: Settings Sidebar */}
        <div className="hidden w-[280px] shrink-0 border-r border-[#ececec] h-full md:flex flex-col bg-white">
          <SettingsSidebar />
        </div>

        {navOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Settings menu">
            <button
              type="button"
              aria-label="Close settings menu"
              className="absolute inset-0 bg-black/30"
              onClick={() => setNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-[85vw] max-w-[320px] flex-col bg-white shadow-xl">
              <SettingsSidebar />
            </div>
          </div>
        )}

        {/* Right Part: Scrollable Content Pane (greyish background) */}
        <main className="flex-1 min-w-0 bg-[#f6f6f7] overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-6 sm:py-6 md:px-12 md:py-8">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="mb-3 inline-flex items-center gap-2 rounded-lg border border-[#e2e2e2] bg-white px-3 py-2 text-[13px] font-medium text-slate-800 shadow-sm md:hidden"
          >
            <Bars3Icon className="h-5 w-5" aria-hidden="true" />
            Settings menu
          </button>
          <div
            style={{
              transition: panelReady ? 'opacity 0.001s linear' : 'none',
            }}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </ScopeProvider>
  );
}
