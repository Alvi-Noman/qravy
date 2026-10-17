import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthContext } from '../context/AuthContext';
import { checkSubdomain, createTenant, SubdomainTakenError } from '../api/auth';
import { enterWorkspace, findAccess, viaLabel, type Workspace } from '../features/auth/afterLogin';

// Is the subdomain free? Checked while the owner types; taken → a soft alert with free ones close to it.
type UrlCheck =
  | { state: 'idle' }
  | { state: 'checking'; subdomain: string }
  | { state: 'available'; subdomain: string }
  | { state: 'taken'; subdomain: string; reserved: boolean; suggestions: string[] };

export default function CreateRestaurant() {
  const navigate = useNavigate();
  const { user, loading, login, reloadUser } = useAuthContext();

  // Before offering a new restaurant: is this person already in one? (Restaurant Access, a Team invite, an admin
  // membership.) However they got here — the login, the email link, a session from before, a bookmark — one
  // restaurant opens by itself; several are listed; only none shows the form. ('checking' → nothing shown yet.)
  const [access, setAccess] = useState<'checking' | 'none' | Workspace[]>('checking');
  const [opening, setOpening] = useState<string | null>(null);
  const openWorkspace = async (tenantId: string) => {
    if (!user) return;
    setOpening(tenantId);
    try {
      const { token, next } = await enterWorkspace(tenantId);
      await login(token, { ...user, tenantId, isOnboarded: true } as any);
      await reloadUser();
      navigate(next, { replace: true });
    } catch {
      setOpening(null);
    }
  };
  useEffect(() => {
    if (loading || !user || user.tenantId) return;
    let live = true;
    (async () => {
      const found = await findAccess();
      if (!live) return;
      if (found.kind === 'device') {
        await login(found.token, { ...user, tenantId: found.tenantId, isOnboarded: true } as any);
        await reloadUser();
        navigate('/dashboard', { replace: true });
      } else if (found.kind === 'workspaces' && found.items.length === 1) {
        await openWorkspace(found.items[0].id);
      } else {
        setAccess(found.kind === 'workspaces' ? found.items : 'none');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id, user?.tenantId]);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [restaurantUrl, setRestaurantUrl] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  
  // Channels selection states
  const [dineInEnabled, setDineInEnabled] = useState(true);
  const [onlineSalesEnabled, setOnlineSalesEnabled] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [urlCheck, setUrlCheck] = useState<UrlCheck>({ state: 'idle' });
  const urlInputRef = useRef<HTMLInputElement>(null);

  // 🚫 Redirect if user already has a tenant
  useEffect(() => {
    if (!loading) {
      if (user?.tenantId) {
        if (!user.isOnboarded) {
          navigate('/onboarding', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!slugManuallyEdited) {
      setRestaurantUrl(slugify(name));
    }
  }, [name, slugManuallyEdited]);

  // ask the server a moment after the owner stops typing (only a well-formed subdomain; stale answers are ignored)
  useEffect(() => {
    const sub = restaurantUrl;
    if (validate('x', sub)) {
      setUrlCheck({ state: 'idle' });
      return;
    }
    setUrlCheck((prev) => (prev.state !== 'idle' && prev.subdomain === sub ? prev : { state: 'checking', subdomain: sub }));
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await checkSubdomain(sub);
        if (cancelled) return;
        setUrlCheck(
          r.available
            ? { state: 'available', subdomain: sub }
            : { state: 'taken', subdomain: sub, reserved: r.reason === 'reserved', suggestions: r.suggestions ?? [] }
        );
      } catch {
        if (!cancelled) setUrlCheck({ state: 'idle' }); // can't check now → creating the restaurant checks again
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [restaurantUrl]);

  const pickSuggestion = (sub: string) => {
    setRestaurantUrl(sub);
    setSlugManuallyEdited(true);
    setLocalError(null);
  };

  const editUrl = () => {
    const el = urlInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  };

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const error = validate(name, restaurantUrl);
    if (error) {
      setLocalError(error);
      return;
    }
    if (urlCheck.state === 'taken' && urlCheck.subdomain === restaurantUrl) {
      editUrl(); // the alert below the field already says why
      return;
    }
    setStep(1);
  };

  const handleBackStep = () => {
    setLocalError(null);
    setStep(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!dineInEnabled && !onlineSalesEnabled) {
      setLocalError('At least one ordering channel must be selected.');
      return;
    }

    try {
      setIsSubmitting(true);
      await createTenant({
        name: name.trim(),
        subdomain: restaurantUrl.trim().toLowerCase(),
        dineInEnabled,
        onlineSalesEnabled,
      });
      navigate('/onboarding', { replace: true });
    } catch (err) {
      const msg = (err as Error)?.message || 'Could not create restaurant. Please try again.';
      if (err instanceof SubdomainTakenError || /subdomain/i.test(msg) || /taken/i.test(msg)) {
        // someone took it in the meantime → back to the name step, with the soft alert and free ones to pick
        setUrlCheck({
          state: 'taken',
          subdomain: restaurantUrl.trim().toLowerCase(),
          reserved: /not available/i.test(msg),
          suggestions: err instanceof SubdomainTakenError ? err.suggestions : [],
        });
        setStep(0);
        setTimeout(editUrl, 250); // after the step animation
      } else if (/already has a tenant/i.test(msg)) {
        navigate('/onboarding', { replace: true });
      } else {
        setLocalError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const urlTaken = urlCheck.state === 'taken' && urlCheck.subdomain === restaurantUrl;

  if (!user?.tenantId && (access === 'checking' || opening)) {
    return (
      <div className="min-h-screen w-full bg-[#fcfcfc] flex items-center justify-center font-inter text-sm text-[#5b5b5d]">
        Opening your restaurant…
      </div>
    );
  }
  if (Array.isArray(access) && access.length) {
    return (
      <div className="min-h-screen w-full bg-[#fcfcfc] flex items-center justify-center px-4 font-inter">
        <div className="w-full max-w-lg rounded-2xl border border-[#ececec] bg-white p-6 shadow">
          <h1 className="text-center text-[18px] font-semibold text-slate-900">Choose a restaurant</h1>
          <p className="mt-1 text-center text-[13px] text-slate-500">You've been given access to these.</p>
          <div className="mt-5 space-y-3">
            {access.map((ws) => (
              <div key={ws.id} className="flex items-center justify-between rounded-lg border border-[#e5e5e5] p-4">
                <div>
                  <div className="text-[14px] font-medium text-slate-900">{ws.name}</div>
                  <div className="text-[12px] text-slate-500">{viaLabel(ws)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void openWorkspace(ws.id)}
                  className="rounded-md border border-[#e2e2e2] px-3 py-1.5 text-[12px] hover:bg-slate-50"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setAccess('none')} className="mt-5 w-full text-center text-[13px] text-slate-500 underline">
            Create my own restaurant instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] flex flex-col font-inter">
      {step === 1 && (
        <button
          type="button"
          onClick={handleBackStep}
          aria-label="Back"
          className="fixed top-4 left-4 z-50 h-10 w-10 rounded-full border border-[#cecece] bg-white/90 text-[#2e2e30] hover:bg-[#f5f5f5] shadow-sm flex items-center justify-center"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      <div className={`w-full flex flex-col items-center mx-auto transition-all duration-300 ${step === 0 ? 'max-w-[512px] mt-40' : 'max-w-[680px] mt-24'} px-4`}>
        {(!user?.tenantId && !loading) && (
          <AnimatePresence mode="wait">
            {step === 0 ? (
              <motion.div
                key="step-name"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
                className="w-full flex flex-col items-center"
              >
                <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">
                  Create your Qravy Account
                </h2>
                <p className="w-96 text-sm text-[#5b5b5d] text-center mt-3 mb-8">
                  We’ll set up your Restaurant Account and Subdomain. You can change these later.
                </p>

                <form onSubmit={handleNextStep} noValidate className="w-full flex flex-col items-center">
                  {/* Restaurant name */}
                  <div className="w-96 mb-4">
                    <label htmlFor="restaurant-name" className="block text-base text-[#2e2e30] mb-1">
                      Restaurant name
                    </label>
                    <input
                      id="restaurant-name"
                      type="text"
                      placeholder="Enter your restaurant name."
                      className="p-3 w-full border border-[#cecece] hover:border-[#b0b0b5] rounded-md text-[#2e2e30] bg-transparent focus:outline-none text-base font-normal"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setLocalError(null);
                      }}
                      required
                      autoComplete="organization"
                    />
                  </div>

                  {/* Subdomain */}
                  <div className="w-96 mb-2">
                    <label htmlFor="restaurant-url" className="block text-base text-[#2e2e30] mb-1">
                      Subdomain
                    </label>
                    <div
                      className={`relative flex items-center gap-2 rounded-md border bg-white transition px-2 ${
                        urlTaken ? 'border-amber-400' : 'border-[#cecece] hover:border-[#b0b0b5]'
                      }`}
                    >
                      <span className="select-none text-[#2e2e30] shrink-0 whitespace-nowrap">
                        <span className="inline-flex items-center h-8 px-2 rounded bg-[#f7f7f9] text-sm leading-none">
                          https://
                        </span>
                      </span>
                      <input
                        id="restaurant-url"
                        ref={urlInputRef}
                        type="text"
                        aria-describedby="restaurant-url-status"
                        aria-invalid={urlTaken}
                        placeholder="your-restaurant"
                        className="flex-1 min-w-0 px-2 py-3 bg-transparent text-[#2e2e30] focus:outline-none text-base font-normal"
                        value={restaurantUrl}
                        onChange={(e) => {
                          setRestaurantUrl(normalizeSlugInput(e.target.value));
                          setSlugManuallyEdited(true);
                          setLocalError(null);
                        }}
                        required
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="text"
                      />
                      <span className="select-none text-[#2e2e30] shrink-0 whitespace-nowrap">
                        <span className="inline-flex items-center h-8 px-2 rounded bg-[#f7f7f9] text-sm leading-none">
                          .qravy.com
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Free or taken — a soft alert, never a dead end: pick a free one or type another */}
                  <div id="restaurant-url-status" aria-live="polite" className="w-96">
                    {urlCheck.state === 'checking' && (
                      <div className="mb-3 text-xs text-[#8a8a8d]">Checking {urlCheck.subdomain}.qravy.com…</div>
                    )}
                    {urlCheck.state === 'available' && urlCheck.subdomain === restaurantUrl && (
                      <div className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700">
                        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {urlCheck.subdomain}.qravy.com is available
                      </div>
                    )}
                    {urlCheck.state === 'taken' && urlTaken && (
                      <div role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="font-medium">
                          {urlCheck.reserved
                            ? `${urlCheck.subdomain}.qravy.com is reserved`
                            : `${urlCheck.subdomain}.qravy.com is already taken`}
                        </div>
                        <p className="mt-1 text-xs text-amber-800">
                          Your restaurant name is fine — only the web address needs to be different.
                          {urlCheck.suggestions.length ? ' Pick one of these, or type your own:' : ' Try another one.'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {urlCheck.suggestions.map((sug) => (
                            <button
                              key={sug}
                              type="button"
                              onClick={() => pickSuggestion(sug)}
                              className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs text-[#2e2e30] hover:border-amber-500"
                            >
                              {sug}.qravy.com
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={editUrl}
                            className="rounded-full px-2.5 py-1 text-xs font-medium text-amber-900 underline-offset-2 hover:underline"
                          >
                            Edit subdomain
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Info box */}
                  <div
                    id="restaurant-url-help"
                    className="w-96 text-xs text-[#2e2e30] bg-[#f7f7f9] rounded-md p-3 mb-4 flex items-start gap-2"
                  >
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      className="mt-0.5 text-[#5b5b5d]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span className="text-[#5b5b5d]">You can add a custom domain later if you want.</span>
                  </div>

                  {localError && (
                    <div className="text-red-500 -mt-1 mb-3 text-sm w-96 font-normal text-left">
                      {localError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-96 h-12 rounded-md font-medium mb-2 transition border text-center bg-[#2e2e30] border-[#2e2e30] text-white hover:bg-[#262629]"
                  >
                    Continue
                  </button>
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="step-channels"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="w-full flex flex-col items-center"
              >
                <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">
                  How will your customers order?
                </h2>
                <p className="w-96 text-sm text-[#5b5b5d] text-center mt-3 mb-8">
                  Toggle active channels. We'll preconfigure your workspace, menu structures, and order dispatch workflows.
                </p>

                <form onSubmit={handleSubmit} noValidate className="w-full flex flex-col items-center">
                  <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                    {/* Dine-in Option */}
                    <motion.div
                      onClick={() => {
                        const newVal = !dineInEnabled;
                        if (!newVal && !onlineSalesEnabled) {
                          setLocalError('At least one ordering channel must be selected.');
                          return;
                        }
                        setLocalError(null);
                        setDineInEnabled(newVal);
                      }}
                      whileHover={{ y: -4, transition: { duration: 0.15 } }}
                      whileTap={{ scale: 0.98 }}
                      className={[
                        'relative flex flex-col p-6 rounded-xl border text-left cursor-pointer select-none min-h-[260px] justify-between transition-colors duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.01)]',
                        dineInEnabled
                          ? 'border-[#2e2e30] bg-[#f7f7f9] ring-1 ring-[#2e2e30]'
                          : 'border-[#cecece] hover:border-[#b0b0b5] bg-white'
                      ].join(' ')}
                    >
                      {dineInEnabled && (
                        <span className="absolute top-4 left-4 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2e2e30] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2e2e30]"></span>
                        </span>
                      )}

                      <div className="w-full">
                        <div className="flex justify-between items-start mb-4 pl-4">
                          <div className="text-[#2e2e30] mt-1">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="7" height="7" rx="1"/>
                              <rect x="14" y="3" width="7" height="7" rx="1"/>
                              <rect x="14" y="14" width="7" height="7" rx="1"/>
                              <rect x="3" y="14" width="7" height="7" rx="1"/>
                              <line x1="7" y1="7" x2="7.01" y2="7"/>
                              <line x1="17" y1="7" x2="17.01" y2="7"/>
                              <line x1="17" y1="17" x2="17.01" y2="17"/>
                              <line x1="7" y1="17" x2="7.01" y2="17"/>
                            </svg>
                          </div>
                          
                          <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition-all duration-200 ${
                            dineInEnabled ? 'border-[#2e2e30] bg-[#2e2e30]' : 'border-[#cecece]'
                          }`}>
                            {dineInEnabled && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                        </div>

                        <span className="text-base font-semibold text-[#2e2e30] block tracking-tight">
                          Dine-in (QR Ordering)
                        </span>
                        <span className="text-xs leading-relaxed text-[#5b5b5d] mt-2 block">
                          Contactless ordering system with our AI Waiter. Customers scan QR codes at tables to view menus, place orders, and pay.
                        </span>
                      </div>

                      {/* Capabilities list */}
                      <div className="mt-5 pt-4 border-t border-[#efeff2] flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 text-[11px] text-[#5b5b5d]">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#2e2e30] shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Dynamic QR Table Codes</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#5b5b5d]">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#2e2e30] shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Conversational AI Waiter</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#5b5b5d]">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#2e2e30] shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Direct Table Billing & Pay</span>
                        </div>
                      </div>
                    </motion.div>

                    {/* Online storefront Option */}
                    <motion.div
                      onClick={() => {
                        const newVal = !onlineSalesEnabled;
                        if (!newVal && !dineInEnabled) {
                          setLocalError('At least one ordering channel must be selected.');
                          return;
                        }
                        setLocalError(null);
                        setOnlineSalesEnabled(newVal);
                      }}
                      whileHover={{ y: -4, transition: { duration: 0.15 } }}
                      whileTap={{ scale: 0.98 }}
                      className={[
                        'relative flex flex-col p-6 rounded-xl border text-left cursor-pointer select-none min-h-[260px] justify-between transition-colors duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.01)]',
                        onlineSalesEnabled
                          ? 'border-[#2e2e30] bg-[#f7f7f9] ring-1 ring-[#2e2e30]'
                          : 'border-[#cecece] hover:border-[#b0b0b5] bg-white'
                      ].join(' ')}
                    >
                      {onlineSalesEnabled && (
                        <span className="absolute top-4 left-4 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2e2e30] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2e2e30]"></span>
                        </span>
                      )}

                      <div className="w-full">
                        <div className="flex justify-between items-start mb-4 pl-4">
                          <div className="text-[#2e2e30] mt-1">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                              <line x1="3" y1="6" x2="21" y2="6"/>
                              <path d="M16 10a4 4 0 0 1-8 0"/>
                            </svg>
                          </div>
                          
                          <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition-all duration-200 ${
                            onlineSalesEnabled ? 'border-[#2e2e30] bg-[#2e2e30]' : 'border-[#cecece]'
                          }`}>
                            {onlineSalesEnabled && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                        </div>

                        <span className="text-base font-semibold text-[#2e2e30] block tracking-tight">
                          Online Storefront
                        </span>
                        <span className="text-xs leading-relaxed text-[#5b5b5d] mt-2 block">
                          Storefront link for customers. Supports local counter pickup or deliveries fulfilled by your in-house delivery runners.
                        </span>
                      </div>

                      {/* Capabilities list */}
                      <div className="mt-5 pt-4 border-t border-[#efeff2] flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 text-[11px] text-[#5b5b5d]">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#2e2e30] shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Branded Subdomain Page</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#5b5b5d]">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#2e2e30] shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Local Counter Pickup Options</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#5b5b5d]">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#2e2e30] shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>In-house Delivery Integration</span>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {localError && (
                    <div className="text-red-500 -mt-1 mb-3 text-sm w-full font-normal text-left">
                      {localError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className={`w-full h-12 rounded-md font-medium mb-2 transition border text-center ${
                      isSubmitting
                        ? 'bg-[#efeff2] border-[#dcdce1] text-[#9a9aa1] cursor-not-allowed'
                        : 'bg-[#2e2e30] border-[#2e2e30] text-white hover:bg-[#262629]'
                    }`}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Creating…' : 'Create restaurant'}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32);
}

function normalizeSlugInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32);
}

function validate(name: string, slug: string): string | null {
  if (!name.trim()) return 'Please enter a restaurant name.';
  const valid = /^[a-z0-9-]{3,32}$/.test(slug);
  if (!valid) return 'Please enter a valid URL.';
  if (/--/.test(slug) || slug.startsWith('-') || slug.endsWith('-')) {
    return 'The URL cannot start/end with a hyphen or contain consecutive hyphens.';
  }
  return null;
}