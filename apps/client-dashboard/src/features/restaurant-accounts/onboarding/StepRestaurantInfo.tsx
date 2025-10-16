import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RestaurantInfo } from './types';
import api from '../../../api/auth';

type Props = {
  value: RestaurantInfo;
  onChange: (v: RestaurantInfo) => void;
  onNext: () => void;
};

const CATEGORIES = [
  'Quick Service (Fast Food)',
  'Casual Dining',
  'Fine Dining',
  'Café / Coffee Shop',
  'Bakery / Dessert Shop',
  'Bar / Pub / Taproom',
  'Buffet / Family Style',
  'Food Truck / Street Food Vendor',
  'Food Court / Cafeteria',
  'Catering / Events Venue',
  'Cloud Kitchen / Virtual Brand',
  'Other',
];

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Argentina','Australia','Austria','Bangladesh','Belgium','Brazil','Bulgaria',
  'Cambodia','Canada','Chile','China','Colombia','Costa Rica','Croatia','Cyprus','Czechia','Denmark','Egypt','Estonia',
  'Finland','France','Germany','Ghana','Greece','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq',
  'Ireland','Israel','Italy','Japan','Jordan','Kenya','Kuwait','Latvia','Lebanon','Lithuania','Luxembourg','Malaysia',
  'Malta','Mexico','Morocco','Nepal','Netherlands','New Zealand','Nigeria','Norway','Pakistan','Peru','Philippines',
  'Poland','Portugal','Qatar','Romania','Russia','Saudi Arabia','Serbia','Singapore','Slovakia','Slovenia','South Africa',
  'South Korea','Spain','Sri Lanka','Sweden','Switzerland','Taiwan','Thailand','Tunisia','Turkey','United Arab Emirates',
  'United Kingdom','United States','Ukraine','Vietnam','Other'
];

