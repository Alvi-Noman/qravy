import {
  busyLevel,
  clampPrep,
  dishMinutes,
  dishRange,
  estimate,
  kitchenSettings,
  lineMinutes,
  minutesLeft,
  orderPrepMinutes,
  queueMinutes,
} from '../waitTime.js';
import { adjustEta, retime } from '../core.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

// Shared vectors — services/ai-waiter-service/tests/test_wait_time.py checks the same numbers.
describe('wait time: dishes and lines', () => {
  it('uses the size time, then the item time, then the restaurant default', () => {
    const pizza = { prepMinutes: 15, variations: [{ name: 'Small' }, { name: 'Large', prepMinutes: 22 }] };
    expect(dishMinutes(pizza, 'Large')).toEqual({ minutes: 22, estimated: false });
    expect(dishMinutes(pizza, 'small')).toEqual({ minutes: 15, estimated: false });
    expect(dishMinutes({}, null, 12)).toEqual({ minutes: 12, estimated: true });
    expect(dishRange(pizza)).toEqual({ min: 15, max: 22 });
  });

  it('cleans prep minutes to whole minutes in 1..240', () => {
    expect(clampPrep(7.6)).toBe(8);
    expect(clampPrep('20')).toBe(20);
    expect(clampPrep(0)).toBeUndefined();
    expect(clampPrep(-3)).toBeUndefined();
    expect(clampPrep(999)).toBe(240);
    expect(clampPrep(null)).toBeUndefined();
  });

  it('adds ~20% per extra portion, never more than double', () => {
    expect(lineMinutes(20, 1)).toBe(20);
    expect(lineMinutes(20, 3)).toBe(28);
    expect(lineMinutes(10, 20)).toBe(20);
    expect(lineMinutes(2, 4)).toBe(4);
  });

  it('an order takes as long as its slowest dish plus a minute per extra dish (max 5)', () => {
    expect(orderPrepMinutes([])).toBe(0);
    expect(orderPrepMinutes([{ prepMinutes: 18, qty: 1 }])).toBe(18);
    expect(orderPrepMinutes([{ prepMinutes: 18, qty: 1 }, { prepMinutes: 3, qty: 2 }, { prepMinutes: 10, qty: 1 }])).toBe(20);
    const many = Array.from({ length: 9 }, () => ({ prepMinutes: 5, qty: 1 }));
    expect(orderPrepMinutes(many)).toBe(10);
  });
});

describe('wait time: the kitchen queue', () => {
  it('no wait while a station is free', () => {
    expect(queueMinutes([], 3, NOW)).toBe(0);
    expect(queueMinutes([{ status: 'placed', prepMinutes: 20 }, { status: 'accepted', prepMinutes: 10 }], 3, NOW)).toBe(0);
  });

  it('waits for the first station to free up when all are busy', () => {
    const ahead = [
      { status: 'preparing', prepMinutes: 20, readyAt: at(8) },
      { status: 'placed', prepMinutes: 15 },
      { status: 'accepted', prepMinutes: 12 },
    ];
    expect(queueMinutes(ahead, 3, NOW)).toBe(8);
    expect(queueMinutes(ahead, 2, NOW)).toBe(15); // 8 then 12 on one station, 15 on the other
    expect(queueMinutes(ahead, 1, NOW)).toBe(35);
  });

  it('ignores finished orders and overdue cooking time', () => {
    const ahead = [
      { status: 'ready', prepMinutes: 30 },
      { status: 'preparing', prepMinutes: 20, readyAt: at(-5) },
    ];
    expect(queueMinutes(ahead, 1, NOW)).toBe(0);
  });

  it('estimates queue + prep and flags defaulted dishes', () => {
    const e = estimate({
      lines: [
        { item: { prepMinutes: 18 }, qty: 2 },
        { item: {}, qty: 1 },
      ],
      ahead: [{ status: 'preparing', prepMinutes: 10, readyAt: at(6) }],
      settings: { defaultPrepMinutes: 15, parallelOrders: 1 },
      now: NOW,
    });
    expect(e).toMatchObject({ prepMinutes: 23, queueMinutes: 6, totalMinutes: 29, estimated: true });
    expect(e.readyAt.toISOString()).toBe(at(29).toISOString());
  });

  it('reads kitchen settings with safe defaults', () => {
    expect(kitchenSettings(null)).toEqual({ defaultPrepMinutes: 15, parallelOrders: 3 });
    expect(kitchenSettings({ kitchen: { defaultPrepMinutes: 12, parallelOrders: 5 } })).toEqual({
      defaultPrepMinutes: 12,
      parallelOrders: 5,
    });
    expect(kitchenSettings({ kitchen: { parallelOrders: 0 } }).parallelOrders).toBe(3);
  });

  it('describes how busy the kitchen is and counts minutes left', () => {
    expect(busyLevel(0)).toBe('quiet');
    expect(busyLevel(10)).toBe('normal');
    expect(busyLevel(25)).toBe('busy');
    expect(minutesLeft(at(4.2), NOW)).toBe(5);
    expect(minutesLeft(at(-3), NOW)).toBe(0);
  });
});

describe('wait time: an order over its life', () => {
  const eta = { prepMinutes: 18, queueMinutes: 6, promisedReadyAt: at(24), readyAt: at(24) };

  it('restarts the clock when cooking starts, and stops it when ready', () => {
    const later = at(10);
    expect(retime(eta, 'preparing', later)?.readyAt.toISOString()).toBe(at(28).toISOString());
    expect(retime(eta, 'ready', later)?.readyAt.toISOString()).toBe(later.toISOString());
    expect(retime(eta, 'accepted', later)).toBe(eta);
    expect(retime(undefined, 'preparing', later)).toBeUndefined();
  });

  it('keeps a staff delay when cooking starts', () => {
    const delayed = adjustEta(eta, 10, NOW);
    expect(delayed.readyAt.toISOString()).toBe(at(34).toISOString());
    expect(delayed.adjustedMinutes).toBe(10);
    expect(retime(delayed, 'preparing', at(5))?.readyAt.toISOString()).toBe(at(33).toISOString());
    expect(delayed.promisedReadyAt).toBe(eta.promisedReadyAt);
  });

  it('never moves the ready time into the past', () => {
    expect(adjustEta(eta, -60, NOW).readyAt.toISOString()).toBe(at(1).toISOString());
    // already late: +5 counts from now, not from the missed time
    expect(adjustEta({ ...eta, readyAt: at(-10) }, 5, NOW).readyAt.toISOString()).toBe(at(5).toISOString());
  });
});
