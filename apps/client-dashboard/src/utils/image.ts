export type ImgOpts = {
  w?: number;
  h?: number;
  q?: number;
  format?: 'auto' | 'webp' | 'avif';
  lossless?: boolean;
  dpr?: number;
  blur?: number; // Gaussian blur strength (ImageKit "bl-<n>")
};

const API =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  'https://muvance-api-gateway.onrender.com';

/**
 * Build an ImageKit URL via your backend redirect (/i/:key).
 */
export function buildImgUrl(key: string, opts: ImgOpts = {}) {
  const url = new URL(`${API}/i/${key}`);
  if (opts.w) url.searchParams.set('w', String(opts.w));
  if (opts.h) url.searchParams.set('h', String(opts.h));
  if (opts.q) url.searchParams.set('q', String(opts.q));
  if (opts.format) url.searchParams.set('format', opts.format);
  if (opts.lossless) url.searchParams.set('lossless', 'true');
  if (opts.dpr) url.searchParams.set('dpr', String(opts.dpr));
  if (opts.blur) url.searchParams.set('blur', String(opts.blur));
  return url.toString();
}