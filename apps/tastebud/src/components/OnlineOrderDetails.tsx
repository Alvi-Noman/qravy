// apps/tastebud/src/components/OnlineOrderDetails.tsx
// Online checkout details: Pickup / Delivery, then name, phone and (for delivery) address.
import React from 'react';
import type { Fulfillment, GuestContact } from '../utils/order-mode';

type Props = {
  fulfillment: Fulfillment;
  onFulfillment: (f: Fulfillment) => void;
  contact: GuestContact;
  onContact: (patch: Partial<GuestContact>) => void;
  /** Field to highlight + focus (e.g. after the server said it's missing) */
  focusField?: keyof GuestContact | null;
  compact?: boolean;
};

export function FulfillmentToggle({
  value,
  onChange,
  className,
}: {
  value: Fulfillment;
  onChange: (f: Fulfillment) => void;
  className?: string;
}) {
  const btn = (f: Fulfillment, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === f}
      onClick={() => onChange(f)}
      className={
        'relative z-10 rounded-full px-4 py-1.5 text-sm font-semibold transition ' +
        (value === f ? 'bg-[#FA2851] text-white shadow-sm' : 'text-[#FA2851] hover:bg-[#FFE5EC]')
      }
    >
      {label}
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="Pickup or delivery"
      className={'inline-flex items-center rounded-full border-2 border-[#FA2851] bg-white p-1 shadow-sm ' + (className ?? '')}
    >
      {btn('pickup', 'Pickup')}
      {btn('delivery', 'Delivery')}
    </div>
  );
}

export default function OnlineOrderDetails({ fulfillment, onFulfillment, contact, onContact, focusField, compact }: Props) {
  const refs = {
    name: React.useRef<HTMLInputElement | null>(null),
    phone: React.useRef<HTMLInputElement | null>(null),
    address: React.useRef<HTMLTextAreaElement | null>(null),
  };

  React.useEffect(() => {
    if (focusField) window.setTimeout(() => refs[focusField].current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField]);

  const input =
    'w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#FA2851]/40 ' +
    (compact ? 'text-[14px]' : 'text-[15px]');
  const ring = (f: keyof GuestContact) => (focusField === f ? 'border-[#FA2851]' : 'border-gray-200');
  const label = 'block text-[12px] font-medium text-gray-600 mb-1';

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-gray-600">How do you want it?</span>
        <FulfillmentToggle value={fulfillment} onChange={onFulfillment} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="guest-name">Name</label>
          <input
            id="guest-name"
            ref={refs.name}
            value={contact.name}
            onChange={(e) => onContact({ name: e.target.value })}
            autoComplete="name"
            maxLength={80}
            placeholder="Your name"
            className={`${input} ${ring('name')}`}
          />
        </div>
        <div>
          <label className={label} htmlFor="guest-phone">Phone</label>
          <input
            id="guest-phone"
            ref={refs.phone}
            value={contact.phone}
            onChange={(e) => onContact({ phone: e.target.value })}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            placeholder="01XXXXXXXXX"
            className={`${input} ${ring('phone')}`}
          />
        </div>
      </div>

      {fulfillment === 'delivery' && (
        <div className="mt-3">
          <label className={label} htmlFor="guest-address">Delivery address</label>
          <textarea
            id="guest-address"
            ref={refs.address}
            value={contact.address}
            onChange={(e) => onContact({ address: e.target.value })}
            autoComplete="street-address"
            maxLength={300}
            rows={2}
            placeholder="House, road, area — and a landmark if it helps"
            className={`${input} ${ring('address')}`}
          />
        </div>
      )}

      <p className="mt-2 text-[11px] text-gray-400">
        {fulfillment === 'delivery' ? 'Cash on delivery' : 'Pay when you pick it up'}
      </p>
    </div>
  );
}

export const CONTACT_MESSAGES: Record<keyof GuestContact, string> = {
  name: 'Please enter your name.',
  phone: 'Please enter a phone number we can call.',
  address: 'Please enter your delivery address.',
};
