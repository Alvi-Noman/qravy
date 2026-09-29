// services/auth-service/src/controllers/menuImportsController.ts
/**
 * AI menu import (PDF → draft → review → commit)
 *   POST   /menu-imports               multipart "file" (+ optional "locationId")
 *   GET    /menu-imports               recent jobs (no drafts)
 *   GET    /menu-imports/:id           status, progress, draft, result
 *   PATCH  /menu-imports/:id/draft     save the reviewed draft
 *   POST   /menu-imports/:id/commit    import into categories/items
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { MenuImportDoc } from '../models/MenuImport.js';
import type { WriteCtx } from '../utils/httpError.js';
import { isMenuImportConfigured } from '../services/menuImport/extractor.js';
import {
  MAX_PDF_PAGES,
  failStaleImports,
  importsCol,
  loadPdf,
  startImport,
} from '../services/menuImport/pipeline.js';
import { commitDraft, markCommitted } from '../services/menuImport/commit.js';
import { inspectPhoto, sniffPhoto } from '../services/menuImport/photos.js';
import type { ImportSource } from '../services/menuImport/pipeline.js';
import type { DraftMenu } from '../services/menuImport/types.js';

const TTL_DAYS = 30;
export const MAX_PHOTOS = 10;
const MAX_PHOTO_MB = 20;
const MAX_ACTIVE_PER_TENANT = 2;

function canWrite(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
function isBranch(req: Request): boolean {
  return !req.user?.role; // device/branch session has no membership role
}

function writeCtx(req: Request): WriteCtx {
  return {
    userId: req.user!.id,
    tenantId: req.user!.tenantId!,
    ip: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  };
}

function toDTO(doc: MenuImportDoc, opts: { withDraft?: boolean } = {}) {
  return {
    id: String(doc._id),
    status: doc.status,
    fileName: doc.fileName,
    sourceType: doc.sourceType ?? 'pdf',
    pageCount: doc.pageCount,
    locationId: doc.locationId ? String(doc.locationId) : null,
    progress: doc.progress,
    error: doc.error ?? null,
    warnings: doc.warnings ?? [],
    ...(opts.withDraft ? { draft: doc.draft ?? null } : {}),
    result: doc.result ?? null,
    model: doc.model ?? null,
    usage: doc.usage,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Common guard: member session with write role and a tenant. Returns false if it already responded. */
function guardWrite(req: Request, res: Response): boolean {
  if (isBranch(req)) {
    res.fail(403, 'Not allowed for branch session');
    return false;
  }
  if (!req.user?.id) {
    res.fail(401, 'Unauthorized');
    return false;
  }
  if (!req.user?.tenantId) {
    res.fail(409, 'Tenant not set');
    return false;
  }
  if (!canWrite(req.user?.role)) {
    res.fail(403, 'Forbidden');
    return false;
  }
  return true;
}

async function findJob(req: Request): Promise<MenuImportDoc | null> {
  const id = req.params.id;
  if (!id || !ObjectId.isValid(id) || !req.user?.tenantId) return null;
  return importsCol().findOne({ _id: new ObjectId(id), tenantId: new ObjectId(req.user.tenantId) });
}

