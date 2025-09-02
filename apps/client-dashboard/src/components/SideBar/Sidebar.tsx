import React, { type ElementType, useEffect, useRef, useState, useMemo } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  ChevronDownIcon,
  MapPinIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';

type NavItem = {
  name: string;
  to: string;
  icon: ElementType;
  end?: boolean;
};

type Section = {
  heading: string;
  items: NavItem[];
};

type Branch = { id: string; name: string };

export default function Sidebar(): JSX.Element {
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

  const linkClass = (isActive: boolean): string =>
    `group flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition ${
      isActive
        ? 'border-l-4 border-indigo-600 bg-indigo-50 text-indigo-800'
        : 'border-l-4 border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900'
    }`;

  const branches: Branch[] =
    JSON.parse(localStorage.getItem('branches:list') || 'null') ||
    [{ id: 'main', name: 'Main Branch' }];

  const [activeBranchId, setActiveBranchId] = useState<string>(() => {
    return localStorage.getItem('branches:activeId') || branches[0]?.id || '';
  });

  useEffect(() => {
    localStorage.setItem('branches:activeId', activeBranchId);
  }, [activeBranchId]);

  const activeBranch = branches.find((b) => b.id === activeBranchId);
  const displayName = activeBranch?.name || 'All Branches';

  return (
    <aside className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4">
      <div className="mb-0 flex items-center">
        <span className="text-3xl font-semibold tracking-tight text-slate-900">
          Qravy.
        </span>
      </div>

      <div className="mt-7 mb-6">
        <SidebarBranchSelect
          branches={branches}
          value={activeBranchId}
          onChange={setActiveBranchId}
          displayName={displayName}
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
                      <Icon
                        className="h-5 w-5 text-slate-600 group-[aria-current=page]:text-indigo-600"
                        aria-hidden="true"
                      />
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

function SidebarBranchSelect({
  branches,
  value,
  onChange,
  displayName,
}: {
  branches: Branch[];
  value: string;
  onChange: (id: string) => void;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const filtered = useMemo(() => branches, [branches]);
  const isAllSelected = value === '';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v: boolean) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2.5 text-left text-[14px] text-slate-700 transition-colors hover:bg-[#f6f6f6]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <MapPinIcon className="h-5 w-5 text-slate-600" />
          <span className="truncate font-medium text-slate-900">{displayName}</span>
        </span>

        <span className="ml-2 grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-slate-600">
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
          >
            {/* Header: "Branches" left, Manage button right */}
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <div className="text-[13px] font-medium text-slate-700">Branches</div>
              <Link
                to="/branches"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#dbdbdb] bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-[#f3f4f6]"
                aria-label="Manage branches"
                title="Manage branches"
              >
                <Cog6ToothIcon className="h-4 w-4" />
                <span>Manage</span>
              </Link>
            </div>

            {/* Options — no extra gap (like before) and no border-radius on items */}
            <ul role="menu" className="max-h-72 overflow-y-auto py-1">
              <li key="all">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isAllSelected}
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition ${
                    isAllSelected ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <MapPinIcon className="h-5 w-5 text-slate-600" />
                    All Branches
                  </span>
                  {isAllSelected ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      Current
                    </span>
                  ) : null}
                </button>
              </li>

              {filtered.map((b) => {
                const selected = value === b.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        onChange(b.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition ${
                        selected ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <MapPinIcon className="h-5 w-5 text-slate-600" />
                        {b.name}
                      </span>
                      {selected ? (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          Current
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-slate-500">No branches found</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}