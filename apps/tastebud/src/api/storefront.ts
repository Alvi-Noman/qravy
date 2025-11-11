// apps/tastebud/src/api/storefront.ts
import axios from 'axios';
import type { v1 } from '../../../../packages/shared/src/types';

const baseURL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  ((typeof window !== 'undefined' && (window as any).__STORE__?.apiBase) as string | undefined) ||
  '/api/v1';

const api = axios.create({
  baseURL,
  withCredentials: true, // default; override per-request for public routes
});

// Dedicated base for cart API (ai-waiter-service)
const CART_API_BASE =
  (typeof window !== 'undefined' && (window as any).__STORE__?.cartApiBase) ||
  'http://localhost:7081';

export type Channel = 'dine-in' | 'online';

export type ListQuery = {
  /** Tenant subdomain, e.g. "demo". If provided, uses the public endpoints. */
  subdomain?: string;
  /** Optional branch/slug (location) for that tenant. */
  branch?: string;
  /** Channel filter */
  channel?: Channel;
  /** Legacy param for internal/admin views (ignored for public endpoints) */
  locationId?: string;
};

/* ------------------------------ TENANT (NEW) ------------------------------ */
/** Fetch tenant data (e.g., restaurant name) for a given subdomain. */
export async function getTenant(subdomain: string): Promise<any | null> {
  // Try querystring style first (consistent with /public/menu & /public/categories)
  try {
    const { data } = await api.get('/public/tenant', {
      params: { subdomain },
      withCredentials: false, // public route should not need cookies
    });
    return data?.item ?? null; // <-- unwrap { item }
  } catch {
    // Some backends expose /public/tenant/:subdomain — try that as a fallback
    try {
      const { data } = await api.get(`/public/tenant/${encodeURIComponent(subdomain)}`, {
        withCredentials: false,
      });
      return data?.item ?? null; // <-- unwrap { item }
    } catch {
      return null;
    }
  }
}

/* ---------------------------------- MENU ---------------------------------- */

// Overloads: keep old signature (channel, locationId) working
export function listMenu(channel?: Channel, locationId?: string): Promise<v1.MenuItemDTO[]>;
export function listMenu(query?: ListQuery): Promise<v1.MenuItemDTO[]>;
export async function listMenu(
  a?: Channel | ListQuery,
  b?: string,
): Promise<v1.MenuItemDTO[]> {
  // Normalize args
  const query: ListQuery =
    typeof a === 'string' || a === undefined
      ? { channel: a as Channel | undefined, locationId: b }
      : (a ?? {});

  // Build params
  const params: Record<string, string> = {};
  if (query.channel) params.channel = query.channel;
  if (query.locationId) params.locationId = query.locationId;

  // If subdomain (or branch) provided, hit public menu
  if (query.subdomain || query.branch) {
    if (query.subdomain) params.subdomain = query.subdomain;
    if (query.branch) params.branch = query.branch;
    try {
      const { data } = await api.get('/public/menu', {
        params,
        withCredentials: false, // public route
      });
      // Always return an array defensively
      return (data?.items as v1.MenuItemDTO[] | undefined) ?? [];
    } catch {
      // Public route not implemented or failed — return empty so UI can handle gracefully
      return [];
    }
  }

  // Fallback to private/admin endpoint (current behavior)
  const { data } = await api.get('/auth/menu-items', { params });
  return (data?.items as v1.MenuItemDTO[] | undefined) ?? [];
}

/* ------------------------------- CATEGORIES ------------------------------- */

// Overloads: keep old signature (channel, locationId) working
export function listCategories(
  channel?: Channel,
  locationId?: string,
): Promise<v1.CategoryDTO[]>;
export function listCategories(query?: ListQuery): Promise<v1.CategoryDTO[]>;
export async function listCategories(
  a?: Channel | ListQuery,
  b?: string,
): Promise<v1.CategoryDTO[]> {
  // Normalize args
  const query: ListQuery =
    typeof a === 'string' || a === undefined
      ? { channel: a as Channel | undefined, locationId: b }
      : (a ?? {});

  const params: Record<string, string> = {};
  if (query.channel) params.channel = query.channel;
  if (query.locationId) params.locationId = query.locationId;

  // If subdomain (or branch) provided, hit public categories (best-effort)
  if (query.subdomain || query.branch) {
    if (query.subdomain) params.subdomain = query.subdomain;
    if (query.branch) params.branch = query.branch;
    try {
      const { data } = await api.get('/public/categories', {
        params,
        withCredentials: false, // public route
      });
      return (data?.items as v1.CategoryDTO[] | undefined) ?? [];
    } catch {
      // If not implemented yet, return empty to let UI fallback to client grouping
      return [];
    }
  }

  // Fallback to private/admin endpoint (current behavior)
  const { data } = await api.get('/auth/categories', { params });
  return (data?.items as v1.CategoryDTO[] | undefined) ?? [];
}

/* ------------------------------- CART (NEW) ------------------------------- */

export type CartItemDTO = {
  id: string;
  name: string;
  price: number;
  qty: number;
  variation?: string;
  notes?: string;
  imageUrl?: string;
};

export type CartSnapshot = {
  items: CartItemDTO[];
  updatedAt?: number | null;
};

/**
 * Load cart for a given public storefront session.
 * Best-effort: returns null if nothing or on error.
 */
export async function loadCart(params: {
  subdomain?: string | null;
  branch?: string | null; // currently unused by backend, safe to keep
  sessionId: string;
}): Promise<CartSnapshot | null> {
  try {
    const { data } = await axios.get(`${CART_API_BASE}/cart/load`, {
      params: {
        tenant: params.subdomain ?? undefined,
        sid: params.sessionId, // ✅ matches server.py
      },
      withCredentials: false,
    });

    if (!data || typeof data !== 'object' || (data as any).ok !== true) {
      return null;
    }

    const items = Array.isArray((data as any).items)
      ? ((data as any).items as CartItemDTO[])
      : [];

    if (!items.length) return null;

    const updatedAt =
      typeof (data as any).updatedAt === 'number'
        ? (data as any).updatedAt
        : null;

    return { items, updatedAt };
  } catch {
    return null;
  }
}

/**
 * Save cart snapshot for a given public storefront session.
 * Fire-and-forget; silent on failure.
 */
export async function saveCart(payload: {
  subdomain?: string | null;
  branch?: string | null; // unused by backend, safe to keep
  sessionId: string;
  items: CartItemDTO[];
  updatedAt?: number | null;
}): Promise<void> {
  try {
    await axios.post(
      `${CART_API_BASE}/cart/save`,
      {
        tenant: payload.subdomain ?? undefined,
        sessionId: payload.sessionId, // ✅ matches server.py
        items: payload.items ?? [],
        // updatedAt is optional; backend currently ignores it safely
      },
      {
        withCredentials: false,
      },
    );
  } catch {
    // best-effort; ignore errors
  }
}
