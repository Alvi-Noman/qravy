import api from './auth';

export type Workspace = { id: string; name: string };

export async function listAccessibleWorkspaces(): Promise<Workspace[]> {
  const res = await api.get('/api/v1/access/workspaces');
  return res.data?.items ?? [];
}

export async function lookupDeviceAssignment(): Promise<
  { found: false } | { found: true; tenantId: string; locationId: string | null; locationName: string | null }
> {
  const res = await api.get('/api/v1/access/devices/lookup');
  return res.data;
}

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