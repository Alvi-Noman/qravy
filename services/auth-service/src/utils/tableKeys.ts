// services/auth-service/src/utils/tableKeys.ts
// Every dine-in table has a short secret key, printed into its QR code ("/dine-in?table=12&k=x7f2ab9q"). An order
// that carries the key really comes from someone who scanned that table; one without it (a typed table number) is
// still taken, but marked "table not verified" for the staff to check before cooking.
import { randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no 0/o/1/l — the link is sometimes read out or typed

export function newTableKey(length = 8): string {
  const bytes = randomBytes(length);
  let key = '';
  for (let i = 0; i < length; i++) key += ALPHABET[bytes[i] % ALPHABET.length];
  return key;
}

/** Keys for these tables: a table keeps its key (its printed QR code stays valid); a new table gets a new one. */
export function tableKeysFor(tables: string[], existing?: Record<string, string> | null): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const t of tables) keys[t] = existing?.[t] || newTableKey();
  return keys;
}

/** True when some table has no key yet (tables saved before keys existed). */
export function missingTableKeys(tables?: string[] | null, keys?: Record<string, string> | null): boolean {
  return (tables ?? []).some((t) => !keys?.[t]);
}

/** Does this key belong to this table? */
export function tableKeyMatches(keys: Record<string, string> | null | undefined, table: string, key?: string | null): boolean {
  const want = keys?.[table.replace(/^#/, '').toUpperCase()];
  const got = String(key ?? '').trim().toLowerCase();
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
