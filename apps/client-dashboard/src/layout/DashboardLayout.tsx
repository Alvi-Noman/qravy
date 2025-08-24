import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import { Outlet } from 'react-router-dom';
import { ScopeProvider } from '../context/ScopeContext';

/** App layout with sidebar and a card container. ScopeProvider wraps TopBar and content. */
export default function DashboardLayout(): JSX.Element {
  return (
    <ScopeProvider>
      <div className="flex h-screen bg-[#f5f5f5] overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 flex items-start justify-center bg-[#f5f5f5]">
          <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] min-h-0 min-w-0">
            <div className="h-full min-h-0 min-w-0 rounded-xl border border-[#ececec] bg-[#fcfcfc] flex flex-col overflow-hidden">
              <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain" style={{ scrollbarGutter: 'stable' }}>
                <TopBar />
                <div className="flex-1 min-h-0 min-w-0">
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