export async function createMenuImport(req: Request, res: Response, next: NextFunction) {
  try {
    if (!guardWrite(req, res)) return;
    if (!isMenuImportConfigured()) {
      return res.fail(503, 'AI menu import is not configured on this server (missing OPENAI_API_KEY).');
    }

    // Accept "file" (single) and "files" (multiple), in the order given
    const fields = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const uploads = [...(fields.file ?? []), ...(fields.files ?? [])].filter((f) => f.buffer?.length);
    if (!uploads.length) return res.fail(400, 'Please attach a menu PDF or photos.');

    const isPdf = (f: Express.Multer.File) => f.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    const pdfs = uploads.filter(isPdf);

    let source: ImportSource;
    let pageCount: number;
    let fileName: string;

    if (pdfs.length) {
      if (uploads.length > 1) {
        return res.fail(400, 'Upload one PDF on its own, or photos without a PDF.');
      }
      const file = pdfs[0];
      try {
        pageCount = (await loadPdf(file.buffer)).getPageCount();
      } catch {
        return res.fail(400, 'This PDF could not be opened. It may be corrupted or password-protected.');
      }
      if (pageCount < 1) return res.fail(400, 'This PDF has no pages.');
      if (pageCount > MAX_PDF_PAGES) {
        return res.fail(400, `This PDF has ${pageCount} pages. The maximum is ${MAX_PDF_PAGES}.`);
      }
      source = { kind: 'pdf', pdf: file.buffer };
      fileName = (file.originalname || 'menu.pdf').slice(0, 200);
    } else {
      if (uploads.length > MAX_PHOTOS) {
        return res.fail(400, `Upload at most ${MAX_PHOTOS} photos at a time.`);
      }
      for (const [i, f] of uploads.entries()) {
        const label = f.originalname || `Photo ${i + 1}`;
        const kind = sniffPhoto(f.buffer);
        if (kind === 'heic') {
          return res.fail(415, `"${label}" is an iPhone HEIC photo. Please upload it as JPG (in iPhone Settings → Camera → Formats → Most Compatible).`);
        }
        if (!kind) return res.fail(415, `"${label}" is not a supported file. Use a PDF, JPG, PNG or WebP.`);
        if (f.buffer.length > MAX_PHOTO_MB * 1024 * 1024) {
          return res.fail(413, `"${label}" is too large (max ${MAX_PHOTO_MB} MB per photo).`);
        }
        try {
          await inspectPhoto(f.buffer);
        } catch {
          return res.fail(400, `"${label}" could not be opened. It may be damaged.`);
        }
      }
      source = { kind: 'photos', photos: uploads.map((f) => f.buffer) };
      pageCount = uploads.length;
      fileName =
        uploads.length === 1
          ? (uploads[0].originalname || 'Menu photo').slice(0, 200)
          : `${uploads.length} menu photos`;
    }

    const tenantOid = new ObjectId(req.user!.tenantId!);

    // Optional branch target (must belong to this tenant)
    const rawLoc = typeof req.body?.locationId === 'string' ? req.body.locationId.trim() : '';
    let locationId: ObjectId | null = null;
    if (rawLoc) {
      if (!ObjectId.isValid(rawLoc)) return res.fail(400, 'Invalid locationId');
      const loc = await client
        .db('authDB')
        .collection('locations')
        .findOne({ _id: new ObjectId(rawLoc), tenantId: tenantOid }, { projection: { _id: 1 } });
      if (!loc) return res.fail(404, 'Location not found');
      locationId = loc._id as ObjectId;
    }

    await failStaleImports();
    const active = await importsCol().countDocuments({ tenantId: tenantOid, status: 'processing' });
    if (active >= MAX_ACTIVE_PER_TENANT) {
      return res.fail(429, 'Another menu is still being processed. Please wait for it to finish.');
    }

    const now = new Date();
    const doc: MenuImportDoc = {
      tenantId: tenantOid,
      createdBy: new ObjectId(req.user!.id),
      locationId,
      fileName,
      sourceType: source.kind,
      pageCount,
      status: 'processing',
      progress: { done: 0, total: pageCount },
      warnings: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      expiresAt: new Date(now.getTime() + TTL_DAYS * 86_400_000),
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await importsCol().insertOne(doc);
    startImport(insertedId, source);

    return res.ok({ import: toDTO({ ...doc, _id: insertedId }) }, 202);
  } catch (err) {
    logger.error(`createMenuImport error: ${(err as Error).message}`);
    next(err);
  }
}

export async function listMenuImports(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user?.tenantId) return res.fail(409, 'Tenant not set');
    const docs = await importsCol()
      .find({ tenantId: new ObjectId(req.user.tenantId) }, { projection: { draft: 0 } })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    return res.ok({ items: docs.map((d) => toDTO(d)) });
  } catch (err) {
    logger.error(`listMenuImports error: ${(err as Error).message}`);
    next(err);
  }
}

export async function getMenuImport(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await findJob(req);
    if (!job) return res.fail(404, 'Import not found');
    return res.ok({ import: toDTO(job, { withDraft: true }) });
  } catch (err) {
    logger.error(`getMenuImport error: ${(err as Error).message}`);
    next(err);
  }
}

export async function saveMenuImportDraft(req: Request, res: Response, next: NextFunction) {
  try {
    if (!guardWrite(req, res)) return;
    const job = await findJob(req);
    if (!job) return res.fail(404, 'Import not found');

    const draft = (req.body as { draft: DraftMenu }).draft;
    const updated = await importsCol().findOneAndUpdate(
      { _id: job._id, status: 'ready' },
      { $set: { draft, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!updated) return res.fail(409, 'This import can no longer be edited.');
    return res.ok({ import: toDTO(updated, { withDraft: true }) });
  } catch (err) {
    logger.error(`saveMenuImportDraft error: ${(err as Error).message}`);
    next(err);
  }
}

export async function commitMenuImport(req: Request, res: Response, next: NextFunction) {
  try {
    if (!guardWrite(req, res)) return;
    const job = await findJob(req);
    if (!job) return res.fail(404, 'Import not found');

    // Idempotent: a repeated commit returns the original result.
    if (job.status === 'committed') return res.ok({ import: toDTO(job) });

    // Optional last-second draft (so the client doesn't have to PATCH first).
    const bodyDraft = (req.body as { draft?: DraftMenu })?.draft;

    // Atomically claim the job so a double-click can't import twice.
    const claimed = await importsCol().findOneAndUpdate(
      { _id: job._id, status: 'ready' },
      {
        $set: {
          status: 'committing',
          ...(bodyDraft ? { draft: bodyDraft } : {}),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      const msg =
        job.status === 'committing'
          ? 'This menu is already being imported.'
          : job.status === 'processing'
            ? 'This menu is still being processed.'
            : 'This import cannot be committed.';
      return res.fail(409, msg);
    }

    let result;
    try {
      result = await commitDraft(writeCtx(req), claimed);
    } catch (err) {
      await importsCol().updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            error:
              'The import stopped unexpectedly and some items may already have been added. Check your menu before importing again.',
            updatedAt: new Date(),
          },
        }
      );
      throw err;
    }
    await markCommitted(job._id!, result);

    const fresh = await importsCol().findOne({ _id: job._id });
    return res.ok({ import: toDTO(fresh ?? { ...claimed, status: 'committed', result }) });
  } catch (err) {
    logger.error(`commitMenuImport error: ${(err as Error).message}`);
    next(err);
  }
}
