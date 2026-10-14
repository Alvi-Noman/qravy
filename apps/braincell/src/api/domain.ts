// apps/braincell/src/api/domain.ts — the restaurant's own domain (auth-service routes/domainRoutes.ts).
import api from './auth';

export type DomainRecord = {
  type: 'A' | 'CNAME';
  /** what the DNS provider calls the "Host" / "Name" field: "@", "www", "order" */
  name: string;
  value: string;
  /** the full name the record is for ("burgerhouse.com", "www.burgerhouse.com") */
  host: string;
  /** after a check: is it right, what DNS answers now, and why not */
  ok?: boolean;
  found?: string[];
  problem?: 'missing' | 'wrong' | 'extra' | 'cloudflare-proxy' | 'ipv6';
};

export type DomainState = {
  qravyAddress: string;
  domain: null | {
    host: string;
    kind: 'apex' | 'sub';
    primary: string;
    hosts: string[];
    status: 'pending' | 'connected';
    redirect: boolean;
    https: boolean;
    addedAt: string;
    verifiedAt: string | null;
    checkedAt: string | null;
    records: DomainRecord[];
    provider: { id: string; name: string } | null;
  };
};

export const getDomain = async (): Promise<DomainState> => (await api.get('/api/v1/tenants/me/domain')).data;
export const addDomain = async (domain: string): Promise<DomainState> =>
  (await api.put('/api/v1/tenants/me/domain', { domain })).data;
export const checkDomain = async (): Promise<DomainState> => (await api.post('/api/v1/tenants/me/domain/check')).data;
export const setDomainRedirect = async (redirect: boolean): Promise<DomainState> =>
  (await api.patch('/api/v1/tenants/me/domain', { redirect })).data;
export const removeDomain = async (): Promise<DomainState> => (await api.delete('/api/v1/tenants/me/domain')).data;
