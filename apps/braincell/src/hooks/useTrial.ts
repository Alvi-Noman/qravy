// apps/braincell/src/hooks/useTrial.ts
import { useEffect, useMemo, useState } from 'react';

// Helper: parse date safely
function parseISO(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export type TrialStatus = {
  endsAt: Date | null;
  daysLeft: number;  // rounded up
  hoursLeft: number; // remainder hours
  expired: boolean;
};

type TenantTrialShape = {
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
};

// Uses server-provided trial where available, with localStorage fallback for dev.
export function useTrial(tenant?: TenantTrialShape): TrialStatus {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000); // tick per minute
    return () => clearInterval(id);
  }, []);

  // Prefer server-provided trialEndsAt. Fallback to local (for dev).
  const endsAt = useMemo(() => {
    const server = parseISO(tenant?.trialEndsAt ?? null);
    if (server) return server;

    // DEV fallback: seed 14d if missing
    try {
      const local = localStorage.getItem('billing:trialEndsAt');
      let d = parseISO(local);
      if (!d) {
        const seeded = new Date(Date.now() + 14 * 24 * 3600 * 1000);
        localStorage.setItem('billing:trialEndsAt', seeded.toISOString());
        d = seeded;
      }
      return d!;
    } catch {
      return null;
    }
  }, [tenant?.trialEndsAt]);

  const diffMs = Math.max(0, (endsAt?.getTime() || 0) - now);
  const totalHours = Math.ceil(diffMs / 3600000);
  const daysLeft = Math.ceil(totalHours / 24);
  const hoursLeft = totalHours % 24;
  const expired = diffMs <= 0;

  return { endsAt, daysLeft, hoursLeft, expired };
}