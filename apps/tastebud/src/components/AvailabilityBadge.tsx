import React from 'react';

type Props = {
  unavailable: boolean;
  className?: string;
  size?: 'sm' | 'md';
};

export default function AvailabilityBadge({ unavailable, className, size = 'sm' }: Props) {
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs';
  if (unavailable) {
    return (
      <span
        className={`mt-2 w-fit rounded-full bg-yellow-50 ${pad} font-medium text-yellow-700 ring-1 ring-yellow-200 ${className ?? ''}`}
      >
        Unavailable
      </span>
    );
  }
  return (
    <span
      className={`mt-2 w-fit rounded-full bg-emerald-50 ${pad} font-medium text-emerald-700 ring-1 ring-emerald-200 ${className ?? ''}`}
    >
      Available
    </span>
  );
}
