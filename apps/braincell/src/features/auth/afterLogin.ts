// apps/braincell/src/features/auth/afterLogin.ts — where a signed-in person goes, shared by the passcode login
// (pages/Login) and the email link (pages/MagicLink):
//   1. this browser is already one of a restaurant's devices → straight into that restaurant
//   2. the email was given access to restaurants (Settings → Restaurant Access) → into that restaurant (one), or a
//      short list to pick from (several) — never "create a restaurant" when access exists
//   3. otherwise their own restaurant, or creating one
// Each step's failure only skips that step: "is this a device?" answering no (or failing) must never send someone
// with access to the create-restaurant page.
import api from '../../api/auth';

/** How they're in it: their own, a member (admin…), a Team invite waiting for them, Restaurant Access (staff login). */
export type Via = 'own' | 'member' | 'invite' | 'access';
export type Workspace = { id: string; name: string; via?: Via; role?: string | null };

type DeviceLookup = { found: false } | { found: true; tenantId: string };

export type Access =
  | { kind: 'device'; tenantId: string; token: string }
  | { kind: 'workspaces'; items: Workspace[] }
  | { kind: 'none' };

/** A restaurant they have access to → a session in it (an invite is accepted on the way). `next`: a Restaurant Access
 * login is a restaurant device — it says which branch it's at; everyone else goes to the dashboard. */
export async function enterWorkspace(tenantId: string): Promise<{ token: string; next: string }> {
  const sel = await api.post<{ token?: string; via?: Via; branch?: string | null }>(
    '/api/v1/access/select-tenant',
    { tenantId },
    { withCredentials: true }
  );
  const token = sel.data?.token;
  if (!token) throw new Error('Could not open this restaurant');
  return { token, next: sel.data?.via === 'access' && !sel.data?.branch ? '/access/select-location' : '/dashboard' };
}

/** "Admin", "Invitation", "Staff access" — under the restaurant's name in the list. */
export function viaLabel(w: Workspace): string {
  if (w.via === 'own') return 'Your restaurant';
  if (w.via === 'invite') return 'Invitation — join as admin';
  if (w.via === 'access') return 'Staff access';
  return w.role ? w.role[0].toUpperCase() + w.role.slice(1) : 'Member';
}

export async function findAccess(): Promise<Access> {
  try {
    const { data } = await api.get<DeviceLookup>('/api/v1/access/devices/lookup', { withCredentials: true });
    if (data && data.found) {
      return { kind: 'device', tenantId: data.tenantId, token: (await enterWorkspace(data.tenantId)).token };
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
