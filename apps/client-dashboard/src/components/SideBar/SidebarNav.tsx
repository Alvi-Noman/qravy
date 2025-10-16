import { NavLink } from 'react-router-dom';

/** Compact, text-only sidebar navigation mirroring the main sidebar structure. */
const sections: {
  heading: string;
  items: { name: string; to: string; end?: boolean }[];
}[] = [
  {
    heading: 'Operations',
    items: [
      { name: 'Dashboard', to: '/dashboard', end: true },
      { name: 'Orders', to: '/orders' },
      { name: 'Service Requests', to: '/service-requests' },
      { name: 'Menu Items', to: '/menu-items' },
      { name: 'Categories', to: '/categories' },
      { name: 'Locations', to: '/locations' }, // NEW
    ],
  },
  {
    heading: 'Guest Experience',
    items: [
      { name: 'Menu Designer', to: '/menu-designer' },
      { name: 'Service Tools', to: '/service-tools' },
      { name: 'Promotions', to: '/promotions' },
      { name: 'Customers', to: '/customers' },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { name: 'Sales & Orders', to: '/reports/sales-orders' },
      { name: 'Menu Performance', to: '/reports/menu-performance' },
    ],
  },
];

/** Lightweight vertical nav for dashboard pages. */
export default function SidebarNav(): JSX.Element {
  /** Returns classes depending on whether the link is active. */
  const linkClass = (isActive: boolean): string =>
    `px-6 py-2 rounded text-[#2e2e30] font-medium transition ${
      isActive ? 'bg-[#fcfcfc] font-semibold' : 'hover:bg-[#ececec]'
    }`;

  return (
    <nav className="mt-4 flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.heading}>
          <div
            className="text-xs font-semibold uppercase tracking-wider mb-1"
            style={{ color: '#b0b0b5' }}
          >
            {section.heading}
          </div>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => linkClass(isActive)}>
                {item.name}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}