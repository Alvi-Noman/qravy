import Sidebar from '../components/Sidebar';
import { Outlet } from 'react-router-dom';

export default function DashboardLayout() {
  return (
    <div className="flex h-screen bg-[#f5f5f5]">
      <Sidebar />
      <main className="flex-1 flex items-start justify-center bg-[#f5f5f5]">
        <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)]">
          <div className="bg-[#fcfcfc] rounded-xl border border-[#ececec] h-full overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}