export default function StepRestaurantInfo({ value, onChange, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const countryRef = useRef<HTMLDivElement | null>(null);

  // Do NOT default; leave undefined until user picks one
  const locationMode = value.locationMode;

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [countryQuery]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (catOpen && catRef.current && !catRef.current.contains(t)) setCatOpen(false);
      if (countryOpen && countryRef.current && !countryRef.current.contains(t)) setCountryOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCatOpen(false);
        setCountryOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [catOpen, countryOpen]);

  const selectCategory = (c: string) => {
    onChange({ ...value, restaurantType: c });
    setError(null);
    setCatOpen(false);
  };

  const selectCountry = (c: string) => {
    onChange({ ...value, country: c });
    setError(null);
    setCountryOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.restaurantType.trim()) return setError('Please select a restaurant category.');
    if (!value.country.trim()) return setError('Please select your country.');
    if (!value.address.trim()) return setError('Please enter your address.');

    // Send as-is; locationMode may be undefined if not selected.
    await api.post('/api/v1/auth/tenants/onboarding-step', {
      step: 'restaurant',
      data: value,
    });

    onNext();
  };

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">Restaurant Information</h2>
      <p className="text-sm text-[#5b5b5d] text-center mt-3 mb-8">
        These details appear on your profile. You can update them anytime.
      </p>

      <div className="w-full mb-4 relative" ref={catRef}>
        <label htmlFor="category-trigger" className="block text-base text-[#2e2e30] mb-1">Restaurant category?</label>
        <button
          id="category-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={catOpen}
          onClick={() => setCatOpen(v => !v)}
          className={[
            'w-full h-12 px-3 border rounded-md bg-white text-left text-[#2e2e30] text-base font-normal',
            'transition-colors',
            catOpen ? 'border-[#b0b0b5]' : 'border-[#cecece] hover:border-[#b0b0b5]',
            'focus:outline-none'
          ].join(' ')}
        >
          <div className="w-full flex items-center justify-between">
            <span className={value.restaurantType ? 'text-[#2e2e30]' : 'text-[#5b5b5d]'}>{value.restaurantType || 'Select a restaurant category'}</span>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" className="text-[#5b5b5d] transition-transform" style={{ transform: catOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </button>
        <AnimatePresence>
          {catOpen && (
            <motion.div
              role="listbox"
              aria-labelledby="category-trigger"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-full mt-2 z-[9999] max-h-64 overflow-auto rounded-md border border-[#cecece] bg-white shadow-[0_8px_20px_rgba(0,0,0,0.06)]"
            >
              {CATEGORIES.map((c) => {
                const selected = c === value.restaurantType;
                return (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectCategory(c)}
                    className={[
                      'w-full text-left px-3 py-2 text-sm flex items-center justify-between',
                      'transition-colors',
                      selected ? 'bg-[#efeff2] text-[#2e2e30]' : 'hover:bg-[#f5f5f5] text-[#2e2e30]'
                    ].join(' ')}
                  >
                    <span>{c}</span>
                    {selected && <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className="text-[#2e2e30]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="w-full mb-4 relative" ref={countryRef}>
        <label htmlFor="country-trigger" className="block text-base text-[#2e2e30] mb-1">Country</label>
        <button
          id="country-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={countryOpen}
          onClick={() => setCountryOpen(v => !v)}
          className={[
            'w-full h-12 px-3 border rounded-md bg-white text-left text-[#2e2e30] text-base font-normal',
            'transition-colors',
            countryOpen ? 'border-[#b0b0b5]' : 'border-[#cecece] hover:border-[#b0b0b5]'
          ].join(' ')}
        >
          <div className="w-full flex items-center justify-between">
            <span className={value.country ? 'text-[#2e2e30]' : 'text-[#5b5b5d]'}>{value.country || 'Select your country'}</span>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" className="text-[#5b5b5d] transition-transform" style={{ transform: countryOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </button>
        <AnimatePresence>
          {countryOpen && (
            <motion.div
              role="listbox"
              aria-labelledby="country-trigger"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-full mt-2 z-[9999] max-h-[32rem] overflow-hidden rounded-md border border-[#cecece] bg-white shadow-md"
            >
              <div className="sticky top-0 z-10 bg-white border-b border-[#ececec] p-2">
                <input
                  type="text"
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  placeholder="Search country"
                  className="w-full rounded-md border border-[#dbdbdb] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] focus:outline-none focus:border-[#b0b0b5]"
                />
              </div>
              <div className="max-h-[29rem] overflow-y-auto">
                {filteredCountries.length === 0 && <div className="px-3 py-3 text-sm text-[#6b7280]">No results</div>}
                {filteredCountries.map((c) => {
                  const selected = c === value.country;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => selectCountry(c)}
                      className={[
                        'w-full text-left px-3 py-2 text-sm flex items-center justify-between',
                        'transition-colors',
                        selected ? 'bg-[#efeff2] text-[#2e2e30]' : 'hover:bg-[#f5f5f5] text-[#2e2e30]'
                      ].join(' ')}
                    >
                      <span>{c}</span>
                      {selected && <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className="text-[#2e2e30]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Multiple locations question (no counts here) */}
      <div className="w-full mb-4" role="radiogroup" aria-labelledby="location-mode-label">
        <label id="location-mode-label" className="block text-base text-[#2e2e30] mb-1">
          Do you have multiple restaurant locations?
        </label>
        <div className="mt-2 flex flex-wrap gap-3">
          <label
            className={[
              'inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 transition-colors',
              locationMode === 'single' ? 'border-[#2e2e30] bg-[#efeff2]' : 'border-[#cecece] hover:border-[#b0b0b5]'
            ].join(' ')}
          >
            <input
              type="radio"
              name="location-mode"
              value="single"
              className="sr-only"
              checked={locationMode === 'single'}
              onChange={() => { onChange({ ...value, locationMode: 'single' }); setError(null); }}
            />
            <span className="text-sm text-[#2e2e30]">Single location</span>
          </label>

          <label
            className={[
              'inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 transition-colors',
              locationMode === 'multiple' ? 'border-[#2e2e30] bg-[#efeff2]' : 'border-[#cecece] hover:border-[#b0b0b5]'
            ].join(' ')}
          >
            <input
              type="radio"
              name="location-mode"
              value="multiple"
              className="sr-only"
              checked={locationMode === 'multiple'}
              onChange={() => { onChange({ ...value, locationMode: 'multiple' }); setError(null); }}
            />
            <span className="text-sm text-[#2e2e30]">Multiple locations</span>
          </label>
        </div>
      </div>

      <div className="w-full mb-4">
        <label htmlFor="address" className="block text-base text-[#2e2e30] mb-1">Address</label>
        <input
          id="address"
          type="text"
          placeholder="Enter your main restaurant address."
          className="p-3 w-full border border-[#cecece] hover:border-[#b0b0b5] rounded-md text-[#2e2e30] bg-transparent focus:outline-none text-base font-normal"
          value={value.address}
          onChange={(e) => { onChange({ ...value, address: e.target.value }); setError(null); }}
          autoComplete="street-address"
        />
      </div>

      {error && <div className="text-red-500 -mt-1 mb-3 text-sm w-full text-left">{error}</div>}

      <button
        type="submit"
        className="w-full h-12 rounded-md font-medium transition border text-center bg-[#2e2e30] border-[#2e2e30] text-white hover:bg-[#262629]"
      >
        Continue
      </button>
    </form>
  );
}