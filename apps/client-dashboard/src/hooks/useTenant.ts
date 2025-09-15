import { useQuery } from '@tanstack/react-query';
import { getTenant } from '../api/tenant'; // ensure file name is api/tenant.ts
import { useAuthContext } from '../context/AuthContext';
import type { TenantDTO } from '../../../../packages/shared/src/types/v1';

/** React Query hook to fetch the current tenant */
export function useTenant() {
  const { token } = useAuthContext();
  return useQuery<TenantDTO>({
    queryKey: ['tenant', token],
    queryFn: () => getTenant(token as string),
    enabled: !!token,
  });
}