import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { DocumentTextIcon, ChartBarIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';

const mainItems = [
  { icon: <DocumentTextIcon className="w-5 h-5" />, label: 'Contracts' },
  { icon: <ChartBarIcon className="w-5 h-5" />, label: 'Analysts' },
  { icon: <Cog6ToothIcon className="w-5 h-5" />, label: 'Setting' },
];

export default function Sidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="flex flex-col h-full w-64 bg-[#f5f5f5] px-4 py-4">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-400 to-blue-400 flex items-center justify-center">
          <span className="text-white text-2xl font-bold">D</span>
        </div>
        <span className="text-xl font-bold text-[#2e2e30]">Dialin</span>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search"
          className="w-full px-3 py-2 rounded-lg bg-[#fcfcfc] text-[#2e2e30] border border-[#ececec] focus:outline-none focus:ring-2 focus:ring-[#e0e0e5]"
        />
      </div>

      {/* MAIN section, duplicated 3 times */}
      {[1, 2, 3].map((section) => (
        <div key={section} className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#b0b0b5' }}>
            MAIN
          </div>
          <ul className="space-y-1">
            {mainItems.map((item, idx) => (
              <li key={idx}>
                <a
                  href="#"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#ececec] text-[#2e2e30] transition"
                >
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="flex-1" />

      {/* Logout */}
      <div className="mb-2">
        <button
          onClick={handleLogout}
          className="w-full text-left text-[#2e2e30] hover:bg-[#ececec] px-3 py-2 rounded transition"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}