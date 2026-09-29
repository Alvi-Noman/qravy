import React, { type ElementType, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenant';
import { useAuthContext } from '../../context/AuthContext';
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  BuildingOffice2Icon,
  GlobeAltIcon,
  ShieldCheckIcon,
  BellIcon,
  LinkIcon,
  KeyIcon,
  UserGroupIcon,
  LanguageIcon,
  EyeDropperIcon,
  BeakerIcon,
  FingerPrintIcon,
  QueueListIcon,
  CurrencyDollarIcon,
  CreditCardIcon,
  HomeModernIcon,
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

type NavItem = {
  name: string;
  to: string;
  icon: ElementType;
  end?: boolean;
};

const items: NavItem[] = [
  { name: 'General', to: '/settings', icon: Cog6ToothIcon, end: true },
  { name: 'Operations', to: '/settings/operations', icon: AdjustmentsHorizontalIcon },
  { name: 'Hours & availability', to: '/settings/availability', icon: ClockIcon },
  { name: 'Plan', to: '/settings/Plan', icon: CurrencyDollarIcon },
  { name: 'Billing', to: '/settings/Billing', icon: CreditCardIcon },

  { name: 'Organization & Branding', to: '/settings/Branding', icon: BuildingOffice2Icon },
  { name: 'Domain & Digital Menu', to: '/settings/Domain', icon: GlobeAltIcon },
  { name: 'Security & Sessions', to: '/settings/Security', icon: ShieldCheckIcon },
  { name: 'Notifications', to: '/settings/Notifications', icon: BellIcon },
  { name: 'Integrations', to: '/settings/Integrations', icon: LinkIcon },
  { name: 'API & Webhooks', to: '/settings/Developer', icon: KeyIcon },

  // Access section
  { name: 'Team & Roles', to: '/settings/Team', icon: UserGroupIcon },
  { name: 'Restaurant Access', to: '/settings/Access', icon: HomeModernIcon },

  { name: 'Localization & Regional', to: '/settings/Localization', icon: LanguageIcon },
  { name: 'Accessibility', to: '/settings/Accessibility', icon: EyeDropperIcon },
  { name: 'Experimental / Labs', to: '/settings/Labs', icon: BeakerIcon },
  { name: 'Data & Privacy', to: '/settings/Privacy', icon: FingerPrintIcon },
  { name: 'Audit Log', to: '/settings/Audit', icon: QueueListIcon },
];

const linkClass = (isActive: boolean): string =>
  `group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition ${
    isActive
      ? 'bg-[#efefef] text-[#1a1a1a] font-semibold'
      : 'text-[#4a4a4a] hover:bg-[#eaeaea] hover:text-[#1a1a1a]'
  }`;

export default function SettingsSidebar(): JSX.Element {
  const { data: tenant } = useTenant();
  const { user } = useAuthContext();
  const [search, setSearch] = useState('');

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const ownerName = tenant?.ownerInfo?.fullName || 'Store Owner';
  const ownerEmail = user?.email || 'owner@qravy.com';
  const initials = ownerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <aside className="flex h-full w-full flex-col bg-white px-3 py-3 select-none">
      {/* Back to Dashboard */}
      <div className="mb-2 px-1">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4 shrink-0" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Divider */}
      <div className="border-b border-slate-100 mb-3" />

      {/* Profile Card / Shop Widget */}
      <div className="mb-3 flex items-center gap-3 px-2 py-2">
        <div className="h-9 w-9 rounded-md bg-[#008060] text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
          {tenant?.name ? tenant.name.substring(0, 2).toUpperCase() : 'QR'}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-[13px] text-[#1a1a1a] truncate leading-tight">
            {tenant?.name || 'My Restaurant'}
          </span>
          <span className="text-[11px] text-slate-500 truncate leading-none mt-0.5">
            {tenant?.subdomain ? `${tenant.subdomain}.qravy.com` : 'qravy.com'}
          </span>
        </div>
      </div>

      {/* Search Input */}
      <div className="mb-4 px-1">
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-2.5">
            <MagnifyingGlassIcon className="h-4 w-4 text-[#8c8c8c]" />
          </span>
          <input
            type="text"
            placeholder="Search settings"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 bg-white border border-[#d2d2d2] rounded-md text-[13px] placeholder-[#8c8c8c] focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-colors"
          />
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-1 space-y-1">
        <ul className="space-y-0.5">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => linkClass(isActive)}>
                  <Icon className="h-4 w-4 text-[#616161] group-[.font-semibold]:text-[#1a1a1a]" aria-hidden="true" />
                  <span>{item.name}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User profile card at the bottom (Style Lite style) */}
      <div className="mt-auto border-t border-[#e3e3e3] pt-3 px-1">
        <div className="flex items-center gap-3 px-1 py-1.5 rounded-md hover:bg-slate-50 transition cursor-pointer">
          <div className="h-8 w-8 rounded-md bg-[#005ea2] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
            {initials}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-[12px] text-[#1a1a1a] truncate leading-tight">
              {ownerName}
            </span>
            <span className="text-[10px] text-slate-500 truncate leading-none mt-0.5">
              {ownerEmail}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}