import { NavLink } from 'react-router-dom';
import BottomProfileMenu from './BottomProfileMenu';

export default function Sidebar() {
  const sections: {
    heading: string;
    items: { name: string; to: string }[];
  }[] = [
    {
      heading: 'Dashboard',
      items: [
        { name: 'Orders', to: '/dashboard/orders' },
        { name: 'Assistance', to: '/dashboard/assistance' },
        { name: 'Menu Items', to: '/dashboard/menu-items' },
        { name: 'Categories', to: '/dashboard/categories' },
      ],
    },
    {
      heading: 'Diner View',
      items: [
        { name: 'Online Store', to: '/dashboard/online-store' },
        { name: 'Offers', to: '/dashboard/offers' },
        { name: 'QR Code', to: '/dashboard/qr-code' },
      ],
    },
    {
      heading: 'Reports',
      items: [{ name: 'Menu Performance', to: '/dashboard/reports/menu-performance' }],
    },
  ];

  const linkClass = (isActive: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg transition text-[#2e2e30] ${
      isActive ? 'bg-[#ececec] font-semibold' : 'hover:bg-[#ececec]'
    }`;

  return (
    <aside className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4">
      {/* Logo */}
      <div className="mb-6 flex items-center">
        <img
          src="/qravy-logo-250X100.png"
          alt="Qravy Logo"
          className="h-10 w-auto"
          style={{ maxWidth: 140, objectFit: 'contain' }}
        />
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search"
          className="w-full rounded-lg border border-[#ececec] bg-[#fcfcfc] px-3 py-2 text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e0e0e5]"
        />
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.heading} className="mb-6">
            <div
              className="mb-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: '#b0b0b5' }}
            >
              {section.heading}
            </div>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={({ isActive }) => linkClass(isActive)}>
                    <span className="font-medium">{item.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom profile menu (drop-up) */}
      <BottomProfileMenu
        logoUrl="/qravy-icon-200X200.png"
        restaurantName="Your Restaurant"
        // restaurantEmail={user?.email} // Optionally pass dynamic email if you have it
      />
    </aside>
  );
}