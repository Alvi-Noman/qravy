// services/auth-service/src/services/supportSessions.ts
// Qravy support access ("log in as"): a Cortex admin opens a restaurant's dashboard as an ADMIN of it — no password,
// a session of its own (1 hour), marked "Qravy support" on every screen, ended at any time, and logged: who, which
// restaurant, when, why, and every change made (method + path). The owner's own sign-ins and devices are untouched.
// The few things only the owner may do (team, billing / plan, signing their devices out, their other restaurants)
// are refused during it — SUPPORT_DENIED.
import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';

export type SupportSession = {
  _id: string; // the session id (in the tokens as `imp`)
  tenantId: ObjectId;
  tenantName: string;
  userId: ObjectId; // the restaurant's owner account the session acts through (as an admin)
  by: string; // the Cortex admin's email
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt?: Date | null;
  endedHow?: 'exit' | 'expired' | 'ended in Cortex';
  actions: Array<{ at: Date; method: string; path: string }>;
};

export const SUPPORT_MINUTES = 60;
const MAX_ACTIONS = 500;

export const supportSessions = () => client.db('authDB').collection<SupportSession>('supportSessions');

export function newSupportSessionId(): string {
  return crypto.randomBytes(18).toString('base64url');
}

// a short cache: every request in a support session checks it's still on (ending it cuts access within seconds)
const cache = new Map<string, { at: number; s: SupportSession | null }>();
const CACHE_MS = 10_000;

/** The session, if it's still on (not ended, not past its hour). */
export async function activeSupportSession(id: string): Promise<SupportSession | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.s && isOn(hit.s) ? hit.s : null;
  const s = await supportSessions().findOne({ _id: id }, { projection: { actions: 0 } });
  cache.set(id, { at: Date.now(), s });
  if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
  return s && isOn(s) ? s : null;
}

const isOn = (s: SupportSession) => !s.endedAt && s.expiresAt.getTime() > Date.now();

export async function endSupportSession(id: string, how: SupportSession['endedHow']): Promise<void> {
  await supportSessions().updateOne({ _id: id, endedAt: { $in: [null, undefined] } as never }, { $set: { endedAt: new Date(), endedHow: how } });
  cache.delete(id);
}

/** A change made in the session (kept with it — the restaurant and Qravy can see what was done). */
export function recordSupportAction(id: string, method: string, path: string): void {
  void supportSessions()
    .updateOne({ _id: id }, { $push: { actions: { $each: [{ at: new Date(), method, path: path.slice(0, 200) }], $slice: -MAX_ACTIONS } } })
    .catch(() => undefined);
}

/** What a support session may NOT do — the owner's alone. */
export const SUPPORT_DENIED: Array<{ method: string; path: RegExp; what: string; billing?: true }> = [
  { method: 'POST', path: /\/access\/(invite-admin|resend-invite|revoke-admin)\b/, what: 'team changes' },
  { method: 'POST', path: /\/access\/select-tenant\b/, what: "switching to the owner's other restaurants" },
  { method: 'POST', path: /\/tenants$/, what: 'creating a restaurant' },
  { method: 'POST', path: /\/tenants\/(subscribe|cancel|trial\/end|billing-profile)\b/, what: 'billing and the plan', billing: true },
  { method: '*', path: /\/tenants\/payment-method\b/, what: 'the payment method', billing: true },
  { method: 'POST', path: /\/(logout-all|revoke-session)\b/, what: "signing the owner's devices out" },
];

/**
 * For now Qravy sets restaurants up itself — subscribing them, adding the card, changing the plan — so a support
 * session MAY do billing (every change is still logged on the session, and the restaurant sees it in Settings →
 * Security). To make billing the owner's alone again, set SUPPORT_CAN_BILL=0 in the auth-service env and restart.
 */
export const supportCanBill = (): boolean => process.env.SUPPORT_CAN_BILL !== '0';

export function supportDenied(method: string, path: string): string | null {
  const m = method.toUpperCase();
  const canBill = supportCanBill();
  const hit = SUPPORT_DENIED.find(
    (d) => (d.method === '*' || d.method === m) && d.path.test(path.split('?')[0]) && !(d.billing && canBill)
  );
  return hit ? hit.what : null;
}
