// Ember: "when is it back?" in Bangla / English, and the visit summary (what this guest already ordered).
jest.mock('../api/storefront', () => ({}));
jest.mock('../themes/ember/store', () => ({ useLiveOrders: () => ({ all: [], active: [] }) }));

import { clockText, whenText, bnDigits } from '../themes/ember/when';
import { visitOf } from '../themes/ember/visit';

describe('when it opens', () => {
  it('names the part of the day in Bangla', () => {
    expect(clockText('08:00', 'bn')).toBe('সকাল ৮টা');
    expect(clockText('13:30', 'bn')).toBe('দুপুর ১:৩০');
    expect(clockText('16:00', 'bn')).toBe('বিকেল ৪টা');
    expect(clockText('18:00', 'bn')).toBe('সন্ধ্যা ৬টা');
    expect(clockText('21:00', 'bn')).toBe('রাত ৯টা');
    expect(clockText('18:00', 'en')).toBe('6 PM');
    expect(clockText('07:15', 'en')).toBe('7:15 AM');
  });
  it('later today, tomorrow, or the day', () => {
    expect(whenText({ offset: 0, day: 2, start: '18:00' }, 'bn')).toBe('সন্ধ্যা ৬টা');
    expect(whenText({ offset: 1, day: 3, start: '08:00' }, 'bn')).toBe('কাল সকাল ৮টা');
    expect(whenText({ offset: 3, day: 5, start: '12:00' }, 'bn')).toBe('শুক্রবার দুপুর ১২টা');
    expect(whenText({ offset: 1, day: 3, start: '08:00' }, 'en')).toBe('tomorrow 8 AM');
  });
  it('Bangla digits', () => {
    expect(bnDigits(2024)).toBe('২০২৪');
  });
});

describe('visitOf', () => {
  const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
  const order = (token: string, status: any, minAgo: number, items: Array<[string, number]>) =>
    ({
      token,
      orderNumber: 1,
      status,
      statusHistory: [{ status: 'placed', at: at(minAgo) }],
      table: '12',
      items: items.map(([itemId, qty]) => ({ itemId, name: itemId, qty, modifiers: [], unitPrice: 100, lineTotal: 100 * qty })),
      subtotal: 0,
      total: 0,
      currency: 'BDT',
      payment: { method: 'counter', status: 'unpaid' },
    }) as any;

  it('counts every dish this visit; on its way = not served yet; cancelled and old orders left out', () => {
    const v = visitOf([
      order('a', 'completed', 60, [['wings', 2]]),
      order('b', 'preparing', 5, [['wings', 1], ['shake', 1]]),
      order('c', 'cancelled', 3, [['fries', 1]]),
      order('d', 'completed', 6 * 60, [['old', 1]]),
    ]);
    expect(v.ordered).toEqual({ wings: 3, shake: 1 });
    expect(Object.keys(v.onTheWay).sort()).toEqual(['shake', 'wings']);
    expect(v.orders.map((o) => o.token)).toEqual(['a', 'b']);
  });
});
