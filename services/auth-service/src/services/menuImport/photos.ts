/**
 * Menu photos (JPG / PNG / WebP) → images ready for the vision model.
 *
 *  - fixes phone rotation (EXIF orientation)
 *  - caps size: a 12 MP photo costs more but reads no better than ~2400 px
 *  - cuts dense photos (wall menu boards) into overlapping tiles when a single
 *    read overflows the model's response — same approach as poster PDFs
 */
import sharp from 'sharp';
import type { RenderedPage, Tile } from './raster.js';

export type PhotoKind = 'jpeg' | 'png' | 'webp' | 'heic';

const SINGLE_LONG_PX = 2400;
const TILE_LONG_PX = 2000;
const OVERVIEW_LONG_PX = 1024;
const OVERLAP = 0.06;

/** Detects the image type from its first bytes (never trust the file name). */
export function sniffPhoto(buf: Buffer): PhotoKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

/** Upright JPEG, at most `longPx` on its longest side. */
async function toJpeg(input: Buffer | sharp.Sharp, longPx: number, quality: number): Promise<Buffer> {
  const img = Buffer.isBuffer(input) ? sharp(input) : input;
  return img
    .resize({ width: longPx, height: longPx, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // transparent PNGs → white, not black
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

/** Throws if the photo can't be decoded (corrupt / unsupported). */
export async function inspectPhoto(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('Unreadable image');
  // EXIF orientations 5–8 swap width and height
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/**
 * Prepares one menu photo. Without a grid it becomes a single image; with a
 * grid it is cut into overlapping tiles plus a low-res overview.
 */
export async function preparePhoto(
  buf: Buffer,
  photoNo: number,
  opts: { grid?: { cols: number; rows: number } } = {}
): Promise<RenderedPage> {
  // Upright copy at full resolution (bounded, so huge scans don't exhaust memory)
  const { data: upright, info } = await sharp(buf)
    .rotate()
    .resize({ width: 6000, height: 6000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });

  const grid = opts.grid ?? { cols: 1, rows: 1 };
  const count = grid.cols * grid.rows;

  if (count === 1) {
    const tile: Tile = {
      image: await toJpeg(upright, SINGLE_LONG_PX, 85),
      text: '',
      index: 0,
      count: 1,
      label: 'full page',
    };
    return { pageNo: photoNo, overview: null, tiles: [tile] };
  }

  const W = info.width;
  const H = info.height;
  const tw = W / grid.cols;
  const th = H / grid.rows;
  const ox = tw * OVERLAP;
  const oy = th * OVERLAP;

  const tiles: Tile[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const left = Math.max(0, Math.floor(col * tw - ox));
      const top = Math.max(0, Math.floor(row * th - oy));
      const width = Math.min(W, Math.ceil((col + 1) * tw + ox)) - left;
      const height = Math.min(H, Math.ceil((row + 1) * th + oy)) - top;
      const v = grid.rows === 1 ? '' : row === 0 ? 'top' : row === grid.rows - 1 ? 'bottom' : `row ${row + 1}`;
      const h = grid.cols === 1 ? '' : col === 0 ? 'left' : col === grid.cols - 1 ? 'right' : `column ${col + 1}`;
      tiles.push({
        image: await toJpeg(sharp(upright).extract({ left, top, width, height }), TILE_LONG_PX, 85),
        text: '',
        index: tiles.length,
        count,
        label: [v, h].filter(Boolean).join('-'),
      });
    }
  }

  return { pageNo: photoNo, overview: await toJpeg(upright, OVERVIEW_LONG_PX, 60), tiles };
}

/** 2×2 for portrait/square photos, 3×2 for wide boards. */
export function photoGrid(width: number, height: number): { cols: number; rows: number } {
  return width > height * 1.4 ? { cols: 3, rows: 2 } : { cols: 2, rows: 2 };
}
