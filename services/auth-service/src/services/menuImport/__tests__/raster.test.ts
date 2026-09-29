import { PDFDocument, StandardFonts } from 'pdf-lib';
import { isLargeFormat, openForRender, planGrid, renderPage } from '../raster.js';

describe('menu import raster', () => {
  it('treats A4/Letter/tabloid as normal and posters as large', () => {
    expect(isLargeFormat(595, 842)).toBe(false); // A4
    expect(isLargeFormat(612, 792)).toBe(false); // Letter
    expect(isLargeFormat(842, 595)).toBe(false); // A4 landscape (tri-fold spread)
    expect(isLargeFormat(1191, 1684)).toBe(true); // A2 poster
    expect(isLargeFormat(2384, 1684)).toBe(true); // A1 landscape menu board
  });

  it('plans roughly A4-sized tiles, capped at 4×4', () => {
    expect(planGrid(595, 842)).toEqual({ cols: 1, rows: 1 });
    expect(planGrid(1684, 2384)).toEqual({ cols: 3, rows: 3 });
    expect(planGrid(10000, 10000)).toEqual({ cols: 4, rows: 4 });
  });

  it('cuts a poster into tiles, each with only its own text', async () => {
    const d = await PDFDocument.create();
    const font = await d.embedFont(StandardFonts.Helvetica);
    const page = d.addPage([1684, 1191]); // A2 landscape → 2×2 grid
    page.drawText('STARTERS', { x: 60, y: 1100, size: 36, font });
    page.drawText('Chicken Wings 350', { x: 60, y: 1040, size: 24, font });
    page.drawText('DRINKS', { x: 1000, y: 200, size: 36, font });
    page.drawText('Lemonade 120', { x: 1000, y: 140, size: 24, font });
    const doc = await openForRender(Buffer.from(await d.save()));
    try {
      const out = await renderPage(doc, 1);
      expect(out.tiles).toHaveLength(4);
      expect(out.overview).not.toBeNull();
      const byLabel = Object.fromEntries(out.tiles.map((t) => [t.label, t]));
      expect(byLabel['top-left'].text).toContain('Chicken Wings 350');
      expect(byLabel['top-left'].text).not.toContain('Lemonade');
      expect(byLabel['bottom-right'].text).toContain('Lemonade 120');
      for (const t of out.tiles) {
        expect(t.image.subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG
      }
    } finally {
      await doc.loadingTask.destroy();
    }
  }, 60_000);

  it('renders a normal page as a single tile without overview', async () => {
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    const doc = await openForRender(Buffer.from(await d.save()));
    try {
      const out = await renderPage(doc, 1);
      expect(out.tiles).toHaveLength(1);
      expect(out.tiles[0].label).toBe('full page');
      expect(out.overview).toBeNull();
    } finally {
      await doc.loadingTask.destroy();
    }
  }, 60_000);
});
