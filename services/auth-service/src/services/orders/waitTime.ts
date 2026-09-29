/**
 * Wait-time estimation — how long until an order is ready.
 *
 *   dish time   = the variation's prepMinutes → the item's → the restaurant's default
 *   line time   = dish time + a little per extra portion (a pot of 3 biryanis isn't 3× one)
 *   order prep  = the slowest line (dishes cook side by side) + 1 min per extra dish for plating
 *   queue       = the kitchen cooks `parallelOrders` orders at once; orders ahead are scheduled onto
 *                 those stations first (list scheduling), and this order starts on the first free one
 *   ready at    = now + queue + order prep
 *
 * Pure (no I/O): services/ai-waiter-service/wait_time.py mirrors it — keep the two in step.
 */

export const DEFAULT_PREP_MINUTES = 15;
export const DEFAULT_PARALLEL_ORDERS = 3;
export const MIN_PREP = 1;
export const MAX_PREP = 240;
/** Orders older than this that are still "open" are forgotten tickets, not kitchen load. */
export const STALE_ORDER_MS = 3 * 60 * 60 * 1000;
/**
 * An order this long past its due time is almost certainly served but never marked done (busy staff don't
 * always tap the buttons) — it stops counting as kitchen load, so one forgotten ticket can't make the
 * kitchen look busy for hours.
 */
export const FORGOTTEN_AFTER_MS = 30 * 60 * 1000;

export type KitchenSettings = { defaultPrepMinutes: number; parallelOrders: number };

export type TimedItem = {
  prepMinutes?: number | null;
  variations?: Array<{ name?: string | null; prepMinutes?: number | null }> | null;
};

export type TimedLine = { prepMinutes: number; qty: number };

/** Open order already in the kitchen, as far as the queue is concerned. */
export type QueuedOrder = {
  status: string;
  /** Total prep for that order (minutes) */
  prepMinutes: number;
  /** When it's due; for a "preparing" order the remaining time is readyAt − now */
  readyAt?: Date | null;
  /** When it was placed (orders without an ETA are due at createdAt + prep) */
  createdAt?: Date | null;
};

export function kitchenSettings(t?: { kitchen?: Partial<KitchenSettings> | null } | null): KitchenSettings {
  const k = t?.kitchen ?? {};
  return {
    defaultPrepMinutes: clampPrep(k.defaultPrepMinutes) ?? DEFAULT_PREP_MINUTES,
    parallelOrders: Number.isInteger(k.parallelOrders) && (k.parallelOrders as number) >= 1
      ? Math.min(k.parallelOrders as number, 50)
      : DEFAULT_PARALLEL_ORDERS,
  };
}

/** Whole minutes in 1..240, or undefined for anything else. */
export function clampPrep(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(MAX_PREP, Math.max(MIN_PREP, Math.round(n)));
}

/** Minutes for one portion of this dish (in this size). `estimated` = nobody set a time. */
export function dishMinutes(
  item: TimedItem,
  variation: string | null | undefined,
  fallback: number = DEFAULT_PREP_MINUTES
): { minutes: number; estimated: boolean } {
  const want = String(variation ?? '').trim().toLowerCase();
  if (want) {
    const v = (item.variations ?? []).find((x) => String(x?.name ?? '').trim().toLowerCase() === want);
    const vm = clampPrep(v?.prepMinutes);
    if (vm !== undefined) return { minutes: vm, estimated: false };
  }
  const im = clampPrep(item.prepMinutes);
  if (im !== undefined) return { minutes: im, estimated: false };
  return { minutes: fallback, estimated: true };
}

/** The fastest and slowest size of a dish (for "~10–15 min" on the menu). */
export function dishRange(item: TimedItem, fallback: number = DEFAULT_PREP_MINUTES): { min: number; max: number } {
  const base = clampPrep(item.prepMinutes);
  const times = (item.variations ?? []).map((v) => clampPrep(v?.prepMinutes) ?? base ?? fallback);
  if (!times.length) times.push(base ?? fallback);
  return { min: Math.min(...times), max: Math.max(...times) };
}

