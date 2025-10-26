// Utility to generate WebSocket URLs that automatically respect the API origin
export function getWsURL(path: string) {
  const apiOrigin = (import.meta as any).env?.VITE_API_ORIGIN; // e.g. http://localhost:8080 or https://apiqravy.com
  if (apiOrigin) {
    const u = new URL(apiOrigin);
    const scheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${u.host}${path}`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
