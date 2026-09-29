import {
  DEFAULT_SERVICE_PERIODS,
  isWithinDates,
  normalizeDate,
  normalizeServicePeriods,
  orderableNow,
  resolveWindows,
  tenantServicePeriods,
  zonedDate,
} from '../availability.js';

describe('service periods', () => {
  it('defaults until the owner edits them', () => {
    expect(tenantServicePeriods(null).map((p) => p.name)).toEqual([
      'Breakfast',
      'Lunch',
      'Afternoon',
      'Dinner',
      'Late night',
    ]);
    expect(tenantServicePeriods({ servicePeriods: [] })).toEqual([]); // owner removed them all
  });

  it('normalizes: keeps ids stable, makes new ids from names, drops invalid', () => {
    expect(
      normalizeServicePeriods([
        { id: 'breakfast', name: ' Breakfast ', days: [1, 2, 3, 4, 5], start: '7:00', end: '10:30' },
        { name: 'Iftar', start: '18:00', end: '20:00' },
        { name: 'Iftar', start: '18:30', end: '20:30' },
        { name: 'Broken', start: '25:00', end: '20:00' },
        { name: '', start: '10:00', end: '11:00' },
      ])
    ).toEqual([
      { id: 'breakfast', name: 'Breakfast', days: [1, 2, 3, 4, 5], start: '07:00', end: '10:30' },
      { id: 'iftar', name: 'Iftar', days: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '20:00' },
      { id: 'iftar-2', name: 'Iftar', days: [0, 1, 2, 3, 4, 5, 6], start: '18:30', end: '20:30' },
    ]);
  });

  it('resolves period references + custom times; deleted periods are ignored', () => {
    const custom = [{ days: [5], start: '12:00', end: '15:00' }];
    expect(resolveWindows(['breakfast', 'gone'], custom, DEFAULT_SERVICE_PERIODS)).toEqual([
      { days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '11:00' },
      ...custom,
    ]);
    expect(resolveWindows([], [], DEFAULT_SERVICE_PERIODS)).toEqual([]);
  });

  it('follows a changed period time everywhere it is used', () => {
    const edited = normalizeServicePeriods([{ id: 'breakfast', name: 'Breakfast', start: '07:00', end: '10:30' }]);
    expect(resolveWindows(['breakfast'], [], edited)[0].end).toBe('10:30');
  });
});

describe('date ranges', () => {
  it('validates dates', () => {
    expect(normalizeDate('2026-10-03')).toBe('2026-10-03');
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('3 Oct')).toBeNull();
  });

  it("uses the restaurant's date, not UTC's", () => {
    // 2026-10-02T20:00Z = 3 Oct 02:00 in Dhaka
    const at = new Date('2026-10-02T20:00:00Z');
    expect(zonedDate(at, 'Asia/Dhaka')).toBe('2026-10-03');
    expect(isWithinDates('2026-10-03', '2026-10-05', 'Asia/Dhaka', at)).toBe(true);
    expect(isWithinDates('2026-10-03', '2026-10-05', 'UTC', at)).toBe(false);
    expect(isWithinDates(null, '2026-10-01', 'Asia/Dhaka', at)).toBe(false);
    expect(isWithinDates(null, null, 'Asia/Dhaka', at)).toBe(true);
  });

  it('blocks ordering outside the dates', () => {
    const at = new Date('2026-10-10T06:00:00Z');
    expect(
      orderableNow({ tz: 'Asia/Dhaka', at, itemFrom: '2026-10-03', itemUntil: '2026-10-05' })
    ).toMatchObject({ ok: false, reason: 'dates' });
  });
});
