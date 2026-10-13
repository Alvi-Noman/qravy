/**
 * In-process live events for orders and guests' service requests (Server-Sent Events).
 *  - "tenant:<id>"  → the admin orders board (orders + "call waiter" requests)
 *  - "order:<token>" → the guest's order-status page
 * Single auth-service instance today; swap for Redis pub/sub if it ever scales out.
 */
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

const bus = new EventEmitter();
bus.setMaxListeners(0);

export type OrderEvent = { type: 'order.created' | 'order.updated'; order: Record<string, unknown> };
/** A guest at a table asked for staff (call waiter, the bill …) — see controllers/serviceRequestsController.ts */
export type ServiceEvent = { type: 'service.created' | 'service.updated'; request: Record<string, unknown> };
export type TenantEvent = OrderEvent | ServiceEvent;

/** What the event is about (the order, or the service request) — sent as the SSE data. */
export const eventPayload = (ev: TenantEvent): Record<string, unknown> => ('order' in ev ? ev.order : ev.request);

export function publishTenant(tenantId: string, ev: TenantEvent): void {
  bus.emit(`tenant:${tenantId}`, ev);
}

export function publishOrder(token: string, ev: OrderEvent): void {
  bus.emit(`order:${token}`, ev);
}

/** Open an SSE stream on `res`, forward events from `channel`, heartbeat, clean up on disconnect. */
export function openStream(
  req: Request,
  res: Response,
  channel: string,
  initial?: TenantEvent | Record<string, unknown>,
  filter?: (ev: TenantEvent) => boolean,
): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('ready', initial ?? {});

  const onEvent = (ev: TenantEvent) => {
    if (!filter || filter(ev)) send(ev.type, eventPayload(ev));
  };
  bus.on(channel, onEvent);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(channel, onEvent);
  });
}
