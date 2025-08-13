import { NavLink } from 'react-router-dom';

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

export default function SidebarNav() {
  const linkClass = (isActive: boolean) =>
    `px-6 py-2 rounded text-[#2e2e30] font-medium transition ${
      isActive ? 'bg-[#fcfcfc] font-semibold' : 'hover:bg-[#ececec]'
    }`;

  return (
    <nav className="mt-4 flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.heading}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#b0b0b5' }}>
            {section.heading}
          </div>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
                {item.name}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}