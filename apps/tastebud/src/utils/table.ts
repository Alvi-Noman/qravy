// apps/tastebud/src/utils/table.ts
// The guest's table comes from the table QR code (?table=12&k=<key>). It's remembered per restaurant for a
// few hours so it survives navigation and reloads; the guest can also type or say it at checkout. The key (k) proves
// the guest scanned that table — it goes with the order; a typed table has none (the staff check that order).
import { useCallback, useEffect, useState } from 'react';

const TTL_MS = 6 * 60 * 60 * 1000;
const VALID = /^[A-Za-z0-9-]{1,12}$/;
const VALID_KEY = /^[a-z0-9]{4,40}$/;

// per restaurant and branch: table 12 at Gulshan (and its QR key) is no table at Banani
const key = (sub?: string | null) => {
  const branch = typeof window !== 'undefined' ? storeBranchFromPath(window.location.pathname) : null;
  return `qravy:table:${sub || 'anon'}${branch ? `:${branch}` : ''}`;
};

export function normalizeTable(raw: unknown): string | null {
  const t = String(raw ?? '').trim().replace(/^#/, '');
  return VALID.test(t) ? t.toUpperCase() : null;
}

export const normalizeTableKey = (raw: unknown): string | null => {
  const k = String(raw ?? '').trim().toLowerCase();
  return VALID_KEY.test(k) ? k : null;
};

// this visit's copy too: a phone that blocks storage (in-app browsers, private tabs) still keeps its table between pages
const memory = new Map<string, string>();

function readStored(sub?: string | null): { table: string; k: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key(sub));
    } catch {
      /* storage blocked */
    }
    raw = raw ?? memory.get(key(sub)) ?? null;
    if (!raw) return null;
    const { table, k, at } = JSON.parse(raw) as { table?: string; k?: string; at?: number };
    const t = normalizeTable(table);
    if (!t || !at || Date.now() - at > TTL_MS) return null;
    return { table: t, k: normalizeTableKey(k) };
  } catch {
    return null;
  }
}

export function getTable(sub?: string | null): string | null {
  return readStored(sub)?.table ?? null;
}

/** The QR key for this table, when this phone scanned it (null for a typed table, or another table). */
export function getTableKey(sub?: string | null, table?: string | null): string | null {
  const s = readStored(sub);
  const t = normalizeTable(table);
  return s && t && s.table === t ? s.k : null;
}

/** Remember the table (and its QR key). Without a key, the same table keeps the one it had; another table has none. */
export function setTable(sub: string | null | undefined, table: string | null, tableKey?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const t = normalizeTable(table);
    const k = normalizeTableKey(tableKey) ?? (t ? getTableKey(sub, t) : null);
    const entry = t ? JSON.stringify({ table: t, ...(k ? { k } : {}), at: Date.now() }) : null;
    if (entry) memory.set(key(sub), entry);
    else memory.delete(key(sub));
    try {
      if (entry) localStorage.setItem(key(sub), entry);
      else localStorage.removeItem(key(sub));
    } catch {
      /* storage blocked — the memory copy does */
    }
    window.dispatchEvent(new CustomEvent('qravy:table', { detail: { sub, table: t } }));
  } catch {
    /* storage blocked */
  }
}

/** Read ?table= (or the host-injected __STORE__.table) once and remember it. Only on a dine-in page — the online
 *  shop ("/t/burger-house") never has a table, even on a phone that sat at table 12 an hour ago. */
export function captureTableFromUrl(sub?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  if (!isDineInPath(window.location.pathname)) return null;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = normalizeTable(params.get('table'));
  const fromStore = normalizeTable((window as any).__STORE__?.table);
  const t = fromUrl || fromStore;
  if (t) setTable(sub, t, fromUrl ? params.get('k') : null);
  return t || getTable(sub);
}

