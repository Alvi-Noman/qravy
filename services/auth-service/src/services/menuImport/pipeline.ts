/**
 * Menu import pipeline (runs in-process, state persisted on the job doc):
 *   split PDF → extract chunks in parallel → normalize/merge → match existing → draft ready
 */
import { ObjectId } from 'mongodb';
import { PDFDocument } from 'pdf-lib';
import { client } from '../../db.js';
import logger from '../../utils/logger.js';
import type { MenuImportDoc } from '../../models/MenuImport.js';
import { ExtractionTruncatedError, getMenuExtractor, type ExtractInput } from './extractor.js';
import { isLargeFormat, openForRender, renderPage, type RenderedPage } from './raster.js';
import { inspectPhoto, photoGrid, preparePhoto } from './photos.js';
import { matchExisting, mergeChunks } from './normalize.js';
import type { RawMenu } from './types.js';

export const MAX_PDF_PAGES = Number(process.env.MENU_IMPORT_MAX_PAGES ?? 40);
const PAGES_PER_CHUNK = Number(process.env.MENU_IMPORT_PAGES_PER_CHUNK ?? 3);
const CONCURRENCY = Number(process.env.MENU_IMPORT_CONCURRENCY ?? 3);
const STALE_AFTER_MS = 10 * 60_000;
/** Largest PDF slice sent as-is (base64 adds ~33%; the API limit is 50 MB per request). */
const MAX_PDF_CHUNK_BYTES = Number(process.env.MENU_IMPORT_MAX_CHUNK_MB ?? 20) * 1024 * 1024;

export function importsCol() {
  return client.db('authDB').collection<MenuImportDoc>('menuImports');
}

/** Parses the PDF; throws if the file isn't a readable PDF. */
export async function loadPdf(buf: Buffer): Promise<PDFDocument> {
  return PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
}

