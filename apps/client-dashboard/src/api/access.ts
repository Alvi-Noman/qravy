import api from './auth';

export type Workspace = { id: string; name: string };

const DEVICE_KEY_STORAGE = 'muv_device_key';
export function getOrCreateDeviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
}

export async function listAccessibleWorkspaces(): Promise<Workspace[]> {
  const res = await api.get('/api/v1/access/workspaces');
  return res.data?.items ?? [];
}

export async function lookupDeviceAssignment(
  deviceKey?: string
): Promise<{ found: false } | { found: true; tenantId: string; locationId: string | null; locationName: string | null }> {
  const res = await api.get('/api/v1/access/devices/lookup', {
    params: { deviceKey: deviceKey || getOrCreateDeviceKey() },
  });
  return res.data;
}

export async function registerDevice(opts: {
  locationId: string;
  label?: string;
  os?: string;
  browser?: string;
  deviceKey?: string;
}) {
  const payload = {
    deviceKey: opts.deviceKey || getOrCreateDeviceKey(),
    locationId: opts.locationId,
    label: opts.label,
    os: opts.os,
    browser: opts.browser,
  };
  const res = await api.post('/api/v1/access/devices/register', payload);
  return res.data?.item;
}