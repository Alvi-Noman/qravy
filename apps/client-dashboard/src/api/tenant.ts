// apps/client-dashboard/src/api/tenant.ts
import api from './auth';
import type { TenantDTO } from '../../../../packages/shared/src/types/v1';

/**
 * Fetch the current tenant for the logged-in user.
 * Backend returns { item: TenantDTO } — unwrap and return the DTO.
 */
export async function getTenant(token: string): Promise<TenantDTO> {
  const res = await api.get('/api/v1/auth/tenants/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as TenantDTO;
}

/**
 * End trial immediately for the current tenant.
 */
export async function endTrialEarly(token: string): Promise<TenantDTO> {
  const res = await api.post(
    '/api/v1/auth/tenants/trial/end',
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.item as TenantDTO;
}

/**
 * Activate subscription and optionally set/normalize a plan.
 * planId supports p1/p2/starter/pro with interval hints; server normalizes to p*_m or p*_y.
 */
export async function subscribeTenant(
  params: {
    planId?: string;
    interval?: 'm' | 'y' | 'month' | 'year' | 'monthly' | 'yearly';
    name?: string;
    cardToken?: string;
  },
  token: string
): Promise<TenantDTO> {
  const res = await api.post('/api/v1/auth/tenants/subscribe', params, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as TenantDTO;
}