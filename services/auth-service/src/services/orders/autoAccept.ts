// services/auth-service/src/services/orders/autoAccept.ts
// TEMPORARY (48 h from the moment it first runs in an environment): an order the staff haven't accepted within
// 10 seconds is accepted automatically — the guest never waits on a busy counter. It goes through updateStatusCore
// like a staff tap, so the guest's order page and the dashboard update live. Only fresh orders (the last 10 minutes)
// — never old ones left at "placed". The end time is stored once in the database (appFlags: orderAutoAccept), so
// restarts and later deploys never extend it; after it, the job stops by itself.
// ORDER_AUTO_ACCEPT_UNTIL (an ISO date) overrides it — a past date switches it off.
import { client } from '../../db.js';
import logger from '../../utils/logger.js';
import type { OrderDoc } from '../../models/Order.js';
import { updateStatusCore } from './core.js';

const WINDOW_MS = 48 * 60 * 60_000; // how long it runs, from its first start
const AFTER_MS = 10_000; // unaccepted this long → accepted
const FRESH_MS = 10 * 60_000; // only orders placed in the last 10 minutes
const TICK_MS = 2_000;
const FLAG_ID = 'orderAutoAccept';

let until = 0;

export function autoAcceptActive(now = Date.now()): boolean {
  return Number.isFinite(until) && now < until;
}

/** The end time: the override, else the one stored at the first start (stored now if this is the first start). */
async function resolveUntil(): Promise<number> {
  const override = process.env.ORDER_AUTO_ACCEPT_UNTIL;
  if (override) return Date.parse(override);
  const flags = client.db('authDB').collection<{ _id: string; until: Date; startedAt: Date }>('appFlags');
  const now = new Date();
  // $setOnInsert: only the very first start writes it — every later start reads the same end time
  await flags.updateOne(
    { _id: FLAG_ID },
    { $setOnInsert: { until: new Date(now.getTime() + WINDOW_MS), startedAt: now } },
    { upsert: true },
  );
  const doc = await flags.findOne({ _id: FLAG_ID });
  return doc?.until ? new Date(doc.until).getTime() : now.getTime() + WINDOW_MS;
}

async function acceptDue(): Promise<void> {
  const now = Date.now();
  const due = await client
    .db('authDB')
    .collection<OrderDoc>('orders')
    .find(
      { status: 'placed', createdAt: { $lte: new Date(now - AFTER_MS), $gte: new Date(now - FRESH_MS) } },
      { projection: { _id: 1, tenantId: 1, orderNumber: 1 } },
    )
    .limit(50)
    .toArray();
  for (const o of due) {
    try {
      await updateStatusCore({ tenantOid: o.tenantId, orderId: String(o._id), to: 'accepted', by: 'auto-accept' });
      logger.info(`AUTO-ACCEPT order #${o.orderNumber} (${o._id}) tenant=${o.tenantId}`);
    } catch (e) {
      // staff accepted / cancelled it in the same moment — fine
      logger.debug?.(`auto-accept skipped ${o._id}: ${(e as Error).message}`);
    }
  }
}

export async function startOrderAutoAccept(): Promise<void> {
  try {
    until = await resolveUntil();
  } catch (e) {
    logger.warn(`Order auto-accept: couldn't read its end time (${(e as Error).message}) — not started`);
    return;
  }
  if (!autoAcceptActive()) {
    logger.info(`Order auto-accept is off (ended ${Number.isFinite(until) ? new Date(until).toISOString() : 'n/a'})`);
    return;
  }
  logger.info(`Order auto-accept ON (after ${AFTER_MS / 1000}s) until ${new Date(until).toISOString()}`);
  let busy = false;
  const timer = setInterval(() => {
    if (!autoAcceptActive()) {
      clearInterval(timer);
      logger.info('Order auto-accept OFF (its time is up)');
      return;
    }
    if (busy) return;
    busy = true;
    acceptDue()
      .catch((e) => logger.warn(`auto-accept: ${(e as Error).message}`))
      .finally(() => {
        busy = false;
      });
  }, TICK_MS);
  timer.unref();
}
