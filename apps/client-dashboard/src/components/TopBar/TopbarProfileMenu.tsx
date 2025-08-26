import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDownIcon,
  RocketLaunchIcon,
  AdjustmentsHorizontalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../../context/AuthContext';

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

type MenuItem = {
  key: 'upgrade' | 'customize' | 'settings' | 'help' | 'logout';
  label: string;
  icon: IconType;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
};

type TopbarProfileMenuProps = {
  logoUrl?: string;
  restaurantName?: string;
  restaurantEmail?: string;
};

/** Compact profile menu for the top bar (avatar + dropdown on the right). */
export default function TopbarProfileMenu({
  logoUrl = '/qravy-icon-200X200.png',
  restaurantName = 'Your Restaurant',
  restaurantEmail,
}: TopbarProfileMenuProps): JSX.Element {
  const { user, logout } = useAuthContext();
  const email = restaurantEmail || user?.email || 'contact@example.com';
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /** Close on outside click. */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /** Close when route changes. */
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
      onClick: () => navigate('/dashboard/help'),
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100"
      >
        <img
          src={logoUrl}
          alt="Account"
          className="h-7 w-7 rounded-full border border-slate-200 object-cover"
        />
        <span className="hidden sm:block max-w-[12ch] truncate text-[13px] text-slate-700">
          {restaurantName}
        </span>
        <ChevronDownIcon className="h-4 w-4 text-slate-500" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <img
                src={logoUrl}
                alt="Account"
                className="h-9 w-9 rounded-full border border-slate-200 object-cover"
              />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-slate-800">{restaurantName}</div>
                <div className="truncate text-[12px] text-slate-500">{email}</div>
              </div>
            </div>

            <div className="h-px bg-slate-200" />

            <ul className="py-1">
              {items.map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    onClick={it.onClick}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-[13px] transition hover:bg-slate-50 ${
                      it.danger ? 'text-red-600' : 'text-slate-800'
                    }`}
                  >
                    <it.icon
                      className={`h-5 w-5 ${
                        it.danger ? 'text-red-500' : it.accent ? 'text-indigo-600' : 'text-slate-500'
                      }`}
                    />
                    <span className={it.accent ? 'font-semibold' : 'font-medium'}>{it.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}