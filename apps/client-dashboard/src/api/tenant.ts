// apps/client-dashboard/src/api/tenant.ts
import api from './auth';
import type { TenantDTO } from '../../../../packages/shared/src/types/v1';

/**
 * Fetch the current tenant for the logged-in user.
 * Backend returns { item: TenantDTO } — unwrap and return the DTO.
 */
export async function getTenant(token: string): Promise<TenantDTO> {
  const res = await api.get('/api/v1/auth/tenants/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as TenantDTO;
}

/**
 * End trial immediately for the current tenant.
 */
export async function endTrialEarly(token: string): Promise<TenantDTO> {
  const res = await api.post(
    '/api/v1/auth/tenants/trial/end',
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.item as TenantDTO;
}

/**
 * Activate subscription and optionally set/normalize a plan.
 * planId supports p1/p2/starter/pro with interval hints; server normalizes to p*_m or p*_y.
 */
export async function subscribeTenant(
  params: {
    planId?: string;
    interval?: 'm' | 'y' | 'month' | 'year' | 'monthly' | 'yearly';
    name?: string;
    cardToken?: string;
    // Optional: if you pass payment meta, backend will save non‑sensitive card info
    payment?: {
      provider?: 'mock' | 'stripe' | 'adyen' | 'none';
      brand?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'maestro' | 'unionpay' | 'unknown';
      last4?: string;
      expMonth?: number;
      expYear?: number;
      country?: string;
      funding?: 'credit' | 'debit' | 'prepaid' | 'unknown';
      paymentMethodId?: string;
      customerId?: string;
    };
  },
  token: string
): Promise<TenantDTO> {
  const res = await api.post('/api/v1/auth/tenants/subscribe', params, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as TenantDTO;
}

/* -----------------------------------------------------------------------------
   Billing profile: save billing address/info to your database
   Requires backend endpoints:
   - GET  /api/v1/auth/tenants/billing-profile
   - POST /api/v1/auth/tenants/billing-profile
----------------------------------------------------------------------------- */

/** Payload for billing profile save. Kept local to avoid coupling to shared types. */
export type BillingProfilePayload = {
  companyName: string;
  billingEmail: string;
  extraEmails?: string[];
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string; // ISO-2
  };
  taxId?: string;
  taxExempt?: 'none' | 'exempt' | 'reverse';
  dunningEnabled?: boolean;
  dunningDays?: number[];
};

/** Get current billing profile (or null if not set). */
export async function getBillingProfile(token: string): Promise<BillingProfilePayload | null> {
  const res = await api.get('/api/v1/auth/tenants/billing-profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (res.data.item as BillingProfilePayload) ?? null;
}

/** Create/update billing profile. */
export async function updateBillingProfile(
  profile: BillingProfilePayload,
  token: string
): Promise<BillingProfilePayload> {
  const res = await api.post('/api/v1/auth/tenants/billing-profile', profile, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as BillingProfilePayload;
}

/* -----------------------------------------------------------------------------
   Convenience: subscribe and then save billing profile
   Call this from the Paywall handler after collecting billing fields.
----------------------------------------------------------------------------- */
export async function subscribeAndSaveBilling(
  params: Parameters<typeof subscribeTenant>[0],
  profile: BillingProfilePayload,
  token: string
): Promise<TenantDTO> {
  const tenant = await subscribeTenant(params, token);
  // Try to save billing profile; ignore if it fails so subscription isn't blocked
  try {
    await updateBillingProfile(profile, token);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('updateBillingProfile failed (non-blocking):', e);
  }
  return tenant;
}