/**
 * useBuzzerAlert — polls the ai-waiter-service /alert endpoint every 2 s.
 * Returns whether the counter buzzer is currently active and a dismiss fn.
 *
 * The ESP32 on the counter also polls the same endpoint; calling dismiss()
 * POSTs to /alert/dismiss so the device goes quiet and the banner clears.
 */
import { useCallback, useEffect, useState } from 'react';

const WAITER_API = import.meta.env.VITE_AI_WAITER_API ?? 'http://localhost:7081';
const POLL_MS = 2_000;

export function useBuzzerAlert(tenantSubdomain: string | undefined) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!tenantSubdomain) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${WAITER_API}/alert?tenant=${encodeURIComponent(tenantSubdomain)}`);
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
  }, [tenantSubdomain]);

  const dismiss = useCallback(async () => {
    if (!tenantSubdomain) return;
    try {
      await fetch(
        `${WAITER_API}/alert/dismiss?tenant=${encodeURIComponent(tenantSubdomain)}`,
        { method: 'POST' },
      );
      setActive(false);
    } catch {
      // best-effort
    }
  }, [tenantSubdomain]);

  return { active, dismiss };
}
