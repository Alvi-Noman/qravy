import { slugify, tableBook } from '../branches.js';
import { tableKeysFor } from '../tableKeys.js';

describe('branch links', () => {
  it('makes a link-safe slug from the branch name', () => {
    expect(slugify('Gulshan')).toBe('gulshan');
    expect(slugify('Gulshan 2 (Main)')).toBe('gulshan-2-main');
    expect(slugify('  Dhanmondi — Road 27 ')).toBe('dhanmondi-road-27');
    expect(slugify('Café Uttara')).toBe('cafe-uttara');
    expect(slugify('গুলশান')).toBe(''); // no latin letters → the caller falls back to "branch"
  });
});

describe('restaurant-wide tables (no branch)', () => {
  it('knows its tables and checks their QR keys', async () => {
    const tableKeys = tableKeysFor(['1', '2']);
    const book = await tableBook({ tables: ['1', '2'], tableKeys }, null);
    expect(book.knows('1')).toBe(true);
    expect(book.knows('#2')).toBe(true);
    expect(book.knows('9')).toBe(false);
    expect(book.verified('1', tableKeys['1'])).toBe(true);
    expect(book.verified('1', tableKeys['2'])).toBe(false); // another table's key
    expect(book.verified('1', null)).toBe(false); // typed, not scanned
  });

  it('takes any table when none are set up', async () => {
    const book = await tableBook({}, null);
    expect(book.knows('42')).toBe(true);
    expect(book.verified('42', null)).toBe(true); // nothing to check
  });
});
