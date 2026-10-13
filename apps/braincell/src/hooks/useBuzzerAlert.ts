/**
 * useBuzzerAlert — polls the ai-waiter-service /alert endpoint every 2 s.
 * Returns whether the counter buzzer is currently active and a dismiss fn.
 *
 * The ESP32 on the counter also polls the same endpoint (no login — it only says "a new order came in"); calling
 * dismiss() POSTs to /alert/dismiss with the staff login (nobody else may silence it) so the device goes quiet and
 * the banner clears.
 *
 * With a branch selected (locationId) it watches and silences that branch's buzzer only; "All locations" → every
 * branch's (any new order rings; silencing stops them all).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { WAITER_API, waiterFetch } from '../api/waiter';

const POLL_MS = 2_000;

export function useBuzzerAlert(tenantSubdomain: string | undefined, locationId?: string | null) {
  const [active, setActive] = useState(false);
  const { getToken, refreshToken } = useAuthContext();

  useEffect(() => {
    if (!tenantSubdomain) return;
    const branchQ = locationId ? `&branch=${encodeURIComponent(locationId)}` : '';

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${WAITER_API}/alert?tenant=${encodeURIComponent(tenantSubdomain)}${branchQ}`);
        if (!cancelled && res.ok) {
          const data: { alert: boolean } = await res.json();
          setActive(data.alert);
        }
      } catch {
        // network down — keep last state, don't crash
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tenantSubdomain, locationId]);

  const dismiss = useCallback(async () => {
    if (!tenantSubdomain) return;
    try {
      const res = await waiterFetch(
        `/alert/dismiss?tenant=${encodeURIComponent(tenantSubdomain)}${locationId ? `&branch=${encodeURIComponent(locationId)}` : ''}`,
        { method: 'POST' },
        { getToken, refreshToken },
      );
      if (res.ok) setActive(false);
    } catch {
      // best-effort
    }
  }, [tenantSubdomain, locationId, getToken, refreshToken]);

  return { active, dismiss };
}
