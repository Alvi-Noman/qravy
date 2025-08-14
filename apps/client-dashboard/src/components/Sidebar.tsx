import { NavLink } from 'react-router-dom';
import BottomProfileMenu from './BottomProfileMenu';
import {
  HomeIcon,
  ShoppingCartIcon,
  BellAlertIcon,
  Squares2X2Icon,
  TagIcon,
  GlobeAltIcon,
  GiftIcon,
  QrCodeIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

type NavItem = {
  name: string;
  to: string;
  icon: React.ElementType; // supports Heroicons’ forwardRef components
};

type Section = {
  heading: string;
  items: NavItem[];
};

export default function Sidebar() {
  // Structure:
  // - Management (Dashboard inside options)
  // - Diner View
  // - Analytics (Menu Performance here)
  const sections: Section[] = [
    {
      heading: 'Management',
      items: [
        { name: 'Dashboard', to: '/dashboard', icon: HomeIcon },
        { name: 'Orders', to: '/dashboard/orders', icon: ShoppingCartIcon }, // changed
        { name: 'Assistance', to: '/dashboard/assistance', icon: BellAlertIcon }, // bell icon
        { name: 'Menu Items', to: '/dashboard/menu-items', icon: Squares2X2Icon },
        { name: 'Categories', to: '/dashboard/categories', icon: TagIcon },
      ],
    },
    {
      heading: 'Diner View',
      items: [
        { name: 'Online Store', to: '/dashboard/online-store', icon: GlobeAltIcon },
        { name: 'Offers', to: '/dashboard/offers', icon: GiftIcon },
        { name: 'QR Code', to: '/dashboard/qr-code', icon: QrCodeIcon },
      ],
    },
    {
      heading: 'Analytics',
      items: [{ name: 'Menu Performance', to: '/dashboard/reports/menu-performance', icon: ChartBarIcon }],
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

      {/* Navigation */}
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
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink to={item.to} className={({ isActive }) => linkClass(isActive)}>
                      <Icon className="h-5 w-5 text-[#6b6b70]" aria-hidden="true" />
                      <span className="font-medium">{item.name}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom profile (drop-up) */}
      <BottomProfileMenu
        logoUrl="/qravy-icon-200X200.png"
        restaurantName="Your Restaurant"
        // restaurantEmail={user?.email}
      />
    </aside>
  );
}