import { useState } from 'react';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import AIAssistantPanel from '../components/AIAssistantPanel';
import { Outlet } from 'react-router-dom';
import { ScopeProvider } from '../context/ScopeContext';

const AI_PANEL_WIDTH = 380;

export default function DashboardLayout(): JSX.Element {
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <ScopeProvider>
      <div className="flex h-screen bg-[#f5f5f5] overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 flex items-start justify-center bg-[#f5f5f5]">
          <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] min-h-0 min-w-0">
            <div
              className="h-full min-h-0 min-w-0 rounded-xl border border-[#ececec] bg-[#fcfcfc] overflow-hidden grid"
              style={{
                gridTemplateColumns: aiOpen ? `minmax(0,1fr) ${AI_PANEL_WIDTH}px` : 'minmax(0,1fr) 0px',
                transition: 'grid-template-columns 220ms ease',
              }}
            >
              {/* Left: app content (shrinks when AI opens) */}
              <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain" style={{ scrollbarGutter: 'stable' }}>
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