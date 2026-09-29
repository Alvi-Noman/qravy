/**
 * Renders PDF pages to JPEG tiles for the vision model.
 *
 * Used when sending the PDF itself won't work well:
 *   - print-ready files whose pages are too heavy to upload (big photos, CMYK)
 *   - poster / menu-board pages (A2, A1…) where small text would be unreadable
 *     and 100+ items overflow a single model response
 *
 * Big pages are cut into roughly A4-sized tiles with a small overlap. Each tile
 * carries only the text that lies inside it, plus a low-res overview of the
 * whole page so the model can see which section heading a tile belongs to.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

type PdfJsDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
type PdfJsPage = Awaited<ReturnType<PdfJsDoc['getPage']>>;

const A4_LONG = 842; // pt
const A4_SHORT = 595;
/** A tile may be up to ~20% larger than A4 before we split further. */
const TILE_MAX_LONG = A4_LONG * 1.2;
const TILE_MAX_SHORT = A4_SHORT * 1.2;
const MAX_GRID = 4;
const OVERLAP = 0.06; // of tile size, each side
const TILE_LONG_PX = 1800; // ≈ 150–200 DPI for an A4-sized tile
const OVERVIEW_LONG_PX = 1024;

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
// pdf.js wants "/"-terminated paths, also on Windows
const STANDARD_FONTS = path.join(pdfjsRoot, 'standard_fonts').replace(/\\/g, '/') + '/';
const CMAPS = path.join(pdfjsRoot, 'cmaps').replace(/\\/g, '/') + '/';

export type Tile = {
  image: Buffer; // JPEG
  text: string; // text found inside the tile
  index: number; // 0-based
  count: number;
  label: string; // e.g. "top-left"
};

export type RenderedPage = {
  pageNo: number;
  overview: Buffer | null; // JPEG of the whole page (only when tiled)
  tiles: Tile[];
};

export async function openForRender(pdf: Buffer): Promise<PdfJsDoc> {
  return pdfjs.getDocument({
    data: new Uint8Array(pdf), // copy: pdf.js detaches the buffer it is given
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
}

/** Page size in points, honouring rotation. */
export function pageSize(page: PdfJsPage): { width: number; height: number } {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

/** True for poster/menu-board sized pages (clearly larger than A4/Letter). */
export function isLargeFormat(width: number, height: number): boolean {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return long > TILE_MAX_LONG * 1.15 || short > TILE_MAX_SHORT * 1.15;
}

/** How many columns/rows to cut a page into so each tile is about A4. */
export function planGrid(width: number, height: number): { cols: number; rows: number } {
  const landscape = width > height;
  const tileW = landscape ? TILE_MAX_LONG : TILE_MAX_SHORT;
  const tileH = landscape ? TILE_MAX_SHORT : TILE_MAX_LONG;
  return {
    cols: Math.min(MAX_GRID, Math.max(1, Math.ceil(width / tileW))),
    rows: Math.min(MAX_GRID, Math.max(1, Math.ceil(height / tileH))),
  };
}

function tileLabel(col: number, row: number, cols: number, rows: number): string {
  const v = rows === 1 ? '' : row === 0 ? 'top' : row === rows - 1 ? 'bottom' : `row ${row + 1}`;
  const h = cols === 1 ? '' : col === 0 ? 'left' : col === cols - 1 ? 'right' : `column ${col + 1}`;
  return [v, h].filter(Boolean).join('-') || 'full page';
}

async function renderRegion(
  page: PdfJsPage,
  region: { x: number; y: number; w: number; h: number }, // viewport points (top-left origin)
  longPx: number,
  quality: number
): Promise<Buffer> {
  const scale = Math.min(3, longPx / Math.max(region.w, region.h));
  const viewport = page.getViewport({ scale, offsetX: -region.x * scale, offsetY: -region.y * scale });
  const canvas = createCanvas(Math.max(1, Math.round(region.w * scale)), Math.max(1, Math.round(region.h * scale)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as any, canvasContext: ctx as any, viewport }).promise;
  return Buffer.from(await canvas.encode('jpeg', quality));
}

type PositionedText = { str: string; x: number; y: number; eol: boolean };

async function pageText(page: PdfJsPage): Promise<PositionedText[]> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: PositionedText[] = [];
  for (const it of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
    if (typeof it.str !== 'string' || !it.transform) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    out.push({ str: it.str, x, y, eol: !!it.hasEOL });
  }
  return out;
}

function textIn(items: PositionedText[], r: { x: number; y: number; w: number; h: number }): string {
  let s = '';
  for (const it of items) {
    if (it.x < r.x || it.x > r.x + r.w || it.y < r.y || it.y > r.y + r.h) continue;
    s += it.str + (it.eol ? '\n' : ' ');
  }
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/**
 * Renders one page. Large pages (or a forced grid) become several tiles plus
 * an overview; normal pages become a single tile.
 */
export async function renderPage(
  doc: PdfJsDoc,
  pageNo: number,
  opts: { grid?: { cols: number; rows: number } } = {}
): Promise<RenderedPage> {
  const page = await doc.getPage(pageNo);
  try {
    const { width, height } = pageSize(page);
    const grid =
      opts.grid ?? (isLargeFormat(width, height) ? planGrid(width, height) : { cols: 1, rows: 1 });
    const texts = await pageText(page);
    const count = grid.cols * grid.rows;

    const tw = width / grid.cols;
    const th = height / grid.rows;
    const ox = count > 1 ? tw * OVERLAP : 0;
    const oy = count > 1 ? th * OVERLAP : 0;

    const tiles: Tile[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const x = Math.max(0, col * tw - ox);
        const y = Math.max(0, row * th - oy);
        const region = {
          x,
          y,
          w: Math.min(width, (col + 1) * tw + ox) - x,
          h: Math.min(height, (row + 1) * th + oy) - y,
        };
        tiles.push({
          image: await renderRegion(page, region, TILE_LONG_PX, 82),
          text: textIn(texts, region),
          index: tiles.length,
          count,
          label: tileLabel(col, row, grid.cols, grid.rows),
        });
      }
    }

    const overview =
      count > 1
        ? await renderRegion(page, { x: 0, y: 0, w: width, h: height }, OVERVIEW_LONG_PX, 60)
        : null;

    return { pageNo, overview, tiles };
  } finally {
    page.cleanup();
  }
}
