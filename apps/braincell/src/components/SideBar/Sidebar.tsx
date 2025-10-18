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
import { useAuthContext } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import { useLocations } from '../locations/useLocations';
import { usePermissions } from '../../context/PermissionsContext';

type NavItem = { name: string; to: string; icon: ElementType; end?: boolean };
type Section = { heading: string; items: NavItem[] };
type StoreLocation = { id: string; name: string };

export default function Sidebar(): JSX.Element {
  const { session } = useAuthContext();
  const { activeLocationId, setActiveLocationId } = useScope();
  const { locations, locationsQuery } = useLocations();
  const { has } = usePermissions();

  // Map each nav item to the capability it requires
  const REQUIRES: Record<string, string> = {
    // Manage
    Dashboard: 'dashboard:view',
    Orders: 'orders:read',
    'Service Requests': 'serviceRequests:read',
    'Menu Items': 'menuItems:read',
    Categories: 'categories:read',
    'Digital Menu': 'digitalMenu:view', // not in branch caps → hidden there
    Offers: 'offers:read',
    Customers: 'customers:read',
    Locations: 'locations:read',
    'Qravy Store': 'store:view',

    // Insights
    'Sales Reports': 'reports:view',
    'Menu Performance': 'reports:menuPerformance',
  };

  // Define the full menu once…
  const sectionsAll: Section[] = [
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
        { name: 'Locations', to: '/locations', icon: BuildingStorefrontIcon },
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

  // …then filter by capability (branch sessions only have a limited set, so others drop out)
  const sections: Section[] = useMemo(() => {
    return sectionsAll
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const cap = REQUIRES[item.name];
          // If not mapped, show it only to members (safety), but we mapped all above.
          return cap ? has(cap) : true;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [sectionsAll, has]);

  const linkClass = (isActive: boolean): string =>
    `group flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition ${
      isActive
        ? 'bg-white text-[#2e2e30] ring-1 ring-[#e2e2e2] shadow-sm'
        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
    }`;

  const isCentralSession = session?.type === 'central';
  const loadingSelect = locationsQuery.isLoading && locations.length === 0;

  // Keep scope in sync with session type and available locations
  useEffect(() => {
    if (!isCentralSession) return; // admins/team default to All locations (managed by ScopeContext/localStorage)
    const locId = session?.locationId || locations[0]?.id || null;
    if (locId && activeLocationId !== locId) {
      setActiveLocationId(locId);
    }
  }, [isCentralSession, session?.locationId, locations, activeLocationId, setActiveLocationId]);

  // Refetch on broadcast (same-tab and cross-tab)
  useEffect(() => {
    const refresh = () => locationsQuery.refetch();

    const onCustom = () => refresh();
    window.addEventListener('locations:updated' as any, onCustom as EventListener);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'locations:updated') refresh();
    };
    window.addEventListener('storage', onStorage);

    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      window.removeEventListener('locations:updated' as any, onCustom as EventListener);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [locationsQuery]);

  const active = locations.find((b) => b.id === (activeLocationId || ''));

  const displayName =
    isCentralSession
      ? active?.name || 'Current location'
      : !activeLocationId
      ? 'All locations'
      : active?.name || 'Current location';

  return (
    <aside className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4">
      {/* Brand */}
      <div className="mb-0 flex items-center">
        <span className="text-3xl font-semibold tracking-tight text-slate-900">Qravy.</span>
      </div>

      {/* Location selector */}
      <div className="mt-7 mb-6">
        {loadingSelect ? (
          <div className="h-11 w-full rounded-md border border-[#dbdbdb] bg-slate-100 animate-pulse" />
        ) : (
          <SidebarLocationSelect
            locations={locations}
            value={activeLocationId || ''} // '' represents "All"
            onChange={(id) => {
              if (isCentralSession) return; // lock for central sessions
              setActiveLocationId(id || null);
            }}
            displayName={displayName}
            isCentralSession={isCentralSession}
          />
        )}
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
                      <Icon className="h-5 w-5 text-slate-600 group-[aria-current=page]:text-slate-700" aria-hidden="true" />
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

function SidebarLocationSelect({
  locations,
  value,
  onChange,
  displayName,
  isCentralSession = false,
}: {
  locations: StoreLocation[];
  value: string;
  onChange: (id: string) => void;
  displayName: string;
  isCentralSession?: boolean;
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

  const options = useMemo(() => {
    if (isCentralSession) {
      return locations;
    }
    return [{ id: '', name: 'All locations' }, ...locations];
  }, [locations, isCentralSession]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-md border border-[#dbdbdb] px-3 py-2.5 text-left text-[14px] transition-colors ${
          isCentralSession ? 'bg-[#f6f6f6] text-slate-800 cursor-default' : 'bg-[#fcfcfc] text-slate-700 hover:bg-[#f6f6f6]'
        }`}
        disabled={isCentralSession}
      >
        <span className="flex min-w-0 items-center gap-3">
          <MapPinIcon className="h-5 w-5 text-slate-600" />
          <span className="truncate font-medium text-slate-900">{displayName}</span>
        </span>

        {!isCentralSession && (
          <span className="ml-2 grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-slate-600">
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && !isCentralSession && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <div className="text-[13px] font-medium text-slate-700">Locations</div>
              {!isCentralSession && (
                <Link
                  to="/locations"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#dbdbdb] bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-[#f3f4f6]"
                  aria-label="Manage locations"
                  title="Manage locations"
                >
                  <Cog6ToothIcon className="h-4 w-4" />
                  <span>Manage</span>
                </Link>
              )}
            </div>

            {/* Options */}
            <ul role="menu" className="max-h-72 overflow-y-auto py-1">
              {options.map((b) => {
                const selected = value === b.id;
                return (
                  <li key={b.id || 'all'}>
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
              {options.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-slate-500">No locations found</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
