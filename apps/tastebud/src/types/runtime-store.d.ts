export {};

declare global {
  interface Window {
    __STORE__?: {
      /** Tenant subdomain, e.g. "demo" */
      subdomain: string | null;
      /** Channel currently in use */
      channel: 'dine-in' | 'online' | null;
      /** Optional branch/slug for multi-location */
      branch: string | null;
      /** Base URL for the gateway (e.g., "/api/v1" or "https://api.qravy.com/api/v1") */
      apiBase?: string;

      /** Optional: currency formatting hint (e.g., "USD", "BDT") */
      currency?: string;

      /** Optional: server-injected collections for instant render (not required) */
      categories?: Array<{
        id: string;
        name: string;
        slug?: string;
        sort?: number;
      }>;
      items?: Array<{
        id: string;
        name: string;
        price?: number;
        compareAtPrice?: number;
        description?: string;
        media?: string[];
        categoryIds?: string[];
        // A simple “flat” variation option list. Backends with groups can still map here.
        variations?: Array<{
          id: string;
          name: string;
          price?: number;
          groupId?: string;
          groupName?: string;
        }>;
        status?: 'active' | 'hidden';
      }>;
    };
  }
}
