export {};

declare global {
  interface Window {
    __STORE__?: {
      subdomain: string | null;
      channel: 'dine-in' | 'online' | null;
      branch: string | null;
      apiBase?: string;
    };
  }
}
