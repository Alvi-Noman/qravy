// Capability policy and helpers

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type SessionType = 'member' | 'branch';

const BRANCH_CAPS: string[] = [
  'dashboard:view',
  'reports:view',

  'orders:read',
  'orders:update',

  'serviceRequests:read',
  'serviceRequests:update',

  'menuItems:read',
  'menuItems:toggleAvailability',

  'categories:read',
  'categories:toggleVisibility',

  'offers:read',
  'offers:toggleActive',
];

const VIEWER_CAPS: string[] = [
  'dashboard:view',
  'reports:view',
  'menuItems:read',
  'categories:read',
  'offers:read',
];

const EDITOR_CAPS: string[] = [
  'dashboard:view',
  'reports:view',
  'menuItems:read',
  'menuItems:create',
  'menuItems:update',
  'menuItems:delete',
  'menuItems:toggleAvailability', // allow editor to toggle
  'categories:read',
  'categories:create',
  'categories:update',
  'categories:delete',
  'categories:toggleVisibility',  // allow editor to toggle
  'offers:read',
  'offers:create',
  'offers:update',
  'offers:delete',
  'offers:toggleActive',
];

const ADMIN_OR_OWNER_CAPS: string[] = ['*'];

export function computeCapabilities(input: {
  role?: Role;
  sessionType: SessionType;
  viewAs?: SessionType;
}): string[] {
  const effectiveType = input.viewAs ?? input.sessionType;

  if (effectiveType === 'branch') {
    return BRANCH_CAPS.slice();
  }

  switch (input.role) {
    case 'owner':
    case 'admin':
      return ADMIN_OR_OWNER_CAPS.slice();
    case 'editor':
      return EDITOR_CAPS.slice();
    case 'viewer':
      return VIEWER_CAPS.slice();
    default:
      return [];
  }
}

export function hasCapability(userCaps: string[] | undefined, required: string): boolean {
  if (!userCaps || userCaps.length === 0) return false;
  if (userCaps.includes('*')) return true;

  const [res, act] = required.split(':');
  if (!res || !act) return false;

  if (userCaps.includes(`${res}:*`)) return true;
  return userCaps.includes(required);
}

export function satisfies(
  userCaps: string[] | undefined,
  required: string | string[],
  mode: 'all' | 'any' = 'all'
): boolean {
  const reqs = Array.isArray(required) ? required : [required];
  if (mode === 'any') {
    return reqs.some((r) => hasCapability(userCaps, r));
  }
  return reqs.every((r) => hasCapability(userCaps, r));
}