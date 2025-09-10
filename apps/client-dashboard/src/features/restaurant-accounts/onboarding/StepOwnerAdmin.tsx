import { useEffect, useRef, useState } from 'react';
import type { OwnerAdminInfo } from './types';

type Props = { value: OwnerAdminInfo; onChange: (v: OwnerAdminInfo) => void; onNext: () => void };

const DIAL_CODES: Array<{ code: string; label: string }> = [
  { code: '+880', label: 'Bangladesh' },
  { code: '+1', label: 'United States/Canada' },
  { code: '+44', label: 'United Kingdom' },
  { code: '+61', label: 'Australia' },
  { code: '+64', label: 'New Zealand' },
  { code: '+81', label: 'Japan' },
  { code: '+82', label: 'South Korea' },
  { code: '+86', label: 'China' },
  { code: '+91', label: 'India' },
  { code: '+92', label: 'Pakistan' },
  { code: '+971', label: 'UAE' },
  { code: '+966', label: 'Saudi Arabia' },
  { code: '+60', label: 'Malaysia' },
  { code: '+62', label: 'Indonesia' },
  { code: '+63', label: 'Philippines' },
  { code: '+65', label: 'Singapore' },
  { code: '+7', label: 'Russia/Kazakhstan' },
  { code: '+49', label: 'Germany' },
  { code: '+33', label: 'France' },
  { code: '+39', label: 'Italy' },
  { code: '+34', label: 'Spain' },
  { code: '+351', label: 'Portugal' },
  { code: '+20', label: 'Egypt' },
  { code: '+27', label: 'South Africa' },
];

export default function StepOwnerAdmin({ value, onChange, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [dialCode, setDialCode] = useState<string>('+880');
  const [open, setOpen] = useState<boolean>(false);
  const groupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!groupRef.current) return;
      if (!groupRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.fullName.trim()) return setError('Please enter your name.');
    if (!value.phone.trim()) return setError('Please enter your phone number.');
    onNext();
  };

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <h2 className="text-xl font-medium text-[#2e2e30] text-center mb-2">Owner or Admin Information</h2>
      <p className="text-sm text-[#5b5b5d] text-center mt-3 mb-8">
        This information helps us protect your account and make sure you receive important updates.
      </p>

      <div className="w-full mb-4">
        <label htmlFor="owner-name" className="block text-base text-[#2e2e30] mb-1">Your name</label>
        <input
          id="owner-name"
          type="text"
          placeholder="Enter your name here."
          className="p-3 w-full border border-[#cecece] hover:border-[#b0b0b5] rounded-md text-[#2e2e30] bg-transparent focus:outline-none text-base font-normal"
          value={value.fullName}
          onChange={(e) => {
            onChange({ ...value, fullName: e.target.value });
            setError(null);
          }}
          autoComplete="name"
        />
      </div>

      <div className="w-full mb-4">
        <label htmlFor="owner-phone" className="block text-base text-[#2e2e30] mb-1">Phone number</label>

        <div
          ref={groupRef}
          className="relative flex items-center gap-2 rounded-md border border-[#cecece] hover:border-[#b0b0b5] bg-white transition px-2"
        >
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center h-8 px-2 rounded bg-[#f7f7f9] text-sm leading-none text-[#2e2e30]"
            title={DIAL_CODES.find(d => d.code === dialCode)?.label || dialCode}
          >
            {dialCode}
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              className="ml-1 text-[#5b5b5d]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <input
            id="owner-phone"
            type="tel"
            placeholder="Enter your phone number."
            className="flex-1 min-w-0 px-2 py-3 bg-transparent text-[#2e2e30] focus:outline-none text-base font-normal"
            value={value.phone}
            onChange={(e) => {
              onChange({ ...value, phone: e.target.value });
              setError(null);
            }}
            autoComplete="tel"
          />

          {open && (
            <div
              role="listbox"
              className="absolute left-2 top-full mt-2 z-50 w-64 max-h-64 overflow-auto rounded-md border border-[#cecece] bg-white shadow-sm"
            >
              {DIAL_CODES.map(({ code, label }) => {
                const selected = code === dialCode;
                return (
                  <button
                    key={code}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setDialCode(code);
                      setOpen(false);
                    }}
                    className={[
                      'w-full text-left px-3 py-2 text-sm transition',
                      selected ? 'bg-[#f0f0f3] text-[#2e2e30]' : 'hover:bg-[#f5f5f5] text-[#2e2e30]',
                    ].join(' ')}
                    title={label}
                  >
                    <span className="font-medium mr-2">{code}</span>
                    <span className="text-[#5b5b5d]">{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
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