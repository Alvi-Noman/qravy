import api from './auth'; // axios instance with Authorization interceptor

export interface Location {
  id: string;
  name: string;
  address?: string;
  zip?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationInput {
  name: string;
  address?: string;
  zip?: string;
  country?: string;
}

// Helper to unwrap your responseFormatter shapes
function unwrap<T>(payload: any): T {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data as T;
  if (Array.isArray(data?.items)) return data.items as T;
  if (data?.item) return data.item as T;
  return data as T;
}

export async function fetchLocations(): Promise<Location[]> {
  const res = await api.get('/api/v1/locations', { withCredentials: true });
  return unwrap<Location[]>(res.data);
}

export async function createLocation(values: LocationInput): Promise<Location> {
  const res = await api.post('/api/v1/locations', values, { withCredentials: true });
  return unwrap<Location>(res.data);
}

export async function updateLocation(id: string, values: LocationInput): Promise<Location> {
  const res = await api.patch(`/api/v1/locations/${encodeURIComponent(id)}`, values, {
    withCredentials: true,
  });
  return unwrap<Location>(res.data);
}

export async function deleteLocation(id: string): Promise<{ id: string }> {
  const res = await api.delete(`/api/v1/locations/${encodeURIComponent(id)}`, {
    withCredentials: true,
  });
  return unwrap<{ id: string }>(res.data);
}