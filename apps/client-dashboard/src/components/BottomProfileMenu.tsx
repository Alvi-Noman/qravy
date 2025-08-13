import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  RocketLaunchIcon,
  AdjustmentsHorizontalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

type MenuItem = {
  key: 'upgrade' | 'customize' | 'settings' | 'help' | 'logout';
  label: string;
  icon: IconType;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
};

type BottomProfileMenuProps = {
  logoUrl?: string;
  restaurantName?: string;
  restaurantEmail?: string;
};

export default function BottomProfileMenu({
  logoUrl = '/qravy-icon-200X200.png',
  restaurantName = 'Your Restaurant',
  restaurantEmail,
}: BottomProfileMenuProps) {
  const { user, logout } = useAuthContext();
  const email = restaurantEmail || user?.email || 'contact@example.com';

  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Close when route changes
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const items: MenuItem[] = [
    {
      key: 'upgrade',
      label: 'Upgrade Plan',
      icon: RocketLaunchIcon,
      onClick: () => navigate('/dashboard/billing'),
      accent: true,
    },
    {
      key: 'customize',
      label: 'Customize',
      icon: AdjustmentsHorizontalIcon,
      onClick: () => navigate('/dashboard/customize'),
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: Cog6ToothIcon,
      onClick: () => navigate('/dashboard/settings'),
    },
    {
      key: 'help',
      label: 'Help',
      icon: QuestionMarkCircleIcon,
      onClick: () => navigate('/dashboard/help'), // simple clickable route
    },
    {
      key: 'logout',
      label: 'Logout',
      icon: ArrowRightOnRectangleIcon,
      onClick: async () => {
        try {
          await logout();
        } finally {
          navigate('/login');
        }
      },
      danger: true,
    },
  ];

  // Trigger styles: fixed width, no margin changes => no left shift on hover
  const triggerClasses =
    'w-full border border-transparent bg-transparent transition flex items-center gap-3 px-2.5 py-2 rounded-none hover:rounded-md hover:border-[#e6e6e9] dark:hover:border-[#2f2f33] hover:bg-[#fafafa] dark:hover:bg-zinc-900/70';

  return (
    <div ref={rootRef} className="mt-auto pb-2">
      {/* Divider above profile row */}
      <div className="mb-1 h-px bg-[#ececef] dark:bg-zinc-800" />

      {/* Trigger (no arrow, email under name) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={triggerClasses}
      >
        <img
          src={logoUrl}
          alt="Restaurant Logo"
          className="h-8 w-8 rounded-full border border-[#ececec] dark:border-zinc-800 object-cover"
        />
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-semibold text-[#2e2e30] dark:text-zinc-100 truncate">
            {restaurantName}
          </div>
          <div className="text-xs text-[#6b6b70] dark:text-zinc-400 truncate">{email}</div>
        </div>
      </button>

      {/* Drop-up card (same width as trigger/sidebar) */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative"
          >
            <div className="absolute bottom-2 left-0 right-0 z-50">
              <div className="rounded-md border border-[#ececec] dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-3 py-3">
                  <img
                    src={logoUrl}
                    alt="Restaurant Logo"
                    className="h-9 w-9 rounded-full border border-[#ececec] dark:border-zinc-800 object-cover"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#2e2e30] dark:text-zinc-100 truncate">
                      {restaurantName}
                    </div>
                    <div className="text-xs text-[#6b6b70] dark:text-zinc-400 truncate">{email}</div>
                  </div>
                </div>

                <div className="h-px bg-[#f1f1f3] dark:bg-zinc-800" />

                {/* Actions */}
                <ul className="py-1">
                  {items.map((it) => (
                    <li key={it.key} className="relative">
                      <button
                        type="button"
                        onClick={it.onClick}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-[#f7f7f9] dark:hover:bg-zinc-800/60 ${
                          it.danger
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-[#2e2e30] dark:text-zinc-100'
                        }`}
                      >
                        <it.icon
                          className={`h-5 w-5 ${
                            it.danger
                              ? 'text-red-500'
                              : it.accent
                              ? 'text-violet-600 dark:text-violet-400'
                              : 'text-[#6b6b70] dark:text-zinc-400'
                          }`}
                        />
                        <span
                          className={`flex-1 text-left ${
                            it.accent ? 'font-semibold' : 'font-medium'
                          }`}
                        >
                          {it.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}