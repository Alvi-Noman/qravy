/**
 * useBuzzerAlert — polls the ai-waiter-service /alert endpoint every 2 s.
 * Returns whether the counter buzzer is currently active, what rang last (a new order or a table calling), whether a
 * buzzer device is checking in, and a dismiss fn.
 *
 * The ESP32 on the counter also polls the same endpoint (no login — it only says "something came in"); calling
 * dismiss() POSTs to /alert/dismiss with the staff login (nobody else may silence it) so the device goes quiet and
 * the banner clears. It silences only what this screen has seen ringing ("until"): an order or call that came in a
 * moment later keeps ringing.
 *
 * With a branch selected (locationId) it watches and silences that branch's buzzer only; "All locations" → every
 * branch's (any new order rings; silencing stops them all).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { WAITER_API, waiterFetch } from '../api/waiter';

const POLL_MS = 2_000;
/** A buzzer that hasn't checked in for this long is offline (it polls every 2 s). */
const DEVICE_QUIET_S = 30;

type AlertState = {
  alert: boolean;
  since: number | null;
  last?: number | null;
  kind?: 'order' | 'call' | null;
  /** seconds since a buzzer device last checked in; null = none has (no buzzer here, or none since a restart) */
  device?: number | null;
};

export function useBuzzerAlert(tenantSubdomain: string | undefined, locationId?: string | null) {
  const [state, setState] = useState<AlertState>({ alert: false, since: null });
  const sinceRef = useRef<number | null>(null);
  sinceRef.current = state.since;
  const { getToken, refreshToken } = useAuthContext();

  useEffect(() => {
    if (!tenantSubdomain) return;
    const branchQ = locationId ? `&branch=${encodeURIComponent(locationId)}` : '';

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${WAITER_API}/alert?tenant=${encodeURIComponent(tenantSubdomain)}${branchQ}`, { cache: 'no-store' });
        if (!cancelled && res.ok) setState((await res.json()) as AlertState);
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
    // only what this screen saw ringing — a ring that came in after it keeps ringing
    const until = sinceRef.current;
    try {
      const res = await waiterFetch(
        `/alert/dismiss?tenant=${encodeURIComponent(tenantSubdomain)}${locationId ? `&branch=${encodeURIComponent(locationId)}` : ''}${
          until ? `&until=${until}` : ''
        }`,
        { method: 'POST' },
        { getToken, refreshToken },
      );
      if (res.ok) setState((s) => ({ ...s, alert: false }));
    } catch {
      // best-effort
    }
  }, [tenantSubdomain, locationId, getToken, refreshToken]);

  const deviceSeenAgo = typeof state.device === 'number' ? state.device : null;
  return {
    active: state.alert,
    kind: state.kind ?? null,
    /** a buzzer device has checked in before but not for 30 s — it's off, or off Wi-Fi */
    deviceOffline: deviceSeenAgo !== null && deviceSeenAgo > DEVICE_QUIET_S,
    deviceSeenAgo,
    dismiss,
  };
}
