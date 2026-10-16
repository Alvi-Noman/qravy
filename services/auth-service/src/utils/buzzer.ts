// services/auth-service/src/utils/buzzer.ts
// The restaurant's counter buzzer (the ESP32 on the counter, and the dashboard's "buzzer is ringing" banner) — set off
// in the ai-waiter-service, which the device polls. Rings for a new order and for a table calling for staff.
// The branch's buzzer rings (a buzzer set up without a branch rings for every branch). Never throws, never waits long.
import type { ObjectId } from 'mongodb';

export function ringBuzzer(tenantSubdomain: string | null | undefined, locationId: ObjectId | null | undefined, why: string): void {
  if (typeof tenantSubdomain !== 'string' || !tenantSubdomain) return;
  const waiterUrl = process.env.AI_WAITER_HTTP_URL || 'http://ai-waiter-service:7081';
  void fetch(`${waiterUrl.replace(/\/$/, '')}/internal/alert/trigger`, {
    method: 'POST',
    // the shared key: only auth-service may set a restaurant's buzzer off
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': process.env.INTERNAL_API_KEY ?? '' },
    body: JSON.stringify({ tenant: tenantSubdomain, location: locationId ? locationId.toHexString() : null }),
    signal: AbortSignal.timeout(1500),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    })
    .catch((error: unknown) => {
      console.warn(`[buzzer] could not ring for ${tenantSubdomain} (${why}):`, error);
    });
}
