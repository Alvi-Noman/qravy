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
import { useAuthContext } from '../../context/AuthContext';
import { toastSuccess, toastError } from '../Toaster';
import type { TenantDTO } from '../../../../../packages/shared/src/types/v1';
import { notifyLocationsUpdated } from '../../utils/notify';

const STEP_KEY = 'ai-setup-steps';
const QK = ['locations'] as const;

function setLocalStep(id: string, done: boolean) {
  try {
    const raw = localStorage.getItem(STEP_KEY);
    const list: Array<{ id: string; done: boolean }> = raw ? JSON.parse(raw) : [];
    const map = new Map(list.map((s) => [s.id, s.done]));
    map.set(id, done);
    const compact = Array.from(map.entries()).map(([sid, d]) => ({ id: sid, done: d }));
    localStorage.setItem(STEP_KEY, JSON.stringify(compact));
  } catch {}
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Something went wrong';
  }
}

export function useLocations() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const enabled = !!token;

  const locationsQuery = useQuery<Location[]>({
    queryKey: [QK[0], token],
    queryFn: fetchLocations, // axios client carries Authorization
    enabled,
    retry: 1,
  });

  const locations: Location[] = useMemo(() => {
    const d = locationsQuery.data;
    return Array.isArray(d) ? d : ([] as Location[]);
  }, [locationsQuery.data]);

  const createMut = useMutation({
    mutationFn: (values: LocationInput) => createLocation(values),
    onSuccess: (created) => {
      // Update list immediately
      queryClient.setQueryData<Location[]>([QK[0], token], (prev) =>
        Array.isArray(prev) ? [...prev, created] : [created]
      );

      // Optimistically set hasLocations = true on tenant
      queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
        prev
          ? {
              ...prev,
              onboardingProgress: {
                hasCategory: prev.onboardingProgress?.hasCategory ?? false,
                hasMenuItem: prev.onboardingProgress?.hasMenuItem ?? false,
                hasLocations: true,
                checklist: prev.onboardingProgress?.checklist,
              },
            }
          : prev
      );

      setLocalStep('add-locations', true);
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Location added');
      notifyLocationsUpdated(); // let Sidebar and other tabs refresh
    },
    onError: (err: unknown) => {
      toastError(`Failed to add location: ${errMsg(err)}`);
      queryClient.invalidateQueries({ queryKey: [QK[0], token] });
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: { id: string } & LocationInput) => updateLocation(payload.id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData<Location[]>([QK[0], token], (prev) =>
        (prev ?? []).map((l) => (l.id === updated.id ? updated : l))
      );
      toastSuccess('Location updated');
      notifyLocationsUpdated();
    },
    onError: (err: unknown) => {
      toastError(`Failed to update location: ${errMsg(err)}`);
      queryClient.invalidateQueries({ queryKey: [QK[0], token] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (payload: { id: string }) => deleteLocation(payload.id),
    onSuccess: (res) => {
      const next = queryClient.setQueryData<Location[]>([QK[0], token], (prev) =>
        (prev ?? []).filter((l) => l.id !== res.id)
      ) as Location[] | undefined;

      const noneLeft = !next || next.length === 0;
      if (noneLeft) {
        queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
          prev
            ? {
                ...prev,
                onboardingProgress: {
                  hasCategory: prev.onboardingProgress?.hasCategory ?? false,
                  hasMenuItem: prev.onboardingProgress?.hasMenuItem ?? false,
                  hasLocations: false,
                  checklist: prev.onboardingProgress?.checklist,
                },
              }
            : prev
        );
        setLocalStep('add-locations', false);
      }

      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Location deleted');
      notifyLocationsUpdated();
    },
    onError: (err: unknown) => {
      toastError(`Failed to delete location: ${errMsg(err)}`);
      queryClient.invalidateQueries({ queryKey: [QK[0], token] });
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