/** The restaurant the URL is for: /t/<sub>/… (dev links) or the host's own (burger-house.qravy.com). */
export function storeSubFromPath(pathname: string): string | null {
  const m = /^\/t\/([^/?#]+)/.exec(pathname || '');
  if (m) return decodeURIComponent(m[1]);
  return typeof window !== 'undefined' ? ((window as any).__STORE__?.subdomain as string) || null : null;
}

/** The two ways into a restaurant:
 *    online  → "/t/burger-house"                    (burger-house.qravy.com)                pickup / delivery
 *    dine-in → "/t/burger-house/dine-in?table=12"   (burger-house.qravy.com/dine-in?table=12) the table's QR
 *  and every page lives under one of them ("…/menu", "…/checkout", "…/order/<token>"); a branch sits before it
 *  ("/t/burger-house/gulshan/dine-in"). */
export const isDineInPath = (pathname: string): boolean => /(^|\/)dine-in(\/|$)/.test(pathname || '');

const PAGES = '(?:menu|checkout|order|confirmation|dine-in|online)(?:/|$)';
const DEV_PATH = new RegExp(`^(/t/[^/]+)(/(?!${PAGES})[^/]+)?(/dine-in(?=/|$))?(.*)$`);
const HOST_PATH = new RegExp(`^()(/(?!${PAGES})[^/]+)?(/dine-in(?=/|$))?(.*)$`);

/** "/t/burger-house/gulshan/dine-in/menu" → { base: "/t/burger-house/gulshan", dineIn: true, rest: "/menu" }. */
export function splitStorePath(pathname: string): { base: string; dineIn: boolean; rest: string } {
  const m = (pathname.startsWith('/t/') ? DEV_PATH : HOST_PATH).exec(pathname || '/');
  if (!m) return { base: '', dineIn: false, rest: pathname };
  return { base: `${m[1]}${m[2] ?? ''}`, dineIn: !!m[3], rest: m[4] === '/' ? '' : m[4] };
}

/** The branch the link is for: "/t/burger-house/gulshan/dine-in" (burger-house.qravy.com/gulshan/dine-in) → "gulshan". */
export function storeBranchFromPath(pathname: string): string | null {
  const { base } = splitStorePath(pathname);
  const seg = base.split('/')[pathname.startsWith('/t/') ? 3 : 1];
  return seg ? decodeURIComponent(seg) : null;
}

/** The table on the page the guest is on now ("…/gulshan/dine-in/menu?table=12&k=…") — when `path` is at the same
 *  restaurant and branch, on the dine-in side. */
function tableOnThisPage(path: string): { table: string; k: string | null } | null {
  if (typeof window === 'undefined' || !isDineInPath(window.location.pathname)) return null;
  if (splitStorePath(window.location.pathname).base !== splitStorePath(path.split(/[?#]/)[0]).base) return null;
  const params = new URLSearchParams(window.location.search);
  const table = normalizeTable(params.get('table'));
  return table ? { table, k: normalizeTableKey(params.get('k')) } : null;
}

/** A link into the restaurant, with the guest's table kept on it ("/t/burger-house/dine-in/menu" →
 *  "/t/burger-house/dine-in/menu?table=12"). Only dine-in links carry a table; online ones never do. The table this
 *  phone remembers — or, when it can't (storage blocked or cleared), the one on the page it's on now. */
export function withTable(path: string, sub?: string | null): string {
  if (!isDineInPath(path.split(/[?#]/)[0])) return path;
  if (/[?&]table=/.test(path)) return path;
  const s = sub ?? storeSubFromPath(path.split('?')[0]);
  const stored = getTable(s);
  const here = stored ? null : tableOnThisPage(path);
  const t = stored ?? here?.table;
  if (!t) return path;
  const k = stored ? getTableKey(s, t) : here?.k;
  const [base, hash = ''] = path.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}table=${encodeURIComponent(t)}${k ? `&k=${k}` : ''}${hash ? `#${hash}` : ''}`;
}

export function useTable(sub?: string | null): [string | null, (t: string | null) => void] {
  const [table, setState] = useState<string | null>(() => captureTableFromUrl(sub));

  useEffect(() => {
    setState(captureTableFromUrl(sub));
    const onChange = () => setState(getTable(sub));
    window.addEventListener('qravy:table', onChange);
    return () => window.removeEventListener('qravy:table', onChange);
  }, [sub]);

  const update = useCallback((t: string | null) => setTable(sub, t), [sub]);
  return [table, update];
}
