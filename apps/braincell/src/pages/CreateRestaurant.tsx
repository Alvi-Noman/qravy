import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthContext } from '../context/AuthContext';
import { createTenant } from '../api/auth';

export default function CreateRestaurant() {
  const navigate = useNavigate();
  const { user, loading } = useAuthContext();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [restaurantUrl, setRestaurantUrl] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  
  // Channels selection states
  const [dineInEnabled, setDineInEnabled] = useState(true);
  const [onlineSalesEnabled, setOnlineSalesEnabled] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const error = validate(name, restaurantUrl);
    if (error) {
      setLocalError(error);
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
      if (/subdomain/i.test(msg) || /taken/i.test(msg) || /409/.test(msg)) {
        setLocalError('That URL is taken. Please try a different one.');
        setStep(0); // return to step 0 if URL error
      } else if (/already has a tenant/i.test(msg)) {
        navigate('/onboarding', { replace: true });
      } else {
        setLocalError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

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
                    <div className="relative flex items-center gap-2 rounded-md border border-[#cecece] hover:border-[#b0b0b5] bg-white transition px-2">
                      <span className="select-none text-[#2e2e30] shrink-0 whitespace-nowrap">
                        <span className="inline-flex items-center h-8 px-2 rounded bg-[#f7f7f9] text-sm leading-none">
                          https://
                        </span>
                      </span>
                      <input
                        id="restaurant-url"
                        type="text"
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