/** One line: the first portion takes the full time, each extra ~20% more (max double). */
export function lineMinutes(prep: number, qty: number): number {
  const q = Math.max(1, Math.floor(qty || 1));
  const extra = Math.ceil(prep * 0.2) * (q - 1);
  return Math.min(prep * 2, prep + extra);
}

/** Cooking time of a whole order (no queue). */
export function orderPrepMinutes(lines: TimedLine[]): number {
  if (!lines.length) return 0;
  const slowest = Math.max(...lines.map((l) => lineMinutes(l.prepMinutes, l.qty)));
  const plating = Math.min(5, lines.length - 1);
  return slowest + plating;
}

/**
 * Minutes until a kitchen station is free for a new order.
 * Orders ahead are placed on the earliest-free of `parallel` stations, in the order given
 * (callers pass them oldest first). A cooking order occupies its station until its readyAt.
 */
/** Served but never marked done: 30+ min past its due time. */
export function isForgotten(o: QueuedOrder, now: Date = new Date()): boolean {
  const due = o.readyAt
    ? new Date(o.readyAt).getTime()
    : o.createdAt
      ? new Date(o.createdAt).getTime() + o.prepMinutes * 60_000
      : null;
  return due !== null && now.getTime() - due > FORGOTTEN_AFTER_MS;
}

export function queueMinutes(ahead: QueuedOrder[], parallel: number, now: Date = new Date()): number {
  const stations = new Array<number>(Math.max(1, parallel)).fill(0);
  for (const o of ahead) {
    if (isForgotten(o, now)) continue; // served, never marked done
    let work: number;
    if (o.status === 'preparing') {
      const left = o.readyAt ? (new Date(o.readyAt).getTime() - now.getTime()) / 60_000 : o.prepMinutes;
      work = Math.max(0, left);
    } else if (o.status === 'placed' || o.status === 'accepted') {
      work = Math.max(0, o.prepMinutes);
    } else {
      continue; // ready / completed / cancelled don't need the stove
    }
    let i = 0;
    for (let s = 1; s < stations.length; s++) if (stations[s] < stations[i]) i = s;
    stations[i] += work;
  }
  return Math.ceil(Math.min(...stations));
}

export type Estimate = {
  prepMinutes: number;
  queueMinutes: number;
  totalMinutes: number;
  readyAt: Date;
  /** Some dish had no time set — the restaurant default was used */
  estimated: boolean;
};

export function estimate(opts: {
  lines: Array<{ item: TimedItem; variation?: string | null; qty: number }>;
  ahead: QueuedOrder[];
  settings: KitchenSettings;
  now?: Date;
}): Estimate {
  const now = opts.now ?? new Date();
  let estimated = false;
  const timed = opts.lines.map((l) => {
    const d = dishMinutes(l.item, l.variation, opts.settings.defaultPrepMinutes);
    estimated ||= d.estimated;
    return { prepMinutes: d.minutes, qty: l.qty };
  });
  const prep = orderPrepMinutes(timed);
  const queue = queueMinutes(opts.ahead, opts.settings.parallelOrders, now);
  const total = prep + queue;
  return {
    prepMinutes: prep,
    queueMinutes: queue,
    totalMinutes: total,
    readyAt: new Date(now.getTime() + total * 60_000),
    estimated,
  };
}

/** How busy the kitchen feels, for guests ("the kitchen is busy right now"). */
export function busyLevel(queue: number): 'quiet' | 'normal' | 'busy' {
  if (queue <= 2) return 'quiet';
  if (queue <= 15) return 'normal';
  return 'busy';
}

/** Minutes left until readyAt (never negative). */
export function minutesLeft(readyAt: Date | string | null | undefined, now: Date = new Date()): number {
  if (!readyAt) return 0;
  return Math.max(0, Math.ceil((new Date(readyAt).getTime() - now.getTime()) / 60_000));
}
