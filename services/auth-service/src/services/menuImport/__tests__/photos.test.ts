import sharp from 'sharp';
import { inspectPhoto, photoGrid, preparePhoto, sniffPhoto } from '../photos.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#ffffff' } });

describe('menu photos', () => {
  it('detects image types from content, not the file name', async () => {
    expect(sniffPhoto(await solid(10, 10).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffPhoto(await solid(10, 10).png().toBuffer())).toBe('png');
    expect(sniffPhoto(await solid(10, 10).webp().toBuffer())).toBe('webp');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    expect(sniffPhoto(heic)).toBe('heic');
    expect(sniffPhoto(Buffer.from('%PDF-1.7 not an image'))).toBeNull();
  });

  it('honours phone rotation (EXIF) when reporting size', async () => {
    const sideways = await solid(4000, 3000).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await inspectPhoto(sideways)).toEqual({ width: 3000, height: 4000 });
  });

  it('turns a big phone photo into one upright, capped JPEG', async () => {
    const sideways = await solid(4000, 3000).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await preparePhoto(sideways, 1);
    expect(out.overview).toBeNull();
    expect(out.tiles).toHaveLength(1);
    const meta = await sharp(out.tiles[0].image).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.height).toBe(2400); // portrait after rotation, capped
    expect(meta.width).toBe(1800);
  });

  it('cuts a dense photo into overlapping tiles with an overview', async () => {
    const board = await solid(4800, 2400).png().toBuffer();
    const grid = photoGrid(4800, 2400);
    expect(grid).toEqual({ cols: 3, rows: 2 }); // wide menu board
    const out = await preparePhoto(board, 2, { grid });
    expect(out.pageNo).toBe(2);
    expect(out.tiles.map((t) => t.label)).toEqual([
      'top-left',
      'top-column 2',
      'top-right',
      'bottom-left',
      'bottom-column 2',
      'bottom-right',
    ]);
    const first = await sharp(out.tiles[0].image).metadata();
    // 1600×1200 cell + 6% overlap on the inner edges
    expect(first.width).toBe(Math.ceil(1600 + 96));
    expect(first.height).toBe(Math.ceil(1200 + 72));
    expect((await sharp(out.overview!).metadata()).width).toBe(1024);
  });

  it('uses a 2×2 grid for portrait pages', () => {
    expect(photoGrid(3000, 4000)).toEqual({ cols: 2, rows: 2 });
  });
});
