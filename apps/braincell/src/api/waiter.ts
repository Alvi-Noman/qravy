// apps/braincell/src/api/waiter.ts
// Calls to the AI waiter service's restaurant endpoints (upsell stats, silencing the buzzer). They need the staff
// login: the waiter checks the token with auth-service and only answers for that staff member's own restaurant.

export const WAITER_API =
  import.meta.env.VITE_AI_WAITER_API ??
  (import.meta.env.DEV ? 'http://localhost:7081' : '/waiter');

/** fetch with the staff token; on 401 (it expired — tokens last 15 min) refresh once and retry. */
export async function waiterFetch(
  path: string,
  init: RequestInit,
  auth: { getToken: () => string | null; refreshToken: () => Promise<void> },
): Promise<Response> {
  const send = () => {
    const token = auth.getToken();
    return fetch(`${WAITER_API}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };
  const res = await send();
  if (res.status !== 401) return res;
  await auth.refreshToken();
  return send();
}
