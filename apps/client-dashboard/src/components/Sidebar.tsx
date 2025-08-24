import { type ElementType } from 'react';
import { NavLink } from 'react-router-dom';
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  BellAlertIcon,
  Squares2X2Icon,
  TagIcon,
  DocumentTextIcon,
  GiftIcon,
  UserGroupIcon,
  BuildingStorefrontIcon,
  GlobeAltIcon,
  BanknotesIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

/** Describes a navigational item with label, route and icon. */
type NavItem = {
  name: string;
  to: string;
  icon: ElementType;
  end?: boolean;
};

/** Groups navigation items under a labeled section. */
type Section = {
  heading: string;
  items: NavItem[];
};

/** Sidebar with logo and navigation-only IA (no profile menu). */
export default function Sidebar(): JSX.Element {
  /** Structured navigation schema for the sidebar. */
  const sections: Section[] = [
    {
      heading: 'Manage',
      items: [
        { name: 'Dashboard', to: '/dashboard', icon: HomeIcon, end: true },
        { name: 'Orders', to: '/orders', icon: ClipboardDocumentListIcon },
        { name: 'Service Requests', to: '/service-requests', icon: BellAlertIcon },
        { name: 'Menu Items', to: '/menu-items', icon: Squares2X2Icon },
        { name: 'Categories', to: '/categories', icon: TagIcon },
        { name: 'Digital Menu', to: '/digital-menu', icon: DocumentTextIcon },
        { name: 'Offers', to: '/offers', icon: GiftIcon },
        { name: 'Customers', to: '/customers', icon: UserGroupIcon },
        { name: 'Branches', to: '/branches', icon: BuildingStorefrontIcon },
        { name: 'Qravy Store', to: '/qravy-store', icon: GlobeAltIcon },
      ],
    },
    {
      heading: 'Insights',
      items: [
        { name: 'Sales Reports', to: '/reports/sales', icon: BanknotesIcon },
        { name: 'Menu Performance', to: '/reports/menu-performance', icon: ChartBarIcon },
      ],
    },
  ];

  /** Computes classes based on active state with left accent and subtle tint. */
  const linkClass = (isActive: boolean): string =>
    `group flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition ${
      isActive
        ? 'border-l-4 border-indigo-600 bg-indigo-50 text-indigo-800'
        : 'border-l-4 border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <aside className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4">
      <div className="mb-6 flex items-center">
        <img
          src="/qravy-logo-250X100.png"
          alt="Qravy Logo"
          className="h-10 w-auto"
          style={{ maxWidth: 140, objectFit: 'contain' }}
        />
      </div>

      <nav className="flex-1 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.heading} className="mb-6">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-slate-500">
              {section.heading}
            </div>
            <ul className="space-y-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className={({ isActive }) => linkClass(isActive)}>
                      <Icon className="h-5 w-5 text-slate-600 group-[aria-current=page]:text-indigo-600" aria-hidden="true" />
                      <span className="font-medium">{item.name}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}