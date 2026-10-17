// apps/braincell/src/features/auth/afterLogin.ts — where a signed-in person goes, shared by the passcode login
// (pages/Login) and the email link (pages/MagicLink):
//   1. this browser is already one of a restaurant's devices → straight into that restaurant
//   2. the email was given access to restaurants (Settings → Restaurant Access) → into that restaurant (one), or a
//      short list to pick from (several) — never "create a restaurant" when access exists
//   3. otherwise their own restaurant, or creating one
// Each step's failure only skips that step: "is this a device?" answering no (or failing) must never send someone
// with access to the create-restaurant page.
import api from '../../api/auth';

export type Workspace = { id: string; name: string };

type DeviceLookup = { found: false } | { found: true; tenantId: string };

export type Access =
  | { kind: 'device'; tenantId: string; token: string }
  | { kind: 'workspaces'; items: Workspace[] }
  | { kind: 'none' };

/** A restaurant the email was given access to → a session in it (the token is scoped to that restaurant). */
export async function enterWorkspace(tenantId: string): Promise<string> {
  const sel = await api.post<{ token?: string }>('/api/v1/access/select-tenant', { tenantId }, { withCredentials: true });
  const token = sel.data?.token;
  if (!token) throw new Error('Could not open this restaurant');
  return token;
}

export async function findAccess(): Promise<Access> {
  try {
    const { data } = await api.get<DeviceLookup>('/api/v1/access/devices/lookup', { withCredentials: true });
    if (data && data.found) {
      return { kind: 'device', tenantId: data.tenantId, token: await enterWorkspace(data.tenantId) };
    }
  } catch {
    /* not one of a restaurant's devices — carry on */
  }
  try {
    const { data } = await api.get<{ items?: Workspace[] }>('/api/v1/access/workspaces', { withCredentials: true });
    const items = data?.items || [];
    if (items.length) return { kind: 'workspaces', items };
  } catch {
    /* no access list — their own restaurant (or none) */
  }
  return { kind: 'none' };
}
