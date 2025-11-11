function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >>> 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getStableSessionId(): string {
  const key = 'qravy_waiter_sid';
  let sid = localStorage.getItem(key);
  if (!sid) {
    sid = uuidv4();
    localStorage.setItem(key, sid);
  }
  return sid;
}

/**
 * Build WebSocket URL.
 * Priority:
 * 1. VITE_WS_ORIGIN (for AI Waiter WebSocket)
 * 2. VITE_API_ORIGIN (fallback)
 * 3. window.location (final fallback)
 */
export function getWsURL(path: string): string {
  const env = (import.meta as any).env || {};
  const wsOrigin = env.VITE_WS_ORIGIN || null;
  const apiOrigin = env.VITE_API_ORIGIN || null;
  const sid = getStableSessionId();

  let scheme: 'ws:' | 'wss:';
  let host: string;

  if (wsOrigin) {
    const u = new URL(wsOrigin);
    scheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
    host = u.host;
  } else if (apiOrigin) {
    const u = new URL(apiOrigin);
    scheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
    host = u.host;
  } else {
    scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    host = location.host;
  }

  const base = `${scheme}//${host}`;
  const url = new URL(path, base);
  url.searchParams.set('sid', sid);
  return url.toString();
}

/**
 * Collect user environment context:
 * - Timezone
 * - Optional geolocation (lat/lon)
 */
export async function getUserContext(): Promise<{
  tz: string;
  geo?: { lat: number; lon: number };
}> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let geo;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 3000,
      })
    );
    geo = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
    };
  } catch {
    geo = undefined;
  }
  return { tz, geo };
}
