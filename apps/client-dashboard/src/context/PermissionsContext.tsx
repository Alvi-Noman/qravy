import React, { createContext, useContext, useMemo } from 'react';
import { useAuthContext } from './AuthContext';

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

const BRANCH_CAPS: Capability[] = [
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

function normalizeCaps(caps: Capability[] | undefined): Capability[] {
  return Array.isArray(caps) ? Array.from(new Set(caps)) : [];
}

function hasCap(caps: Capability[], required: Capability): boolean {
  if (!required) return false;
  if (caps.includes('*')) return true;
  if (caps.includes(required)) return true;

  // Support resource:* wildcard (e.g., menuItems:*)
  const [res, act] = required.split(':');
  if (res && act && caps.includes(`${res}:*`)) return true;

  return false;
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuthContext();

  const value = useMemo<Permissions>(() => {
    const sessionType = session?.type === 'central' ? 'central' : session?.type === 'member' ? 'member' : 'unknown';

    // Compute client-side capabilities:
    // - central branch session: restricted caps
    // - member (owner/admin/editor/viewer): allow all by default on client UI (server still enforces)
    const capabilities =
      sessionType === 'central'
        ? normalizeCaps(BRANCH_CAPS)
        : normalizeCaps(['*']); // member sessions see full UI; server enforces real permissions

    return {
      capabilities,
      has: (cap) => hasCap(capabilities, cap),
      any: (caps) => (caps || []).some((c) => hasCap(capabilities, c)),
      all: (caps) => (caps || []).every((c) => hasCap(capabilities, c)),
      sessionType,
      locationId: session?.locationId ?? null,
    };
  }, [session]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}