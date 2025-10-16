// apps/client-dashboard/src/pages/settings/RestaurantAccess.tsx
import { useEffect, useMemo, useState, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  EnvelopeIcon,
  ArrowPathIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowRightOnRectangleIcon,
  MapPinIcon,
  LinkIcon,
  CheckCircleIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import api from '../../api/auth';

type Location = { id: string; name: string };
type AccessSettings = {
  centralEmail: string;
  emailVerified: boolean;
  enrollment: {
    requireOtpForNewDevice: boolean;
    requireManagerPinOnAssign: boolean;
    sessionDays: number;
    autoApproveAssignment: boolean;
  };
};

type Device = {
  id: string;
  label?: string | null;
  os?: string | null;
  browser?: string | null;
  lastSeenAt: string;
  createdAt: string;
  locationId: string | null;
  locationName?: string | null;
  status: 'active' | 'pending' | 'revoked';
  trust: 'high' | 'medium' | 'low';
  ipCountry?: string | null;
};

export default function RestaurantAccess(): JSX.Element {
  const [loading, setLoading] = useState(true);

  // Settings
  const [settings, setSettings] = useState<AccessSettings>({
    centralEmail: '',
    emailVerified: false,
    enrollment: {
      requireOtpForNewDevice: true,
      requireManagerPinOnAssign: false,
      sessionDays: 30,
      autoApproveAssignment: true,
    },
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // Data
  const [locations, setLocations] = useState<Location[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [query, setQuery] = useState('');

  // Email input/error state (used for add + edit)
  const centralEmailRef = useRef<HTMLInputElement>(null);
  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const [emailError, setEmailError] = useState<string | null>(null);

  // Modern SaaS inline modes for central email
  const [mode, setMode] = useState<'idle' | 'editing' | 'confirm-remove'>('idle');
  const [emailDraft, setEmailDraft] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [locs, devs, s] = await Promise.all([getLocations(), listDevices(), getAccessSettings()]);
        if (!mounted) return;
        setLocations(locs);
        setDevices(devs);
        setSettings((prev) => ({ ...prev, ...s }));
        setEmailDraft(s.centralEmail || '');
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Clear error as user fixes input
  useEffect(() => {
    if (emailError && isValidEmail(emailDraft)) setEmailError(null);
  }, [emailDraft, emailError]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (!q) return true;
      const hay = [d.label || '', d.locationName || '', d.os || '', d.browser || ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [devices, query]);

  // ADD (when no email yet)
  const handleAddEmail = async () => {
    const val = emailDraft.trim();
    if (!isValidEmail(val)) {
      setEmailError('Please enter a valid email (for example: name@domain.com).');
      centralEmailRef.current?.focus();
      return;
    }
    setSavingSettings(true);
    try {
      const updated = await updateAccessSettings({ ...settings, centralEmail: val });
      setSettings(updated);
      setEmailDraft(updated.centralEmail);
      setMode('idle');
    } finally {
      setSavingSettings(false);
    }
  };

  // EDIT (when email exists)
  const startEdit = () => {
    setEmailDraft(settings.centralEmail || '');
    setMode('editing');
    setTimeout(() => centralEmailRef.current?.focus(), 0);
  };
  const cancelEdit = () => {
    setEmailDraft(settings.centralEmail || '');
    setMode('idle');
    setEmailError(null);
  };
  const saveEdit = async () => {
    const val = emailDraft.trim();
    if (!isValidEmail(val)) {
      setEmailError('Please enter a valid email (for example: name@domain.com).');
      return;
    }
    setSavingSettings(true);
    try {
      const updated = await updateAccessSettings({ ...settings, centralEmail: val });
      setSettings(updated);
      setMode('idle');
    } finally {
      setSavingSettings(false);
    }
  };

  // REMOVE
  const confirmRemove = () => setMode('confirm-remove');
  const cancelRemove = () => setMode('idle');
  const removeEmail = async () => {
    setSavingSettings(true);
    try {
      const updated = await updateAccessSettings({ ...settings, centralEmail: '' });
      setSettings(updated);
      setEmailDraft('');
      setMode('idle');
    } finally {
      setSavingSettings(false);
    }
  };

  const reloadDevices = async () => {
    const devs = await listDevices();
    setDevices(devs);
  };

  if (loading) {
    return (
      <div className="grid gap-4 pb-6">
        <div className="h-16 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-28 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-64 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-96 animate-pulse rounded-xl border border-[#ececec] bg-white" />
      </div>
    );
  }

  const hasEmail = !!settings.centralEmail;
  const showEmailError = !!emailError;

  return (
    <div className="grid gap-4 pb-6" data-page-wrapper>
      {/* Title only */}
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">Restaurant Access</h2>
      </div>

      {/* Two-column layout: left "How it works" and right content */}
      <div className="grid gap-6 lg:grid-cols-3" data-section-grid>
        {/* Left: static "How it works" panel (sticky) */}
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <HowItWorksPanel />
        </aside>

        {/* Right: main content */}
        <section className="lg:col-span-2 space-y-6">
          {/* Email card (modern SaaS states) */}
          <div className="rounded-xl border-2 border-slate-900/10 bg-white p-5 shadow-md">
            <h3 className="text-[16px] font-semibold text-slate-900">Set up central access email</h3>
            <p className="mt-1 text-[12.5px] text-slate-700">
              Use one email for all locations. Staff select their location once per device during login, and our system
              links that device to the chosen location.
            </p>

            {/* --- No email yet: ADD --- */}
            {!hasEmail && mode !== 'confirm-remove' && (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative grow">
                  <EnvelopeIcon className="pointer-events-none absolute left-2.5 top-3 h-5 w-5 text-slate-400" />
                  <input
                    ref={centralEmailRef}
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder="central-access@yourbrand.com"
                    aria-invalid={showEmailError}
                    aria-describedby={showEmailError ? 'centralEmailError' : undefined}
                    className={`w-full h-11 rounded-md border pl-10 pr-3 text-[14px] focus:outline-none ${
                      showEmailError ? 'border-rose-500' : 'border-[#e2e2e2]'
                    }`}
                    disabled={savingSettings}
                  />
                </div>
                <button
                  className="inline-flex h-11 min-w-[120px] items-center justify-center rounded-md bg-[#2e2e30] px-5 text-[13px] font-semibold text-white hover:bg-[#1f1f21] disabled:opacity-60 disabled:cursor-not-allowed transition"
                  onClick={handleAddEmail}
                  disabled={savingSettings || !emailDraft.trim()}
                >
                  {savingSettings ? (
                    'Adding…'
                  ) : (
                    <>
                      <PlusIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                      Add
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Inline error */}
            {!hasEmail && showEmailError && (
              <p id="centralEmailError" className="mt-1 text-[11.5px] text-rose-600">
                {emailError}
              </p>
            )}

            {/* --- Email exists: VIEW / EDIT / REMOVE --- */}
            {hasEmail && mode !== 'confirm-remove' && (
              <div className="mt-4 flex flex-col gap-3">
                {/* VIEW state */}
                {mode === 'idle' && (
                  <div className="flex items-center justify-between rounded-xl border border-[#eaeaea] bg-[#fafafa] p-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-white">
                        <EnvelopeIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-slate-900">{settings.centralEmail}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-[2px] text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            Active
                          </span>
                          {settings.emailVerified && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-[2px] text-[11px] font-medium text-sky-700 ring-1 ring-sky-200">
                              <CheckCircleIcon className="h-3.5 w-3.5" />
                              Verified
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-slate-500">Used across all locations</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={startEdit}
                        disabled={savingSettings}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e6e6e6] bg-white px-3 py-1.5 text-[12px] hover:bg-slate-50 disabled:opacity-60"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                        Change
                      </button>
                      <button
                        onClick={confirmRemove}
                        disabled={savingSettings}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#ffe1e1] bg-white px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        <TrashIcon className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                {/* EDIT state */}
                {mode === 'editing' && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="relative grow">
                      <EnvelopeIcon className="pointer-events-none absolute left-2.5 top-3 h-5 w-5 text-slate-400" />
                      <input
                        ref={centralEmailRef}
                        value={emailDraft}
                        onChange={(e) => setEmailDraft(e.target.value)}
                        placeholder="central-access@yourbrand.com"
                        className={`w-full h-11 rounded-md border pl-10 pr-3 text-[14px] focus:outline-none ${
                          showEmailError ? 'border-rose-500' : 'border-[#e2e2e2]'
                        }`}
                        disabled={savingSettings}
                      />
                      {showEmailError && (
                        <p className="mt-1 text-[11.5px] text-rose-600">{emailError}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={savingSettings || !emailDraft.trim()}
                        className="inline-flex h-11 items-center justify-center rounded-md bg-[#2e2e30] px-4 text-[13px] font-semibold text-white hover:bg-[#1f1f21] disabled:opacity-60"
                      >
                        {savingSettings ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={savingSettings}
                        className="inline-flex h-11 items-center justify-center rounded-md border border-[#e6e6e6] bg-white px-4 text-[13px] hover:bg-slate-50 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* REMOVE confirm */}
            {mode === 'confirm-remove' && (
              <div className="mt-4 rounded-lg border border-[#ffe1e1] bg-red-50 p-3">
                <div className="text-[13px] font-medium text-red-700">
                  Remove central email?
                </div>
                <div className="mt-1 text-[12px] text-red-700/90">
                  Devices won’t be able to sign in with the central email until you add one again.
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={removeEmail}
                    disabled={savingSettings}
                    className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <TrashIcon className="h-4 w-4" />
                    Remove
                  </button>
                  <button
                    onClick={cancelRemove}
                    disabled={savingSettings}
                    className="rounded-md border border-[#e6e6e6] bg-white px-3 py-1.5 text-[12px] hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Devices */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-[13px] font-medium text-slate-900">Devices</h3>
              <div className="inline-flex items-center gap-2">
                <div className="relative">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search"
                    className="w-44 rounded-md border border-[#e2e2e2] pl-7 pr-2 py-1.5 text-[12px] focus:outline-none"
                  />
                </div>
                <button
                  className="rounded-md border border-[#e2e2e2] bg-white p-1.5 hover:bg-slate-50"
                  onClick={reloadDevices}
                  title="Refresh"
                >
                  <ArrowPathIcon className="h-4 w-4 text-slate-600" />
                </button>
              </div>
            </div>

            {/* Minimal table: Device, Location, OS/Browser */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[12px] text-slate-600">
                  <tr>
                    <th className="py-2 pl-2">Device</th>
                    <th className="py-2">Location</th>
                    <th className="py-2">OS / Browser</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[13px]">
                  {filtered.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2 pl-2">
                        <div className="font-medium text-slate-900">{d.label || 'Unnamed device'}</div>
                        <div className="text-[12px] text-slate-500">#{d.id.slice(0, 8)}</div>
                      </td>
                      <td className="py-2">{d.locationName || <span className="text-slate-500">Unassigned</span>}</td>
                      <td className="py-2">{(d.os || '—') + ' / ' + (d.browser || '—')}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-[13px] text-slate-600">
                        No devices found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-md border border-[#e2e2e2] bg-[#f6f6f6] px-4 py-3 text-[12px] text-slate-700">
              Manage your locations in{' '}
              <Link to="/locations" className="text-slate-900 underline">
                Locations
              </Link>
              . Devices can be reassigned at any time.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* --- Left "How it works" panel (sticky, auto-fills to bottom of main container) --- */
function HowItWorksPanel() {
  const howItWorksSteps = [
    {
      title: 'Set a central email',
      desc: 'Use one email for all locations. No extra verification—just log in with this email on each device.',
      icon: EnvelopeIcon,
    },
    {
      title: 'Staff sign in',
      desc: 'Staff log in with the central email. No password required.',
      icon: ArrowRightOnRectangleIcon,
    },
    {
      title: 'Choose location',
      desc: 'On first login, staff select the branch/location for that device.',
      icon: MapPinIcon,
    },
    {
      title: 'System links device',
      desc: 'The system saves this device as belonging to the selected branch.',
      icon: LinkIcon,
    },
    {
      title: 'Device remembered',
      desc: 'Future logins go straight to that branch automatically.',
      icon: CheckCircleIcon,
    },
  ];

  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number>();

  // Find the nearest scrollable ancestor
  const getScrollParent = (el: HTMLElement | null): HTMLElement => {
    let p: HTMLElement | null = el?.parentElement || null;
    while (p) {
      const style = getComputedStyle(p);
      if (/(auto|scroll)/.test(style.overflowY)) return p;
      p = p.parentElement;
    }
    return (document.scrollingElement as HTMLElement) || document.documentElement;
  };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const scroller = getScrollParent(panel);

    const update = () => {
      if (!panel) return;

      const scrollerRect = scroller.getBoundingClientRect();

      const sectionGrid = panel.closest('[data-section-grid]') as HTMLElement | null;
      const gridTopFromScrollerTop = sectionGrid
        ? sectionGrid.getBoundingClientRect().top - scrollerRect.top
        : panel.getBoundingClientRect().top - scrollerRect.top;

      const pageWrapper = panel.closest('[data-page-wrapper]') as HTMLElement | null;
      const bottomPad = pageWrapper ? parseFloat(getComputedStyle(pageWrapper).paddingBottom || '0') : 0;

      const available = scroller.clientHeight - gridTopFromScrollerTop - bottomPad;

      const natural = contentRef.current?.scrollHeight ?? 0;

      const next = Math.max(available, natural);
      setMinHeight(next);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    if (contentRef.current) ro.observe(contentRef.current);
    if (panel.parentElement) ro.observe(panel.parentElement);

    window.addEventListener('resize', update);
    scroller.addEventListener('scroll', update, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      scroller.removeEventListener('scroll', update as any);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="rounded-xl border border-[#ececec] bg-gradient-to-b from-fuchsia-50/70 via-slate-50 to-white p-4"
      style={minHeight ? { minHeight } : undefined}
    >
      <div ref={contentRef}>
        <div className="text-[12px] font-medium text-slate-700">How it works</div>
        <ol className="relative mt-6 ml-6">
          <div className="absolute left-[-3px] top-0 bottom-0 w-0.5 bg-slate-200" />
          {howItWorksSteps.map((s) => {
            const Icon = s.icon as any;
            return (
              <li key={s.title} className="relative mb-12 last:mb-0 pl-6">
                <span className="absolute left-[-15px] top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#2e2e30]">
                  <Icon className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                </span>
                <div className="text-[13px] font-semibold text-slate-900">{s.title}</div>
                <div className="text-[12px] leading-snug text-slate-600">{s.desc}</div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* --- Modal shell (kept for future actions if needed) --- */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[1120]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#ececec] px-5 py-4">
            <div className="text-[15px] font-semibold text-slate-900">{title}</div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-slate-50">
              <XMarkIcon className="h-5 w-5 text-slate-600" />
            </button>
          </div>
          <div className="px-5 py-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* --- API helpers (placeholder endpoints; wire to your backend) --- */
async function getLocations(): Promise<Location[]> {
  const res = await api.get('/api/v1/locations');
  return res.data?.items || [];
}
async function listDevices(): Promise<Device[]> {
  const res = await api.get('/api/v1/access/devices');
  return (res.data?.items || []).map((d: any) => ({
    ...d,
    lastSeenAt: d.lastSeenAt || d.updatedAt || new Date().toISOString(),
    createdAt: d.createdAt || new Date().toISOString(),
  }));
}
async function getAccessSettings(): Promise<AccessSettings> {
  const res = await api.get('/api/v1/access/settings');
  return (
    res.data?.item || {
      centralEmail: '',
      emailVerified: false,
      enrollment: {
        requireOtpForNewDevice: true,
        requireManagerPinOnAssign: false,
        sessionDays: 30,
        autoApproveAssignment: true,
      },
    }
  );
}
async function updateAccessSettings(payload: AccessSettings): Promise<AccessSettings> {
  const res = await api.put('/api/v1/access/settings', payload);
  return res.data?.item || payload;
}