async function slicePdf(src: PDFDocument, start: number, end: number): Promise<Buffer> {
  const out = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

type ChunkResult = { menu: RawMenu; pageOffset: number } | { failed: string };
type Unit =
  | { kind: 'pdf'; start: number; end: number }
  | { kind: 'raster'; page: number }
  | { kind: 'photo'; page: number };

/** What the owner uploaded: one PDF, or menu photos in page order. */
export type ImportSource = { kind: 'pdf'; pdf: Buffer } | { kind: 'photos'; photos: Buffer[] };

/**
 * Starts processing a job in the background. Never throws (errors are recorded
 * on the job) — an unhandled rejection would shut the service down.
 */
export function startImport(jobId: ObjectId, source: ImportSource): void {
  runImport(jobId, source).catch(async (err) => {
    logger.error(`[menuImport] job ${jobId} failed: ${(err as Error).message}`);
    try {
      await importsCol().updateOne(
        { _id: jobId },
        {
          $set: {
            status: 'failed',
            error: 'We could not read this menu. Please try again or use a clearer file.',
            updatedAt: new Date(),
          },
        }
      );
    } catch {
      /* noop */
    }
  });
}

async function runImport(jobId: ObjectId, source: ImportSource): Promise<void> {
  const job = await importsCol().findOne({ _id: jobId });
  if (!job) return;

  const extractor = getMenuExtractor();
  const doc = source.kind === 'pdf' ? await loadPdf(source.pdf) : null;
  const totalPages = doc ? doc.getPageCount() : source.kind === 'photos' ? source.photos.length : 0;

  const existingCategories = await client
    .db('authDB')
    .collection('categories')
    .find({ tenantId: job.tenantId }, { projection: { _id: 1, name: 1 } })
    .toArray();
  const existingCategoryNames = existingCategories.map((c) => String(c.name));

  // Plan the work: normal pages go to the model as small PDFs (best fidelity);
  // poster / menu-board pages are rendered and cut into readable tiles.
  const units: Unit[] = [];
  let group: number[] = [];
  const flush = () => {
    if (group.length) units.push({ kind: 'pdf', start: group[0], end: group[group.length - 1] });
    group = [];
  };
  for (let n = 1; doc && n <= totalPages; n++) {
    const { width, height } = doc.getPage(n - 1).getSize();
    if (isLargeFormat(width, height)) {
      flush();
      units.push({ kind: 'raster', page: n });
    } else {
      group.push(n);
      if (group.length >= PAGES_PER_CHUNK) flush();
    }
  }
  flush();
  // Photos: each one is a page
  if (source.kind === 'photos') {
    source.photos.forEach((_, i) => units.push({ kind: 'photo', page: i + 1 }));
  }

  await importsCol().updateOne(
    { _id: jobId },
    { $set: { progress: { done: 0, total: totalPages }, model: extractor.model, updatedAt: new Date() } }
  );

  const usage = { inputTokens: 0, outputTokens: 0 };
  let pagesDone = 0;
  const base = { fileName: job.fileName, totalPages, existingCategoryNames };

  const render: { doc: ReturnType<typeof openForRender> | null } = { doc: null };
  const getRenderDoc = () => {
    if (source.kind !== 'pdf') throw new Error('Not a PDF import');
    return (render.doc ??= openForRender(source.pdf));
  };

  /** Calls the model, retrying once on transient errors. Truncation is re-thrown for the caller. */
  const callModel = async (input: ExtractInput) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await extractor.extract(input);
        usage.inputTokens += out.usage.inputTokens;
        usage.outputTokens += out.usage.outputTokens;
        return out.menu;
      } catch (err) {
        if (err instanceof ExtractionTruncatedError) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  };

  /** Renders a page into tiles (auto grid for posters, or a forced grid) and reads each tile. */
  const extractRendered = async (page: number, grid?: { cols: number; rows: number }): Promise<ChunkResult[]> => {
    let rendered;
    try {
      rendered = await renderPage(await getRenderDoc(), page, { grid });
    } catch (err) {
      logger.warn(`[menuImport] job ${jobId} page ${page} render failed: ${(err as Error).message}`);
      return [{ failed: `Page ${page}` }];
    }
    return readTiles(rendered, 'page');
  };

  /** Reads every tile of a rendered page/photo; failed tiles become warnings. */
  const readTiles = async (rendered: RenderedPage, noun: 'page' | 'photo'): Promise<ChunkResult[]> => {
    const page = rendered.pageNo;
    const Noun = noun === 'page' ? 'Page' : 'Photo';
    const out: ChunkResult[] = [];
    for (const tile of rendered.tiles) {
      const label = tile.count > 1 ? `Part of ${noun} ${page} (${tile.label})` : `${Noun} ${page}`;
      try {
        const menu = await callModel({
          ...base,
          kind: 'image',
          pageStart: page,
          pageEnd: page,
          image: tile.image,
          overview: rendered.overview,
          text: tile.text,
          tile: { index: tile.index, count: tile.count, label: tile.label },
        });
        out.push({ menu, pageOffset: page - 1 });
      } catch (err) {
        logger.warn(`[menuImport] job ${jobId} ${label} failed: ${(err as Error)?.message}`);
        out.push({ failed: label });
      }
    }
    return out;
  };

  /** Reads one photo; if it holds too many items for one response, reads it again in tiles. */
  const extractPhoto = async (page: number): Promise<ChunkResult[]> => {
    if (source.kind !== 'photos') return [];
    const buf = source.photos[page - 1];
    try {
      const single = await preparePhoto(buf, page);
      const tile = single.tiles[0];
      try {
        const menu = await callModel({
          ...base,
          kind: 'image',
          pageStart: page,
          pageEnd: page,
          image: tile.image,
          overview: null,
          text: '',
          tile: { index: 0, count: 1, label: tile.label },
        });
        return [{ menu, pageOffset: page - 1 }];
      } catch (err) {
        if (!(err instanceof ExtractionTruncatedError)) throw err;
        const { width, height } = await inspectPhoto(buf);
        return readTiles(await preparePhoto(buf, page, { grid: photoGrid(width, height) }), 'photo');
      }
    } catch (err) {
      logger.warn(`[menuImport] job ${jobId} photo ${page} failed: ${(err as Error)?.message}`);
      return [{ failed: `Photo ${page}` }];
    }
  };

  /** Reads a page range as PDF; splits on truncation/oversize, falls back to rendering for single pages. */
  const extractPdfRange = async (start: number, end: number): Promise<ChunkResult[]> => {
    const halves = async () => {
      const m = Math.floor((start + end) / 2);
      return [...(await extractPdfRange(start, m)), ...(await extractPdfRange(m + 1, end))];
    };
    const chunk = await slicePdf(doc!, start, end);
    if (chunk.length > MAX_PDF_CHUNK_BYTES) {
      // Heavy print file (big photos): send fewer pages, or a rendered image of the page.
      return end > start ? halves() : extractRendered(start);
    }
    try {
      const menu = await callModel({ ...base, kind: 'pdf', pdf: chunk, pageStart: start, pageEnd: end });
      return [{ menu, pageOffset: start - 1 }];
    } catch (err) {
      if (err instanceof ExtractionTruncatedError) {
        // Too many items for one response: fewer pages, or cut the page into 4 parts.
        return end > start ? halves() : extractRendered(start, { cols: 2, rows: 2 });
      }
      logger.warn(`[menuImport] job ${jobId} pages ${start}-${end} failed: ${(err as Error)?.message}`);
      return [{ failed: start === end ? `Page ${start}` : `Pages ${start}–${end}` }];
    }
  };

  const results = (
    await runWithConcurrency(
      units.map((u) => async () => {
        const r =
          u.kind === 'pdf'
            ? await extractPdfRange(u.start, u.end)
            : u.kind === 'raster'
              ? await extractRendered(u.page)
              : await extractPhoto(u.page);
        pagesDone += u.kind === 'pdf' ? u.end - u.start + 1 : 1;
        await importsCol().updateOne(
          { _id: jobId },
          { $set: { 'progress.done': pagesDone, usage: { ...usage }, updatedAt: new Date() } }
        );
        return r;
      }),
      CONCURRENCY
    )
  ).flat();

  if (render.doc) {
    try {
      await (await render.doc).loadingTask.destroy();
    } catch {
      /* noop */
    }
  }

  const ok = results.filter((r): r is { menu: RawMenu; pageOffset: number } => 'menu' in r);
  const warnings = results
    .filter((r): r is { failed: string } => 'failed' in r)
    .map((r) => `${r.failed} could not be read — add those items manually or re-upload a clearer file.`);

  if (!ok.length) {
    await importsCol().updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'failed',
          error:
            source.kind === 'photos'
              ? 'We could not read any of these photos. Please retake them flat, well lit and in focus.'
              : 'We could not read any page of this menu. Please try a clearer PDF.',
          warnings,
          usage,
          updatedAt: new Date(),
        },
      }
    );
    return;
  }

  const draft = mergeChunks(ok);
  if (!draft.categories.length) {
    await importsCol().updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'failed',
          error: source.kind === 'photos' ? 'No menu items were found in these photos.' : 'No menu items were found in this PDF.',
          warnings,
          usage,
          updatedAt: new Date(),
        },
      }
    );
    return;
  }

  const existingItems = await client
    .db('authDB')
    .collection('menuItems')
    .find({ tenantId: job.tenantId }, { projection: { _id: 1, name: 1, categoryId: 1, category: 1 } })
    .toArray();

  matchExisting(
    draft,
    existingCategories.map((c) => ({ id: String(c._id), name: String(c.name) })),
    existingItems.map((i) => ({
      id: String(i._id),
      name: String(i.name ?? ''),
      categoryId: i.categoryId ? String(i.categoryId) : undefined,
      category: typeof i.category === 'string' ? i.category : undefined,
    }))
  );

  await importsCol().updateOne(
    { _id: jobId },
    {
      $set: {
        status: 'ready',
        draft,
        warnings,
        usage,
        progress: { done: totalPages, total: totalPages },
        updatedAt: new Date(),
      },
    }
  );
  logger.info(
    `[menuImport] job ${jobId} ready: ${draft.categories.length} categories, ` +
      `${draft.categories.reduce((n, c) => n + c.items.length, 0)} items, ` +
      `tokens in=${usage.inputTokens} out=${usage.outputTokens}`
  );
}

/** Jobs left in "processing" by a restarted process can never finish — mark them failed. */
export async function failStaleImports(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const now = new Date();
  const processing = await importsCol().updateMany(
    { status: 'processing', updatedAt: { $lt: cutoff } },
    { $set: { status: 'failed', error: 'Processing was interrupted. Please upload the menu again.', updatedAt: now } }
  );
  const committing = await importsCol().updateMany(
    { status: 'committing', updatedAt: { $lt: cutoff } },
    {
      $set: {
        status: 'failed',
        error: 'The import was interrupted and some items may already have been added. Check your menu before importing again.',
        updatedAt: now,
      },
    }
  );
  const n = processing.modifiedCount + committing.modifiedCount;
  if (n) logger.warn(`[menuImport] marked ${n} stale import(s) as failed`);
}
