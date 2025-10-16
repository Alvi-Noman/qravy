/**
 * Access API
 * Client-side helpers for access settings, workspace listing,
 * and device registration / lookup.
 */

import api from './auth';

export type Workspace = { id: string; name: string };

export type DeviceLookupResult =
  | { found: false }
  | {
      found: true;
      tenantId: string;
      locationId: string | null;
      locationName: string | null;
    };

/** Admin team member */
export type AdminMember = {
  id: string;
  email: string;
  role: 'owner' | 'admin';
  status: 'active' | 'invited';
};

export type Member = AdminMember;


/**
 * Fetch the list of accessible workspaces for the current user.
 * (e.g., central email mapped tenants)
 */
export async function listAccessibleWorkspaces(): Promise<Workspace[]> {
  const res = await api.get('/api/v1/access/workspaces');
  return res.data?.items ?? [];
}

/**
 * Fetch the Admin team (owner + active admins + invited emails).
 */
export async function listAdmins(): Promise<AdminMember[]> {
  const res = await api.get('/api/v1/access/admins');
  return res.data?.items ?? [];
}

/**
 * Lookup a device assignment using cookie or query deviceKey.
 * Returns whether the device is linked to a tenant/location.
 */
export async function lookupDeviceAssignment(): Promise<DeviceLookupResult> {
  const res = await api.get('/api/v1/access/devices/lookup');
  return res.data;
}

/**
 * Register or assign a device to a specific location.
 * This sets a persistent deviceKey cookie for the restaurant device.
 */
export async function registerDevice(opts: {
  locationId: string;
  label?: string;
  os?: string;
  browser?: string;
}) {
  const payload = {
    locationId: opts.locationId,
    label: opts.label,
    os: opts.os,
    browser: opts.browser,
  };
  const res = await api.post('/api/v1/access/devices/register', payload);
  return res.data?.item;
}

/**
 * Send an admin invite email (owner only).
 */
export async function inviteAdmin(email: string) {
  const res = await api.post('/api/v1/access/invite-admin', { email });
  return res.data;
}

/**
 * Resend an existing admin invite.
 */
export async function resendInvite(email: string) {
  const res = await api.post('/api/v1/access/resend-invite', { email });
  return res.data;
}

/**
 * Revoke or remove an admin (owner only).
 */
export async function revokeAdmin(email: string) {
  const res = await api.post('/api/v1/access/revoke-admin', { email });
  return res.data;
}

/**
 * Confirm an invite from the email link (public endpoint).
 */
export async function confirmInvite(inviteToken: string) {
  const res = await api.get('/api/v1/access/confirm-invite', {
    params: { inviteToken },
  });
  return res.data;
}
