// services/auth-service/src/services/orders/autoAccept.ts
// TEMPORARY (48 h, until AUTO_ACCEPT_UNTIL): an order the staff haven't accepted within 10 seconds is accepted
// automatically — the guest never waits on a busy counter. It goes through updateStatusCore like a staff tap, so the
// guest's order page and the dashboard update live. Only fresh orders (the last 10 minutes) — never old ones left
// at "placed". After the deadline it stops by itself; ORDER_AUTO_ACCEPT_UNTIL overrides it (a past date = off).
import { client } from '../../db.js';
import logger from '../../utils/logger.js';
import type { OrderDoc } from '../../models/Order.js';
import { updateStatusCore } from './core.js';

const AUTO_ACCEPT_UNTIL = Date.parse(process.env.ORDER_AUTO_ACCEPT_UNTIL || '2026-10-07T18:50:00Z');
const AFTER_MS = 10_000; // unaccepted this long → accepted
const FRESH_MS = 10 * 60_000; // only orders placed in the last 10 minutes
const TICK_MS = 2_000;

export function autoAcceptActive(now = Date.now()): boolean {
  return Number.isFinite(AUTO_ACCEPT_UNTIL) && now < AUTO_ACCEPT_UNTIL;
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

export function startOrderAutoAccept(): void {
  if (!autoAcceptActive()) return;
  logger.info(`Order auto-accept ON (after ${AFTER_MS / 1000}s) until ${new Date(AUTO_ACCEPT_UNTIL).toISOString()}`);
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
