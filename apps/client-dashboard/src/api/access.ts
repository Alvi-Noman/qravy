import api from './auth';

export type AccessSettings = {
  centralEmail: string;
  emailVerified: boolean;
  enrollment: {
    requireOtpForNewDevice: boolean;
    requireManagerPinOnAssign: boolean;
    sessionDays: number;
    autoApproveAssignment: boolean;
  };
};

export type Device = {
  id: string;
  label?: string | null;
  os?: string | null;
  browser?: string | null;
  lastSeenAt: string;
  createdAt: string;
  locationId: string | null;
  locationName?: string | null;
  status: 'active' | 'pending' | 'revoked';
  trust: 'high' | 'medium' | 'low';
  ipCountry?: string | null;
};

export type Workspace = { id: string; name: string };

export async function getAccessSettings(): Promise<AccessSettings> {
  const res = await api.get('/api/v1/access/settings');
  return res.data?.item;
}

export async function updateAccessSettings(payload: AccessSettings): Promise<AccessSettings> {
  const res = await api.put('/api/v1/access/settings', payload);
  return res.data?.item;
}

export async function listDevices(): Promise<Device[]> {
  const res = await api.get('/api/v1/access/devices');
  return res.data?.items ?? [];
}

export async function listAccessibleWorkspaces(): Promise<Workspace[]> {
  const res = await api.get('/api/v1/access/workspaces');
  return res.data?.items ?? [];
}

const DEVICE_KEY_STORAGE = 'muv_device_key';

export function getOrCreateDeviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
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