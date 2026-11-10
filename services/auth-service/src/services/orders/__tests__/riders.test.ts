import { ObjectId } from 'mongodb';
import { tripChanges } from '../riders.js';

const now = new Date('2026-11-10T14:00:00Z');
const delivery = { riderId: new ObjectId(), name: 'Rakib', phone: '01711234567', assignedAt: new Date('2026-11-10T13:40:00Z') };
const order = (over: Record<string, unknown> = {}) =>
  ({ status: 'ready', total: 1080, payment: { method: 'cod', status: 'unpaid' }, delivery: { ...delivery }, ...over }) as any;

describe('a rider\'s taps', () => {
  it('picked up: the time, and ready if the kitchen had not marked it', () => {
    const c = tripChanges(order({ status: 'preparing' }), 'picked_up', { by: 'rider:Rakib' }, now)!;
    expect(c.set['delivery.pickedUpAt']).toEqual(now);
    expect(c.set.status).toBe('ready');
    expect(c.history).toEqual([{ status: 'ready', at: now, by: 'rider:Rakib' }]);
    // already ready: no status step
    expect(tripChanges(order(), 'picked_up', {}, now)!.history).toEqual([]);
  });

  it('delivered: completed, and the cash taken at the door for cash on delivery', () => {
    const c = tripChanges(order(), 'delivered', {}, now)!;
    expect(c.set.status).toBe('completed');
    expect(c.set['delivery.deliveredAt']).toEqual(now);
    expect(c.set['delivery.pickedUpAt']).toEqual(now); // (they forgot "Picked up")
    expect(c.set['delivery.cashCollected']).toBe(1080);
    expect(c.set['payment.status']).toBe('paid');
    expect(c.history.map((h) => h.status)).toEqual(['completed']);
  });

  it('a paid order: nothing to collect', () => {
    const c = tripChanges(order({ payment: { method: 'cod', status: 'paid' } }), 'delivered', {}, now)!;
    expect(c.set['delivery.cashCollected']).toBeUndefined();
  });

  it('delivered twice is nothing; nothing after cancel; nothing without a rider', () => {
    expect(tripChanges(order({ delivery: { ...delivery, deliveredAt: now } }), 'delivered', {}, now)).toBeNull();
    expect(() => tripChanges(order({ status: 'cancelled' }), 'picked_up', {}, now)).toThrow('cancelled');
    expect(() => tripChanges(order({ delivery: null }), 'picked_up', {}, now)).toThrow('No rider');
  });

  it("couldn't deliver: the reason and note, no status change", () => {
    const c = tripChanges(order(), 'problem', { reason: 'no-answer', note: 'Gate locked' }, now)!;
    expect(c.set['delivery.problem']).toEqual({ reason: 'no-answer', note: 'Gate locked', at: now });
    expect(c.set.status).toBeUndefined();
  });
});
