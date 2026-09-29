import { canTransition } from '../core.js';

describe('order status flow', () => {
  it('moves forward, allows skipping ahead, and cancels from any open state', () => {
    expect(canTransition('placed', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'completed')).toBe(true);
    expect(canTransition('placed', 'preparing')).toBe(true); // busy kitchen skips "accepted"
    expect(canTransition('preparing', 'cancelled')).toBe(true);
  });

  it('never goes backwards or reopens a finished order', () => {
    expect(canTransition('ready', 'preparing')).toBe(false);
    expect(canTransition('accepted', 'placed')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'placed')).toBe(false);
    expect(canTransition('placed', 'placed')).toBe(false);
  });
});
