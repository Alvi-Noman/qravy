import React from 'react';
import { Link } from 'react-router-dom';
import type { Channel } from '../api/storefront';

type Props = {
  /** Currently active channel */
  channel: Channel;
  /** Target href for the Dine-in/Pickup tab */
  dineInHref: string;
  /** Target href for the Delivery/Online tab */
  onlineHref: string;
  /** When true, keep visual state neutral (don’t highlight active) */
  showSkeleton?: boolean;
  /** Mark the switch action (used by caller to set the session flag) */
  onSwitch?: (targetPath: string) => void;
  /** Optional className wrapper */
  className?: string;
};

/**
 * Segmented pill switch for Pickup (dine-in) / Delivery (online).
 * Pure client-side; relies on react-router <Link>.
 */
export default function ChannelSwitch({
  channel,
  dineInHref,
  onlineHref,
  showSkeleton = false,
  onSwitch,
  className,
}: Props) {
  const handle = (to: string) => () => onSwitch?.(to);

  return (
    <div className={['relative', className ?? ''].join(' ')}>
      <div className="inline-flex items-center rounded-full border-2 border-[#FA2851] bg-white p-1 shadow-sm">
        <Link
          to={dineInHref}
          onClick={handle(dineInHref)}
          className={
            'relative z-10 rounded-full px-4 py-1.5 text-sm font-semibold transition ' +
            (channel === 'dine-in' && !showSkeleton
              ? 'bg-[#FA2851] text-white shadow-sm'
              : 'text-[#FA2851] hover:bg-[#FFE5EC]')
          }
        >
          Pickup
        </Link>
        <Link
          to={onlineHref}
          onClick={handle(onlineHref)}
          className={
            'relative z-10 rounded-full px-4 py-1.5 text-sm font-semibold transition ' +
            (channel === 'online' && !showSkeleton
              ? 'bg-[#FA2851] text-white shadow-sm'
              : 'text-[#FA2851] hover:bg-[#FFE5EC]')
          }
        >
          Delivery
        </Link>
      </div>
    </div>
  );
}
