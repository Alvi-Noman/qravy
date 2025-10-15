// apps/client-dashboard/src/hooks/useCapability.ts
import { hasCapability, satisfies } from '../../../../packages/shared/src/utils/policy';
import { useAuthContext } from '../context/AuthContext';

export function useHasCapability(required: string) {
  const { user } = useAuthContext();
  return hasCapability(user?.capabilities, required);
}

export function useSatisfies(required: string | string[], mode: 'all' | 'any' = 'all') {
  const { user } = useAuthContext();
  return satisfies(user?.capabilities, required, mode);
}
