import { useMemo } from 'react';
import {
  fetchLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  type Location,
  type LocationInput,
} from '../../api/locations';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const QK = ['locations'] as const;

export function useLocations() {
  const qc = useQueryClient();

  const locationsQuery = useQuery<Location[], Error>({
    queryKey: QK,
    queryFn: fetchLocations,
    retry: 1,
  });

  const locations: Location[] = useMemo(() => {
    const d = locationsQuery.data;
    return Array.isArray(d) ? d : ([] as Location[]);
  }, [locationsQuery.data]);

  const createMut = useMutation({
    mutationFn: (values: LocationInput) => createLocation(values),
    onSuccess: (created) => {
      qc.setQueryData<Location[]>(QK, (prev) => (Array.isArray(prev) ? [...prev, created] : [created]));
      localStorage.setItem('locations:updated', String(Date.now()));
    },
    onError: (err: unknown) => {
      console.error('[locations] create error:', err);
      qc.invalidateQueries({ queryKey: QK });
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: { id: string } & LocationInput) => updateLocation(payload.id, payload),
    onSuccess: (updated) => {
      qc.setQueryData<Location[]>(QK, (prev) =>
        (Array.isArray(prev) ? prev.map((l) => (l.id === updated.id ? updated : l)) : [updated])
      );
      localStorage.setItem('locations:updated', String(Date.now()));
    },
    onError: (err: unknown) => {
      console.error('[locations] update error:', err);
      qc.invalidateQueries({ queryKey: QK });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (payload: { id: string }) => deleteLocation(payload.id),
    onSuccess: (res) => {
      qc.setQueryData<Location[]>(QK, (prev) =>
        (Array.isArray(prev) ? prev.filter((l) => l.id !== res.id) : [])
      );
      localStorage.setItem('locations:updated', String(Date.now()));
    },
    onError: (err: unknown) => {
      console.error('[locations] delete error:', err);
      qc.invalidateQueries({ queryKey: QK });
    },
  });

  return {
    locationsQuery,
    locations,
    createMut,
    updateMut,
    deleteMut,
  };
}