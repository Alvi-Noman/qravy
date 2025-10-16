// apps/client-dashboard/src/context/PermissionsContext.tsx
import React, { createContext, useContext, useMemo } from 'react';
import { useAuthContext } from './AuthContext';
import {
  hasCapability as hasCapHelper,
  satisfies as satisfiesHelper,
} from '../../../../packages/shared/src/utils/policy';

export type Capability = string;

type Permissions = {
  capabilities: Capability[];
  has: (cap: Capability) => boolean;
  any: (caps: Capability[]) => boolean;
  all: (caps: Capability[]) => boolean;
  sessionType: 'central' | 'member' | 'unknown';
  locationId?: string | null;
};

const PermissionsContext = createContext<Permissions>({
  capabilities: [],
  has: () => false,
  any: () => false,
  all: () => false,
  sessionType: 'unknown',
  locationId: null,
});

// ✅ Define limited branch (central device) capabilities
const BRANCH_CAPS: Capability[] = [
  // --- Manage ---
  'dashboard:view',

  'orders:read',
  'orders:update',

  'serviceRequests:read',
  'serviceRequests:update',

  'menuItems:read',
  'menuItems:toggleAvailability',

  'categories:read',
  'categories:toggleVisibility',

  // --- Insights ---
  'reports:view', // For Sales Reports
];

function normalizeCaps(caps: Capability[] | undefined): Capability[] {
  return Array.isArray(caps) ? Array.from(new Set(caps)) : [];
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuthContext();

  const value = useMemo<Permissions>(() => {
    // Determine session type (central = branch device)
    const sessionType: 'central' | 'member' | 'unknown' =
      user?.sessionType === 'branch'
        ? 'central'
        : user?.sessionType === 'member'
        ? 'member'
        : session?.type === 'central'
        ? 'central'
        : session?.type === 'member'
        ? 'member'
        : 'unknown';

    // Decide which caps to apply:
    // - central branch device → limited BRANCH_CAPS
    // - member (owner/admin/editor/viewer) → server-supplied capabilities (or all if missing)
    const baseCaps =
      sessionType === 'central'
        ? BRANCH_CAPS
        : normalizeCaps(user?.capabilities?.length ? user.capabilities : ['*']);

    const capabilities = normalizeCaps(baseCaps);

    const has = (cap: Capability) => hasCapHelper(capabilities, cap);
    const any = (caps: Capability[]) => satisfiesHelper(capabilities, caps, 'any');
    const all = (caps: Capability[]) => satisfiesHelper(capabilities, caps, 'all');

    return {
      capabilities,
      has,
      any,
      all,
      sessionType,
      locationId: session?.locationId ?? null,
    };
  }, [user, session]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
