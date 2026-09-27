import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ScopeProvider } from '../context/ScopeContext';
import SettingsSidebar from '../components/SideBar/SettingsSidebar';

export default function SettingsLayout(): JSX.Element {
  const [panelReady, setPanelReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setPanelReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <ScopeProvider>
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Left Part: Settings Sidebar */}
        <div className="w-[280px] shrink-0 border-r border-[#ececec] h-full flex flex-col bg-white">
          <SettingsSidebar />
        </div>

        {/* Right Part: Scrollable Content Pane (greyish background) */}
        <main className="flex-1 min-w-0 bg-[#f6f6f7] overflow-y-auto overscroll-contain px-8 py-8 md:px-12">
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