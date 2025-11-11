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
 *
 * Safe against invalid / partial env values.
 */
export function getWsURL(path: string): string {
  const env = (import.meta as any).env || {};
  const rawWs = (env.VITE_WS_ORIGIN || '').toString().trim();
  const rawApi = (env.VITE_API_ORIGIN || '').toString().trim();
  const sid = getStableSessionId();

  function normalizeBase(raw: string | null | undefined): URL | null {
    if (!raw) return null;
    try {
      // If missing protocol, assume https (we'll map to wss later).
      if (!/^https?:\/\//i.test(raw) && !/^wss?:\/\//i.test(raw)) {
        return new URL(`https://${raw}`);
      }
      return new URL(raw);
    } catch {
      return null; // ignore invalid values
    }
  }

  const wsBase = normalizeBase(rawWs);
  const apiBase = normalizeBase(rawApi);

  let scheme: 'ws:' | 'wss:';
  let host: string;

  if (wsBase) {
    scheme = wsBase.protocol === 'https:' || wsBase.protocol === 'wss:' ? 'wss:' : 'ws:';
    host = wsBase.host;
  } else if (apiBase) {
    scheme = apiBase.protocol === 'https:' || apiBase.protocol === 'wss:' ? 'wss:' : 'ws:';
    host = apiBase.host;
  } else {
    if (typeof window !== 'undefined' && window.location) {
      const loc = window.location;
      scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      host = loc.host;
    } else {
      // ultra-safe fallback to avoid throwing during SSR/init
      scheme = 'wss:';
      host = 'localhost';
    }
  }

  const base = `${scheme}//${host}`;
  const effectivePath = path || '/ws/voice';
  const url = new URL(effectivePath, base);
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
