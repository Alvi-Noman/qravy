import api from './auth';
import type { TenantDTO } from '../../../../packages/shared/src/types/v1';

/**
 * Fetch the current tenant for the logged-in user.
 * The backend returns { item: TenantDTO }, so unwrap it here.
 */
export async function getTenant(token: string): Promise<TenantDTO> {
  const res = await api.get('/api/v1/auth/tenants/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as TenantDTO;
}