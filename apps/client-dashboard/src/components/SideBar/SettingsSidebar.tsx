import React, { type ElementType } from 'react';
import { NavLink, Link } from 'react-router-dom';
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
  // NEW
  CurrencyDollarIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline';

type NavItem = {
  name: string;
  to: string;
  icon: ElementType;
  end?: boolean;
};

const items: NavItem[] = [
  { name: 'Overview', to: '/settings', icon: Cog6ToothIcon, end: true },
  // NEW: Under Overview
  { name: 'Plan', to: '/settings/Plan', icon: CurrencyDollarIcon },
  { name: 'Billing', to: '/settings/Billing', icon: CreditCardIcon },

  { name: 'Organization & Branding', to: '/settings/Branding', icon: BuildingOffice2Icon },
  { name: 'Domain & Digital Menu', to: '/settings/Domain', icon: GlobeAltIcon },
  { name: 'Security & Sessions', to: '/settings/Security', icon: ShieldCheckIcon },
  { name: 'Notifications', to: '/settings/Notifications', icon: BellIcon },
  { name: 'Integrations', to: '/settings/Integrations', icon: LinkIcon },
  { name: 'API & Webhooks', to: '/settings/Developer', icon: KeyIcon },
  { name: 'Team & Roles', to: '/settings/Team', icon: UserGroupIcon },
  { name: 'Localization & Regional', to: '/settings/Localization', icon: LanguageIcon },
  { name: 'Accessibility', to: '/settings/Accessibility', icon: EyeDropperIcon },
  { name: 'Experimental / Labs', to: '/settings/Labs', icon: BeakerIcon },
  { name: 'Data & Privacy', to: '/settings/Privacy', icon: FingerPrintIcon },
  { name: 'Audit Log', to: '/settings/Audit', icon: QueueListIcon },
];

const linkClass = (isActive: boolean): string =>
  `group flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition ${
    isActive
      ? 'bg-white text-[#2e2e30] ring-1 ring-[#e2e2e2] shadow-sm'
      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
  }`;

export default function SettingsSidebar(): JSX.Element {
  return (
    <aside className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4">
      <div className="mb-4">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-slate-700 hover:bg-[#f6f6f6]"
        >
          <ArrowLeftIcon className="h-4 w-4 text-slate-600" />
          <span className="font-medium">Back to app</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <ul className="space-y-2">
          {items.map((item) => {
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
      </nav>
    </aside>
  );
}