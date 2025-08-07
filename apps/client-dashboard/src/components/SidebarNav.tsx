import { NavLink } from 'react-router-dom';

const navItems = [
  { name: 'Dashboard', to: '/dashboard' },
  { name: 'Orders', to: '/dashboard/orders' },
  { name: 'Products', to: '/dashboard/products' },
  { name: 'Categories', to: '/dashboard/categories' },
];

export default function SidebarNav() {
  return (
    <nav className="mt-4 flex flex-col gap-1">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `px-6 py-2 rounded text-[#2e2e30] font-medium transition ${
              isActive ? 'bg-[#fcfcfc] font-semibold' : 'hover:bg-[#ececec]'
            }`
          }
        >
          {item.name}
        </NavLink>
      ))}
    </nav>
  );
}