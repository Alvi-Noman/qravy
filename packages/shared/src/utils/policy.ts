// packages/shared/src/utils/policy.ts

export type SessionType = 'member' | 'branch';
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Mode = 'all' | 'any';

export type ComputeInput = {
  role?: Role;
  sessionType: SessionType;
  viewAs?: SessionType; // optional "member viewing as branch"
};

export type Capability = string;

const BRANCH_BASE_CAPS: Capability[] = [
  // Dashboard / basic views
  'dashboard:view',
  'reports:view',

  // Orders / service requests basic ops
  'orders:read',
  'orders:update',
  'serviceRequests:read',
  'serviceRequests:update',

  // MENU & CATEGORIES — IMPORTANT: include READ
  'menuItems:read',
  'menuItems:toggleAvailability',

  'categories:read',
  'categories:toggleVisibility',

  // Offers limited
  'offers:read',
  'offers:toggleActive',
];

const ROLE_CAPS: Record<Role, Capability[]> = {
  owner: ['*'], // all
  admin: [
    'dashboard:*',
    'reports:*',
    'orders:*',
    'serviceRequests:*',
    'menuItems:*',
    'categories:*',
    'offers:*',
    'customers:*',
    'locations:*',
  ],
  editor: [
    'dashboard:view',
    'reports:view',
    'orders:read',
    'orders:update',
    'serviceRequests:read',
    'serviceRequests:update',
    'menuItems:read',
    'menuItems:create',
    'menuItems:update',
    'menuItems:delete',
    'categories:read',
    'categories:create',
    'categories:update',
    'categories:delete',
    'offers:read',
    'offers:create',
    'offers:update',
  ],
  viewer: [
    'dashboard:view',
    'reports:view',
    'orders:read',
    'serviceRequests:read',
    'menuItems:read',
    'categories:read',
    'offers:read',
  ],
};

/** Deduplicate + keep stable order */
function uniq(list: Capability[]): Capability[] {
  const seen = new Set<string>();
  const out: Capability[] = [];
  for (const c of list) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Compute capabilities given role + sessionType.
 * - branch sessions: locked to minimal branch caps (no create/update/delete on structure)
 * - member sessions: role-based
 * - member view-as branch: intersect role caps with branch-safe set (defensive)
 */
export function computeCapabilities(input: ComputeInput): Capability[] {
  const { role, sessionType, viewAs } = input;

  // When viewing as branch from a member, we want branch-safe capabilities
  const effectiveType: SessionType = viewAs ?? sessionType;

  if (effectiveType === 'branch') {
    // Branch (device/central) — constrained surface
    return uniq([...BRANCH_BASE_CAPS]);
  }

  // Member (dashboard logins) — role based
  if (role && ROLE_CAPS[role]) {
    return uniq([...ROLE_CAPS[role]]);
  }

  // Default safe minimum if role unknown
  return uniq([
    'dashboard:view',
    'menuItems:read',
    'categories:read',
    'orders:read',
    'serviceRequests:read',
  ]);
}

/** Check if a capability list includes a required cap (supports resource:* wildcard and global *) */
export function hasCapability(caps: Capability[] | undefined, required: Capability): boolean {
  if (!required) return false;
  const list = Array.isArray(caps) ? caps : [];
  if (list.includes('*')) return true;
  if (list.includes(required)) return true;
  const [res, act] = required.split(':');
  if (res && act && list.includes(`${res}:*`)) return true;
  return false;
}

/** Check if caps satisfy a list in 'all' or 'any' mode */
export function satisfies(
  caps: Capability[] | undefined,
  required: string | string[],
  mode: Mode = 'all'
): boolean {
  const reqs = Array.isArray(required) ? required : [required];
  if (mode === 'any') return reqs.some((r) => hasCapability(caps, r));
  return reqs.every((r) => hasCapability(caps, r));
}
