import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthContext } from '../context/AuthContext';
import { createTenant } from '../api/auth';

export default function CreateRestaurant() {
  const navigate = useNavigate();
  const { user, loading } = useAuthContext();

  const [name, setName] = useState('');
  const [restaurantUrl, setRestaurantUrl] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError(null);

    const error = validate(name, restaurantUrl);
    if (error) {
      setLocalError(error);
      return;
    }

    try {
      setIsSubmitting(true);
      await createTenant({
        name: name.trim(),
        subdomain: restaurantUrl.trim().toLowerCase(),
      });
      navigate('/onboarding', { replace: true });
    } catch (err) {
      const msg = (err as Error)?.message || 'Could not create restaurant. Please try again.';
      if (/subdomain/i.test(msg) || /taken/i.test(msg) || /409/.test(msg)) {
        setLocalError('That URL is taken. Please try a different one.');
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
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-60">
        {(!user?.tenantId && !loading) && (
          <AnimatePresence mode="wait">
            <motion.div
              key="create-restaurant"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center"
            >
              <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">
                Create your Qravy Account
              </h2>
              <p className="w-96 text-sm text-[#5b5b5d] text-center mt-3 mb-8">
                We’ll set up your Restaurant Account and Subdomain. You can change these later.
              </p>

              <form onSubmit={handleSubmit} noValidate className="w-full flex flex-col items-center">
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
                    disabled={isSubmitting}
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
                      disabled={isSubmitting}
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
                  className={`w-96 h-12 rounded-md font-medium mb-2 transition border text-center ${
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