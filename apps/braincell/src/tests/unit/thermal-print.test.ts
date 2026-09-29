import { describe, it, expect, beforeEach } from 'vitest';
import { buildTicketHtml, loadPrintSettings, savePrintSettings } from '../../utils/thermalPrint';
import type { AdminOrder } from '../../api/orders';

const order: AdminOrder = {
  id: 'o1',
  orderNumber: 7,
  status: 'placed',
  statusHistory: [{ status: 'placed', at: '2026-09-29T04:44:08.000Z' }],
  table: '12',
  items: [
    {
      itemId: 'kb',
      name: 'Kacchi <Biryani>',
      qty: 2,
      variation: 'Full',
      modifiers: [{ groupName: 'Extras', name: 'Extra raita', price: 30 }],
      unitPrice: 810,
      lineTotal: 1620,
      notes: 'less spicy',
    },
    { itemId: 'w', name: 'Mineral Water', qty: 1, modifiers: [], unitPrice: 30, lineTotal: 30 },
  ],
  subtotal: 1650,
  total: 1650,
  currency: 'BDT',
  payment: { method: 'counter', status: 'unpaid' },
  notes: 'birthday table',
  source: 'ai-waiter',
  businessDay: '2026-09-29',
  eta: {
    prepMinutes: 14,
    queueMinutes: 0,
    promisedReadyAt: '2026-09-29T04:58:08.000Z',
    readyAt: '2026-09-29T04:58:08.000Z',
    minutesLeft: 14,
    late: false,
    adjustedMinutes: 0,
    serverNow: '2026-09-29T04:44:08.000Z',
  },
  createdAt: '2026-09-29T04:44:08.000Z',
  updatedAt: '2026-09-29T04:44:08.000Z',
};

describe('thermal tickets', () => {
  it('kitchen ticket: big order + table, items with choices and notes, due time — no prices', () => {
    const html = buildTicketHtml(order, { kind: 'kitchen', paper: '80', timezone: 'Asia/Dhaka' });
    expect(html).toContain('@page { size: 80mm auto; margin: 0; }');
    expect(html).toContain('#7');
    expect(html).toContain('TABLE 12');
    expect(html).toContain('Kacchi &lt;Biryani&gt;'); // escaped
    expect(html).toContain('+ Extra raita');
    expect(html).toContain('** less spicy **');
    expect(html).toContain('ORDER NOTE: birthday table');
    // not accepted yet: no due time, the clock starts on accept
    expect(html).not.toContain('Due');
    expect(html).toMatch(/Takes<\/span><b>~14 min/);
    const accepted = buildTicketHtml({ ...order, status: 'accepted' }, { kind: 'kitchen', paper: '80', timezone: 'Asia/Dhaka' });
    expect(accepted).toMatch(/Due<\/span><b>10:58/); // readyAt in the restaurant's time zone
    expect(html).not.toContain('৳');
    expect(html).toContain('3 items');
  });

  it('online delivery: DELIVERY instead of a table, name / phone / address, cash on delivery', () => {
    const delivery: AdminOrder = {
      ...order,
      channel: 'online',
      table: null,
      fulfillment: 'delivery',
      customer: { name: 'Rahim <R>', phone: '01711000000', address: 'House 5, Road 2, Dhanmondi' },
      payment: { method: 'cod', status: 'unpaid' },
    };
    const kitchen = buildTicketHtml(delivery, { kind: 'kitchen', paper: '80', timezone: 'Asia/Dhaka' });
    expect(kitchen).toContain('DELIVERY');
    expect(kitchen).not.toContain('TABLE');
    expect(kitchen).toContain('Rahim &lt;R&gt;');
    expect(kitchen).toContain('DELIVER TO: House 5, Road 2, Dhanmondi');
    const receipt = buildTicketHtml(delivery, { kind: 'receipt', paper: '80', timezone: 'Asia/Dhaka' });
    expect(receipt).toContain('01711000000');
    expect(receipt).toContain('Cash on delivery');
    expect(receipt).not.toContain('pay at the counter');

    const pickup = buildTicketHtml(
      { ...delivery, fulfillment: 'pickup', customer: { name: 'Rahim', phone: '01711000000' }, payment: { method: 'counter', status: 'unpaid' } },
      { kind: 'receipt', paper: '80', timezone: 'Asia/Dhaka' },
    );
    expect(pickup).toContain('Pickup');
    expect(pickup).toContain('Please pay on pickup');
    expect(pickup).not.toContain('DELIVER TO');
  });

  it('receipt: restaurant, prices, total, pay at the counter', () => {
    const html = buildTicketHtml(order, { kind: 'receipt', paper: '58', restaurant: 'Burger House', timezone: 'Asia/Dhaka' });
    expect(html).toContain('@page { size: 58mm auto; margin: 0; }');
    expect(html).toContain('width: 48mm');
    expect(html).toContain('Burger House');
    expect(html).toContain('2 × Kacchi &lt;Biryani&gt;');
    expect(html).toContain('৳1,620');
    expect(html).toContain('@ ৳810');
    expect(html).toContain('TOTAL</span><span>৳1,650');
    expect(html).toContain('Please pay at the counter');
    expect(buildTicketHtml({ ...order, payment: { method: 'counter', status: 'paid' } }, { kind: 'receipt', paper: '80' })).toContain('PAID');
  });

  it('marks reprints', () => {
    expect(buildTicketHtml(order, { kind: 'kitchen', paper: '80', reprint: true })).toContain('KITCHEN · REPRINT');
    expect(buildTicketHtml(order, { kind: 'receipt', paper: '80', reprint: true })).toContain('RECEIPT · COPY');
  });
});

describe('print settings (per device)', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to 80 mm without auto-print, and remembers changes', () => {
    expect(loadPrintSettings()).toEqual({ paper: '80', autoPrint: false, autoPrintReceipt: false });
    savePrintSettings({ paper: '58', autoPrint: true, autoPrintReceipt: false });
    expect(loadPrintSettings()).toEqual({ paper: '58', autoPrint: true, autoPrintReceipt: false });
  });
});
