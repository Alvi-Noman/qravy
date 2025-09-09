// apps/client-dashboard/src/pages/CreateRestaurant.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthContext } from '../context/AuthContext';

export default function CreateRestaurant() {
  const navigate = useNavigate();
  const { user, loading } = useAuthContext();

  const [name, setName] = useState('');
  const [restaurantUrl, setRestaurantUrl] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // If already onboarded, send to dashboard
  useEffect(() => {
    if (!loading && user?.isOnboarded) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, user, navigate]);

  // Auto-generate slug from name until user edits slug manually
  useEffect(() => {
    if (!slugManuallyEdited) {
      const next = slugify(name);
      setRestaurantUrl(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

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
      // TODO: Call your backend API to create restaurant
      // await api.createRestaurant({ name, restaurantUrl });
      navigate('/welcome');
    } catch (err) {
      setLocalError((err as Error)?.message || 'Could not create restaurant. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] flex flex-col font-inter">
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-60">
        <AnimatePresence mode="wait">
          <motion.div
            key="create-restaurant"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="w-full flex flex-col items-center"
          >
            <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">Create your Qravy Account</h2>

            <form onSubmit={handleSubmit} noValidate className="w-full flex flex-col items-center">
              <label className="sr-only" htmlFor="restaurant-name">Restaurant name</label>
              <input
                id="restaurant-name"
                type="text"
                placeholder="Restaurant name"
                className="p-3 w-96 border border-[#cecece] hover:border-[#b0b0b5] rounded-md mb-4 text-[#2e2e30] bg-transparent focus:outline-none text-base font-normal focus:border-[#b0b0b5]"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setLocalError(null);
                }}
                required
                disabled={isSubmitting}
                autoComplete="organization"
              />

              {/* URL input group with padding and taller chips, no blue focus ring */}
              <div className="w-96 mb-2">
                <label htmlFor="restaurant-url" className="block text-sm text-[#5b5b5d] mb-1">
                  Restaurant URL
                </label>
                <div
                  className={`relative flex items-center gap-2 rounded-md border border-[#cecece] hover:border-[#b0b0b5] bg-white transition px-2`}
                >
                  <span className="select-none text-[#5b5b5d] shrink-0 whitespace-nowrap">
                    <span className="inline-flex items-center h-8 px-2 rounded bg-[#f7f7f9] text-sm leading-none">
                      https://
                    </span>
                  </span>

                  <input
                    id="restaurant-url"
                    type="text"
                    aria-label="Restaurant URL"
                    aria-describedby="restaurant-url-help"
                    aria-invalid={!!localError}
                    aria-errormessage={localError ? 'restaurant-url-error' : undefined}
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

                  <span className="select-none text-[#5b5b5d] shrink-0 whitespace-nowrap">
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
                <span className="text-[#5b5b5d]">
                  This will be your restaurant’s unique web address
                </span>
              </div>

              {localError && (
                <div
                  id="restaurant-url-error"
                  className="text-red-500 -mt-2 mb-4 text-sm w-96 font-normal text-left"
                  role="alert"
                  aria-live="polite"
                >
                  {localError}
                </div>
              )}

              <button
                type="submit"
                className={`w-96 h-12 rounded-md font-medium mb-4 transition border text-center
                  ${isSubmitting
                    ? 'bg-[#fefefe] border-[#cecece] text-[#b0b0b5] cursor-not-allowed'
                    : 'bg-white border-[#cecece] text-[#2e2e30] hover:bg-[#f5f5f5]'
                  }
                `}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating…' : 'Create restaurant'}
              </button>
            </form>
          </motion.div>
        </AnimatePresence>
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