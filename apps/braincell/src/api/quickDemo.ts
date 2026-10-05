/**
 * Quick demo API (public, no account): menu photos → a temporary restaurant with a live dine-in storefront.
 * Uses its own axios client — no auth header, no token refresh, no login redirects.
 */
import axios from 'axios';

const demoApi = axios.create({
  baseURL:
    (import.meta.env.VITE_API_URL as string | undefined) ||
    (typeof window !== 'undefined' ? window.location.origin : ''),
});

export type DemoStatus = 'reading' | 'needs-name' | 'building' | 'ready' | 'failed';

export type QuickDemo = {
  key: string;
  status: DemoStatus;
  name: string | null;
  /** Set once the storefront is ready */
  subdomain: string | null;
  progress: { done: number; total: number };
  sourceType: 'pdf' | 'photos';
  error: string | null;
  table: string;
  tableKey: string | null;
  itemCount: number;
  categoryCount: number;
  expiresAt: string;
};

const BASE = '/api/v1/public/quick-demo';

export function demoErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message || e?.message || fallback;
}

export function isDemoGone(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 404;
}

export async function startQuickDemo(files: File[], onProgress?: (pct: number) => void): Promise<QuickDemo> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await demoApi.post(BASE, form, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data.demo as QuickDemo;
}

export async function getQuickDemo(key: string): Promise<QuickDemo> {
  const res = await demoApi.get(`${BASE}/${encodeURIComponent(key)}`, { params: { _: Date.now() } });
  return res.data.demo as QuickDemo;
}

export async function nameQuickDemo(key: string, name: string): Promise<QuickDemo> {
  const res = await demoApi.post(`${BASE}/${encodeURIComponent(key)}/name`, { name });
  return res.data.demo as QuickDemo;
}
