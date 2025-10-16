import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import TopBar from '../components/TopBar/TopBar';
import { ScopeProvider } from '../context/ScopeContext';
import SettingsSidebar from '../components/SideBar/SettingsSidebar';

export default function SettingsLayout(): JSX.Element {
  // Disable any container transition on first paint (future-proof if you add one)
  const [panelReady, setPanelReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setPanelReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <ScopeProvider>
      <div className="flex h-screen bg-[#f5f5f5] overflow-hidden">
        {/* Left: Settings sidebar (outside panel). Ensure it never shrinks */}
        <div className="shrink-0">
          <SettingsSidebar />
        </div>

        {/* Right: panel with TopBar and content */}
        <main className="flex-1 min-w-0 min-h-0 flex items-start justify-center bg-[#f5f5f5]">
          <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] min-h-0 min-w-0">
            <div
              className="h-full min-h-0 min-w-0 rounded-xl border border-[#ececec] bg-[#fcfcfc] overflow-hidden grid"
              style={{
                // No grid column transitions here, but keep switchable after mount if needed
                transition: panelReady ? 'opacity 0.001s linear' : 'none',
              }}
            >
              <div
                className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain"
                style={{ scrollbarGutter: 'stable' }}
              >
                <TopBar />
                <div className="flex-1 min-h-0 min-w-0 p-6">
                  <Outlet />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </ScopeProvider>
  );
}