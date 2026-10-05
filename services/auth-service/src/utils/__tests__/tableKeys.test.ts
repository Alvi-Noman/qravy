import { missingTableKeys, newTableKey, tableKeyMatches, tableKeysFor } from '../tableKeys.js';

describe('table QR keys', () => {
  it('makes short keys without look-alike characters', () => {
    for (let i = 0; i < 50; i++) expect(newTableKey()).toMatch(/^[a-km-np-z2-9]{8}$/);
  });

  it('keeps a table key when tables are saved again, and drops removed tables', () => {
    const first = tableKeysFor(['1', '2']);
    const again = tableKeysFor(['2', '3'], first);
    expect(again['2']).toBe(first['2']); // its printed QR code stays valid
    expect(again['3']).toHaveLength(8);
    expect(again['1']).toBeUndefined();
  });

  it('notices tables saved before keys existed', () => {
    expect(missingTableKeys(['1', '2'], { '1': 'abcdefgh' })).toBe(true);
    expect(missingTableKeys(['1'], { '1': 'abcdefgh' })).toBe(false);
    expect(missingTableKeys([], null)).toBe(false);
  });

  it('matches only the right key for the right table', () => {
    const keys = { '12': 'x7f2ab9q', A4: 'mmmmmmmm' };
    expect(tableKeyMatches(keys, '12', 'x7f2ab9q')).toBe(true);
    expect(tableKeyMatches(keys, '#12', 'X7F2AB9Q')).toBe(true);
    expect(tableKeyMatches(keys, 'a4', 'mmmmmmmm')).toBe(true);
    expect(tableKeyMatches(keys, '12', 'mmmmmmmm')).toBe(false); // another table's key
    expect(tableKeyMatches(keys, '12', '')).toBe(false); // typed table, no key
    expect(tableKeyMatches(keys, '12', null)).toBe(false);
    expect(tableKeyMatches(keys, '5', 'x7f2ab9q')).toBe(false); // table without a key
    expect(tableKeyMatches(null, '12', 'x7f2ab9q')).toBe(false);
  });
});
