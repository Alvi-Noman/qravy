// apps/tastebud/src/utils/table.ts
// The guest's table comes from the table QR code (?table=12). It's remembered per restaurant for a
// few hours so it survives navigation and reloads; the guest can also type or say it at checkout.
import { useCallback, useEffect, useState } from 'react';

const TTL_MS = 6 * 60 * 60 * 1000;
const VALID = /^[A-Za-z0-9-]{1,12}$/;

const key = (sub?: string | null) => `qravy:table:${sub || 'anon'}`;

export function normalizeTable(raw: unknown): string | null {
  const t = String(raw ?? '').trim().replace(/^#/, '');
  return VALID.test(t) ? t.toUpperCase() : null;
}

export function getTable(sub?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(sub));
    if (!raw) return null;
    const { table, at } = JSON.parse(raw) as { table?: string; at?: number };
    if (!table || !at || Date.now() - at > TTL_MS) return null;
    return normalizeTable(table);
  } catch {
    return null;
  }
}

export function setTable(sub: string | null | undefined, table: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const t = normalizeTable(table);
    if (t) localStorage.setItem(key(sub), JSON.stringify({ table: t, at: Date.now() }));
    else localStorage.removeItem(key(sub));
    window.dispatchEvent(new CustomEvent('qravy:table', { detail: { sub, table: t } }));
  } catch {
    /* storage blocked */
  }
}

/** Read ?table= (or the host-injected __STORE__.table) once and remember it. */
export function captureTableFromUrl(sub?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = normalizeTable(new URLSearchParams(window.location.search).get('table'));
  const fromStore = normalizeTable((window as any).__STORE__?.table);
  const t = fromUrl || fromStore;
  if (t) setTable(sub, t);
  return t || getTable(sub);
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
