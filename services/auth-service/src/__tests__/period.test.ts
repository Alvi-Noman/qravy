// "Today" is since midnight where the restaurant is — not the last 24 hours.
import { datesOf, localHourAndDate, periodOf } from '../utils/period.js';

const TZ = 'Asia/Dhaka'; // UTC+6
const NOW = new Date('2026-10-14T05:30:00Z'); // 11:30 in Dhaka

describe('periodOf', () => {
  it('today: from Dhaka midnight, by the hour, compared with yesterday', () => {
    const p = periodOf('today', null, null, TZ, NOW);
    expect(p.from.toISOString()).toBe('2026-10-13T18:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-14T18:00:00.000Z');
    expect(p.bucket).toBe('hour');
    expect(p.prevFrom.toISOString()).toBe('2026-10-12T18:00:00.000Z');
    expect(p.includesNow).toBe(true);
    expect([p.fromDate, p.toDate]).toEqual(['2026-10-14', '2026-10-14']);
  });

  it('just after midnight it is already the new day', () => {
    const p = periodOf('today', null, null, TZ, new Date('2026-10-13T18:05:00Z')); // 00:05 on the 14th
    expect(p.fromDate).toBe('2026-10-14');
  });

  it('yesterday, last 7 days, this month', () => {
    const y = periodOf('yesterday', null, null, TZ, NOW);
    expect([y.fromDate, y.toDate, y.includesNow]).toEqual(['2026-10-13', '2026-10-13', false]);
    const w = periodOf('7d', null, null, TZ, NOW);
    expect([w.fromDate, w.toDate, w.bucket]).toEqual(['2026-10-08', '2026-10-14', 'day']);
    expect(w.prevTo.getTime()).toBe(w.from.getTime());
    expect(w.to.getTime() - w.from.getTime()).toBe(w.prevTo.getTime() - w.prevFrom.getTime());
    const m = periodOf('month', null, null, TZ, NOW);
    expect([m.fromDate, m.toDate]).toEqual(['2026-10-01', '2026-10-14']);
  });

  it('custom: inclusive, in order, never past today, at most a year; nonsense falls back to today', () => {
    const c = periodOf('custom', '2026-10-10', '2026-10-01', TZ, NOW);
    expect([c.fromDate, c.toDate]).toEqual(['2026-10-01', '2026-10-10']);
    expect(datesOf(c)).toHaveLength(10);
    expect(periodOf('custom', '2026-10-01', '2026-12-31', TZ, NOW).toDate).toBe('2026-10-14');
    expect(periodOf('custom', '2020-01-01', '2026-10-14', TZ, NOW).fromDate).toBe('2025-10-14');
    expect(periodOf('custom', '2026-02-30', null, TZ, NOW).key).toBe('today');
    expect(periodOf('whatever', null, null, TZ, NOW).key).toBe('today');
  });

  it('buckets an instant in the restaurant’s own hour and date', () => {
    expect(localHourAndDate(new Date('2026-10-13T19:15:00Z'), TZ)).toEqual({ hour: 1, date: '2026-10-14' });
  });
});
