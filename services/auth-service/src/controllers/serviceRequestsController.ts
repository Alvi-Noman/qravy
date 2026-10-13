/**
 * Service requests — a guest at a table calls for staff ("Call waiter", the bill, water, clean the table …) with the
 * button on the dine-in pages; the staff see it live on the dashboard (the orders stream) and tap "On my way" → "Done".
 *  - one open request per table and kind: calling again doesn't add a row, it bumps the one there ("called 2×")
 *  - a typed table number (no QR key) is still taken, marked "table not verified" — the same as orders
 */
import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import { resolveBranchLocationId } from './categoriesController.js';
import { publishTenant } from '../services/orders/events.js';
import { tableKeyMatches } from '../utils/tableKeys.js';
import type { SERVICE_REQUEST_KINDS } from '../validation/schemas.js';

export type ServiceRequestKind = (typeof SERVICE_REQUEST_KINDS)[number];
export type ServiceRequestStatus = 'open' | 'acknowledged' | 'resolved';

export interface ServiceRequestDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  locationId: ObjectId | null;
  branch: string | null;
  table: string;
  /** false = the guest typed the table number instead of scanning its QR code */
  tableVerified: boolean;
  kind: ServiceRequestKind;
  note?: string;
  status: ServiceRequestStatus;
  /** How many times the guest called (1 = once) */
  calls: number;
  lastCalledAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  /** The guest's handle on their own request (status: "on the way") */
  publicToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const col = () => client.db('authDB').collection<ServiceRequestDoc>('serviceRequests');

/** An open request older than this is stale (the guest has left) — not shown, and a new call starts a new one. */
const ACTIVE_FOR_MS = 3 * 60 * 60 * 1000;
/** Calling again within this long only returns the request — no new "called again" alert. */
const RECALL_AFTER_MS = 30 * 1000;
/** Resolved requests stay on the board this long */
const RECENT_FOR_MS = 60 * 60 * 1000;

const tableId = (t: string) => t.replace(/^#/, '').trim().toUpperCase();

export function toAdminRequest(r: ServiceRequestDoc) {
  return {
    id: String(r._id),
    table: r.table,
    tableVerified: r.tableVerified,
    kind: r.kind,
    note: r.note ?? null,
    status: r.status,
    calls: r.calls,
    lastCalledAt: r.lastCalledAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: r.acknowledgedBy ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    locationId: r.locationId ? String(r.locationId) : null,
    branch: r.branch,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPublicRequest(r: ServiceRequestDoc) {
  return {
    token: r.publicToken,
    table: r.table,
    kind: r.kind,
    status: r.status,
    calls: r.calls,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function publish(r: ServiceRequestDoc, type: 'service.created' | 'service.updated') {
  publishTenant(r.tenantId.toHexString(), { type, request: toAdminRequest(r) });
}

/* ------------------------------------------------------------------ guest (public) */

/** POST /api/v1/public/service-requests { subdomain, branch?, table, tableKey?, kind, note? } */
export async function createServiceRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as {
      subdomain: string;
      branch?: string | null;
      table: string;
      tableKey?: string | null;
      kind: ServiceRequestKind;
      note?: string | null;
    };
    const tenant = await client
      .db('authDB')
      .collection('tenants')
      .findOne({ subdomain: b.subdomain }, { projection: { _id: 1, restaurantInfo: 1, tables: 1, tableKeys: 1 } });
    if (!tenant) return res.fail(404, 'Restaurant not found');
    const tenantOid = tenant._id as ObjectId;
    if ((tenant.restaurantInfo as { dineInEnabled?: boolean } | undefined)?.dineInEnabled === false) {
      return res.fail(409, "This restaurant isn't serving tables right now.");
    }
    const locationId = b.branch ? await resolveBranchLocationId(tenantOid, b.branch) : null;
    if (b.branch && !locationId) return res.fail(404, 'Branch not found');

    const table = tableId(b.table).slice(0, 20);
    const knownTables = Array.isArray(tenant.tables) ? (tenant.tables as string[]).map((t) => String(t).toUpperCase()) : [];
    if (!table || (knownTables.length && !knownTables.includes(table))) {
      return res.fail(400, 'We could not find that table — please check the number on your table.', { needs: 'table' });
    }
    const keys = (tenant.tableKeys ?? null) as Record<string, string> | null;
    const tableVerified = !keys?.[table] || tableKeyMatches(keys, table, b.tableKey);
    const note = b.kind === 'other' || b.note ? String(b.note ?? '').trim().slice(0, 200) : '';
    const now = new Date();

    // already called for this, and nobody has finished it → the same request (called again: the staff hear it again)
    const existing = await col().findOne({
      tenantId: tenantOid,
      locationId,
      table,
      kind: b.kind,
      status: { $in: ['open', 'acknowledged'] },
      createdAt: { $gte: new Date(now.getTime() - ACTIVE_FOR_MS) },
    });
    if (existing) {
      if (now.getTime() - existing.lastCalledAt.getTime() < RECALL_AFTER_MS) {
        return res.ok({ request: toPublicRequest(existing), created: false });
      }
      const bumped = await col().findOneAndUpdate(
        { _id: existing._id },
        {
          $inc: { calls: 1 },
          $set: { status: 'open', lastCalledAt: now, updatedAt: now, ...(note ? { note } : {}) },
        },
        { returnDocument: 'after' },
      );
      const doc = ((bumped as unknown as { value?: ServiceRequestDoc })?.value ?? bumped) as ServiceRequestDoc | null;
      if (doc) {
        publish(doc, 'service.updated');
        logger.info(`SERVICE again ${doc.kind} tenant=${tenantOid} table=${table} calls=${doc.calls}`);
        return res.ok({ request: toPublicRequest(doc), created: false });
      }
    }

    const doc: ServiceRequestDoc = {
      tenantId: tenantOid,
      locationId,
      branch: b.branch ?? null,
      table,
      tableVerified,
      kind: b.kind,
      ...(note ? { note } : {}),
      status: 'open',
      calls: 1,
      lastCalledAt: now,
      publicToken: randomBytes(24).toString('base64url'),
      createdAt: now,
      updatedAt: now,
    };
    const ins = await col().insertOne(doc);
    doc._id = ins.insertedId;
    publish(doc, 'service.created');
    logger.info(`SERVICE ${doc.kind} tenant=${tenantOid} table=${table}${tableVerified ? '' : ' (unverified)'}`);
    return res.ok({ request: toPublicRequest(doc), created: true }, 201);
  } catch (e) {
    return next(e);
  }
}

/** GET /api/v1/public/service-requests/:token — has someone seen it? */
export async function getPublicServiceRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.params.token || '');
    const doc = token.length >= 20 ? await col().findOne({ publicToken: token }) : null;
    if (!doc) return res.fail(404, 'Request not found');
    return res.ok({ request: toPublicRequest(doc) });
  } catch (e) {
    return next(e);
  }
}

