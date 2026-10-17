import { addMonths, billingDTO, billingSummary, parsePrice } from '../billing.js';

const DAY = 86_400_000;
const now = new Date('2026-10-17T12:00:00Z').getTime();
const inDays = (n: number) => new Date(now + n * DAY);

describe('billing', () => {
  it('reads a custom price, or nothing', () => {
    expect(parsePrice({ amount: '3500', currency: 'BDT', note: ' launch deal ' })).toEqual({ amount: 3500, currency: 'BDT', note: 'launch deal' });
    expect(parsePrice({ amount: 49.999, currency: 'USD' })).toEqual({ amount: 50, currency: 'USD' });
    expect(parsePrice({ amount: 0, currency: 'BDT' })).toBeUndefined();
    expect(parsePrice({ amount: 10, currency: 'EUR' })).toBeUndefined();
    expect(parsePrice({ amount: 'abc', currency: 'BDT' })).toBeUndefined();
    expect(parsePrice(null)).toBeUndefined();
  });

  it('the list price, and the custom one when agreed', () => {
    const list = billingSummary({ planInfo: { planId: 'p2_m' }, trialEndsAt: inDays(10) }, now);
    expect(list).toMatchObject({ plan: 'Pro', interval: 'month', price: { amount: 79, currency: 'USD' }, customPrice: null, status: 'trial', daysLeft: 10 });
    const custom = billingSummary(
      { planInfo: { planId: 'p1_y' }, billing: { customPrice: { amount: 20000, currency: 'BDT', setBy: 'x', at: new Date(now) } } },
      now
    );
    expect(custom).toMatchObject({ interval: 'year', listPrice: { amount: 290, currency: 'USD' }, price: { amount: 20000, currency: 'BDT' } });
  });

  it.each([
    [20, 'active'],
    [5, 'due'],
    [0, 'due'],
    [-1, 'overdue'],
  ])('paid until %p days from now → %p', (days, status) => {
    expect(billingSummary({ planInfo: { planId: 'p1_m' }, trialEndsAt: inDays(-60), billing: { paidUntil: inDays(days) } }, now).status).toBe(status);
  });

  it('a trial that ended without a payment is overdue', () => {
    expect(billingSummary({ planInfo: { planId: 'p1_m' }, trialEndsAt: inDays(-2) }, now)).toMatchObject({ status: 'overdue', daysLeft: -2 });
  });

  it('sends ISO dates', () => {
    const d = billingDTO({ planInfo: { planId: 'p1_m' }, billing: { paidUntil: inDays(3) } }, now);
    expect(d.paidUntil).toBe(inDays(3).toISOString());
    expect(d.expiresAt).toBe(inDays(3).toISOString());
  });

  it('a month on', () => {
    expect(addMonths(new Date('2026-10-17T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-11-17');
  });
});
