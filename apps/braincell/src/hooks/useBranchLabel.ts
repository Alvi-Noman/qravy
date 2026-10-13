import { useCallback, useMemo } from 'react';
import { useScope } from '../context/ScopeContext';
import { useLocations } from '../components/locations/useLocations';

/**
 * The branch an order or table call came from — only when it says something: the restaurant has two or more
 * branches and the board shows all of them. One branch selected (or just one branch) → null.
 */
export function useBranchLabel(): (locationId?: string | null) => string | null {
  const { activeLocationId } = useScope();
  const { locations } = useLocations();
  const names = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const show = !activeLocationId && locations.length >= 2;
  return useCallback((id) => (show && id ? (names.get(id) ?? null) : null), [show, names]);
}