/* ------------------------------------------------------------------ staff (authenticated) */

function scopeLocation(req: Request): ObjectId | null {
  const loc = req.user?.locationId;
  return loc && ObjectId.isValid(loc) ? new ObjectId(loc) : null;
}

/** GET /api/v1/service-requests — open + on-the-way requests, and the ones done in the last hour. */
export async function listServiceRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    const now = Date.now();
    const q: Record<string, unknown> = {
      tenantId: new ObjectId(tenantId),
      $or: [
        { status: { $in: ['open', 'acknowledged'] }, createdAt: { $gte: new Date(now - ACTIVE_FOR_MS) } },
        { status: 'resolved', resolvedAt: { $gte: new Date(now - RECENT_FOR_MS) } },
      ],
    };
    const loc = scopeLocation(req);
    if (loc) q.locationId = loc;
    const docs = await col().find(q).sort({ createdAt: -1 }).limit(100).toArray();
    return res.ok({ requests: docs.map(toAdminRequest) });
  } catch (e) {
    return next(e);
  }
}

/** POST /api/v1/service-requests/:id/status { status: 'acknowledged' | 'resolved' } */
export async function updateServiceRequestStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.fail(404, 'Request not found');
    const to = (req.body as { status: 'acknowledged' | 'resolved' }).status;
    const by = req.user?.email || req.user?.id;
    const now = new Date();
    const filter: Record<string, unknown> = {
      _id: new ObjectId(id),
      tenantId: new ObjectId(tenantId),
      // on my way: only an open one · done: open or on the way
      status: to === 'acknowledged' ? 'open' : { $in: ['open', 'acknowledged'] },
    };
    const loc = scopeLocation(req);
    if (loc) filter.locationId = loc;
    const set =
      to === 'acknowledged'
        ? { status: to, acknowledgedAt: now, acknowledgedBy: by, updatedAt: now }
        : { status: to, resolvedAt: now, resolvedBy: by, updatedAt: now };
    const r = await col().findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' });
    const doc = ((r as unknown as { value?: ServiceRequestDoc })?.value ?? r) as ServiceRequestDoc | null;
    if (!doc) {
      // already moved on (another device tapped it first) → send back where it is
      const current = await col().findOne({ _id: new ObjectId(id), tenantId: new ObjectId(tenantId), ...(loc ? { locationId: loc } : {}) });
      if (!current) return res.fail(404, 'Request not found');
      return res.ok({ request: toAdminRequest(current) });
    }
    publish(doc, 'service.updated');
    return res.ok({ request: toAdminRequest(doc) });
  } catch (e) {
    return next(e);
  }
}
