/**
 * Ensures a promise takes at least ms milliseconds
 */
export function minDelay<T>(p: Promise<T>, ms = 600): Promise<T> {
  return Promise.all([p, new Promise((r) => setTimeout(r, ms))]).then(([res]) => res as T);
}