/**
 * Guest-app (tastebud) links: the online shop at {storefront}, dine-in at {storefront}/dine-in?table=<name>&k=<key>.
 * Used by the QR codes page and the quick demo, so both always open the same place.
 */

/** Guest app base URL for a restaurant. Override with VITE_STOREFRONT_URL, e.g. "https://{subdomain}.qravy.com". */
export function storefrontBase(subdomain: string): string {
  const env = (import.meta.env.VITE_STOREFRONT_URL as string | undefined)?.trim();
  const template =
    env || (import.meta.env.DEV ? 'http://localhost:3007/t/{subdomain}' : 'https://{subdomain}.qravy.com');
  return template.replace('{subdomain}', encodeURIComponent(subdomain)).replace(/\/$/, '');
}

export const tableUrl = (base: string, table: string, key?: string) =>
  `${base}/dine-in?table=${encodeURIComponent(table)}${key ? `&k=${encodeURIComponent(key)}` : ''}`;
export const onlineUrl = (base: string) => base;
