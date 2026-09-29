import { normalizeAvailability, normalizeTime } from '../availability.js';

describe('category availability', () => {
  it.each([
    ['7:00', '07:00'],
    ['07:30', '07:30'],
    ['7', '07:00'],
    ['24:00', '00:00'],
    ['25:00', null],
    ['7:65', null],
    ['7pm', null],
  ])('normalizeTime(%p) → %p', (input, expected) => {
    expect(normalizeTime(input)).toBe(expected);
  });

  it('cleans windows: dedupes days, defaults to every day, drops invalid ones', () => {
    expect(
      normalizeAvailability([
        { days: [5, 1, 1, 9], start: '7:00', end: '11:00' },
        { start: '17:00', end: '19:00' }, // no days → every day
        { days: [1], start: '10:00', end: '10:00' }, // zero-length
        { days: [], start: '10:00', end: '12:00' }, // no valid days
        { days: [1, 5], start: '07:00', end: '11:00' }, // duplicate of first
        { days: [5, 6], start: '22:00', end: '02:00' }, // past midnight is fine
      ])
    ).toEqual([
      { days: [1, 5], start: '07:00', end: '11:00' },
      { days: [0, 1, 2, 3, 4, 5, 6], start: '17:00', end: '19:00' },
      { days: [5, 6], start: '22:00', end: '02:00' },
    ]);
    expect(normalizeAvailability(undefined)).toEqual([]);
  });
});

import { isWithinWindows, nextWallClockTime, orderableNow, zonedParts, isValidTimeZone } from '../availability.js';

describe('time zones', () => {
  // 2026-09-28T02:30Z = Monday 08:30 in Dhaka (UTC+6)
  const at = new Date('2026-09-28T02:30:00Z');

  it('reads the wall clock in the restaurant time zone', () => {
    expect(zonedParts(at, 'Asia/Dhaka')).toMatchObject({ weekday: 1, minutes: 8 * 60 + 30 });
    expect(zonedParts(at, 'UTC')).toMatchObject({ weekday: 1, minutes: 2 * 60 + 30 });
    expect(isValidTimeZone('Asia/Dhaka')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });

  it('checks windows in that zone, not the server clock', () => {
    const breakfast = [{ days: [1, 2, 3, 4, 5], start: '07:00', end: '11:00' }];
    expect(isWithinWindows(breakfast, 'Asia/Dhaka', at)).toBe(true); // 08:30 Dhaka
    expect(isWithinWindows(breakfast, 'UTC', at)).toBe(false); // 02:30 UTC
    expect(isWithinWindows([], 'UTC', at)).toBe(true);
  });

  it('finds the next daily reset time (e.g. 05:00 Dhaka)', () => {
    // 08:30 Dhaka Monday → next 05:00 is Tuesday 05:00 Dhaka = Monday 23:00Z
    expect(nextWallClockTime('05:00', 'Asia/Dhaka', at).toISOString()).toBe('2026-09-28T23:00:00.000Z');
    // 04:00 Dhaka → later the same day
    expect(nextWallClockTime('05:00', 'Asia/Dhaka', new Date('2026-09-27T22:00:00Z')).toISOString()).toBe(
      '2026-09-27T23:00:00.000Z'
    );
    // Daylight saving: New York on 2026-11-01 (fall back) — 05:00 EST = 10:00Z
    expect(nextWallClockTime('05:00', 'America/New_York', new Date('2026-11-01T06:30:00Z')).toISOString()).toBe(
      '2026-11-01T10:00:00.000Z'
    );
  });

  it('explains why something cannot be ordered', () => {
    const tz = 'Asia/Dhaka';
    const open = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '23:00' }];
    expect(orderableNow({ tz, at, openingHours: open })).toMatchObject({ ok: false, reason: 'closed' });
    const noon = new Date('2026-09-28T06:00:00Z'); // 12:00 Dhaka
    expect(orderableNow({ tz, at: noon, openingHours: open })).toEqual({ ok: true });
    expect(
      orderableNow({
        tz,
        at: noon,
        openingHours: open,
        categoryHours: [{ days: [1], start: '07:00', end: '11:00' }],
        categoryName: 'Breakfast',
      })
    ).toMatchObject({ ok: false, reason: 'category', message: 'Breakfast is not being served right now.' });
    expect(
      orderableNow({ tz, at: noon, itemHours: [{ days: [5], start: '12:00', end: '15:00' }] })
    ).toMatchObject({ ok: false, reason: 'item' });
  });
});
