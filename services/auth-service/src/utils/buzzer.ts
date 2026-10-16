// services/auth-service/src/utils/buzzer.ts
// The restaurant's counter buzzer (the ESP32 on the counter, and the dashboard's "buzzer is ringing" banner) — set off
// in the ai-waiter-service, which the device polls. Rings for a new order and for a table calling for staff.
// The branch's buzzer rings (a buzzer set up without a branch rings for every branch).
// Never throws and never holds up the order: it's sent in the background and RETRIED until the waiter service takes
// it (a deploy restarts that service — a ring sent at that moment used to be lost), for about half a minute.
import type { ObjectId } from 'mongodb';
import logger from './logger.js';

export type RingKind = 'order' | 'call';

/** Waits between tries: at once, then 1 s, 2 s, 4 s, 8 s, 15 s later (≈30 s in all). */
const RETRY_MS = [0, 1000, 2000, 4000, 8000, 15000];

export function ringBuzzer(
  tenantSubdomain: string | null | undefined,
  locationId: ObjectId | null | undefined,
  why: string,
  kind: RingKind = 'order'
): void {
  if (typeof tenantSubdomain !== 'string' || !tenantSubdomain) return;
  const key = process.env.INTERNAL_API_KEY ?? '';
  if (!key) {
    // without the shared key the waiter service refuses every ring — the buzzer would never sound
    logger.error(`[buzzer] INTERNAL_API_KEY is not set — the counter buzzer can't ring (${tenantSubdomain}: ${why})`);
    return;
  }
  const waiterUrl = (process.env.AI_WAITER_HTTP_URL || 'http://ai-waiter-service:7081').replace(/\/$/, '');
  const body = JSON.stringify({ tenant: tenantSubdomain, location: locationId ? locationId.toHexString() : null, kind });

  const attempt = async (i: number): Promise<void> => {
    try {
      const res = await fetch(`${waiterUrl}/internal/alert/trigger`, {
        method: 'POST',
        // the shared key: only auth-service may set a restaurant's buzzer off
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': key },
        body,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        if (i > 0) logger.info(`[buzzer] rang for ${tenantSubdomain} (${why}) on try ${i + 1}`);
        return;
      }
      // a wrong key / bad request won't get better by trying again
      if (res.status === 403 || res.status === 400) {
        logger.error(`[buzzer] the waiter service refused the ring for ${tenantSubdomain} (${why}): HTTP ${res.status} — check INTERNAL_API_KEY is the same in both services`);
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      const next = RETRY_MS[i + 1];
      if (next === undefined) {
        logger.error(`[buzzer] could not ring for ${tenantSubdomain} (${why}) after ${RETRY_MS.length} tries: ${(error as Error)?.message ?? error}`);
        return;
      }
      setTimeout(() => void attempt(i + 1), next);
    }
  };
  void attempt(0);
}
