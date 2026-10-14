/**
 * Guest-app (tastebud) links: the online shop at {storefront}, dine-in at {storefront}/dine-in?table=<name>&k=<key>.
 * A restaurant with branches gets the same per branch, the branch first: {storefront}/<slug> and
 * {storefront}/<slug>/dine-in?table=<name>&k=<key> — the order goes to that branch.
 * Used by the QR codes page and the quick demo, so both always open the same place.
 */

/** Guest app base URL for a restaurant: its own domain once guests use it (Settings → Domain), else its Qravy address.
 *  Override the Qravy address with VITE_STOREFRONT_URL, e.g. "https://{subdomain}.qravy.com". */
export function storefrontBase(subdomain: string, guestDomain?: string | null): string {
  if (guestDomain) return `https://${guestDomain}`;
  const env = (import.meta.env.VITE_STOREFRONT_URL as string | undefined)?.trim();
  const template =
    env || (import.meta.env.DEV ? 'http://localhost:3007/t/{subdomain}' : 'https://{subdomain}.qravy.com');
  return template.replace('{subdomain}', encodeURIComponent(subdomain)).replace(/\/$/, '');
}

const withBranch = (base: string, branch?: string | null) => (branch ? `${base}/${encodeURIComponent(branch)}` : base);

export const tableUrl = (base: string, table: string, key?: string, branch?: string | null) =>
  `${withBranch(base, branch)}/dine-in?table=${encodeURIComponent(table)}${key ? `&k=${encodeURIComponent(key)}` : ''}`;
export const onlineUrl = (base: string, branch?: string | null) => withBranch(base, branch);
