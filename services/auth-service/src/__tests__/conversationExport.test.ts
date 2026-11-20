// Cortex "Export conversations": what the guest saw, as the storefront shows it (services/cortex/conversationExport.ts).
import { exportVisit, menuLines, toText } from '../services/cortex/conversationExport.js';

const at = (m: number) => new Date(Date.UTC(2026, 10, 18, 8, m));
const sugg = [
  { title: 'Hot Wings', itemId: 'w', price: 320, subtitle: 'our signature' },
  { title: 'Triple Cheese Tower', itemId: 't', price: 590 },
];

describe('exportVisit', () => {
  const turns = exportVisit([
    { ts: at(0), text: 'কি ভালো?', engine: 'deepgram', ai: { replyText: 'হট উইংস আর ট্রিপল চিজ টাওয়ার।', meta: { intent: 'suggestions', language: 'bn', suggestions: sugg, decision: { showSuggestionsModal: true } } } },
    { ts: at(1), text: 'কোনটা ঝাল?', ai: { replyText: 'হট উইংস ঝাল।', meta: { intent: 'menu', onScreen: true, highlight: ['w'] } } },
    {
      ts: at(2),
      text: 'একটা টাওয়ার দেন',
      engine: 'typed',
      ai: {
        replyText: 'একটা Triple Cheese Tower যোগ করা হয়েছে। সাথে ফ্রাইজ?',
        meta: {
          intent: 'order',
          cartOps: [{ op: 'add', name: 'Triple Cheese Tower', quantity: 1 }],
          traySubtotal: 590,
          upsell: [{ title: 'Fries', itemId: 'f', price: 120 }],
          decision: { showUpsellTray: true },
          suggestions: sugg, // (not shown: neither suggestions intent nor showSuggestionsModal)
        },
      },
    },
    { ts: at(3), text: 'হ্যাঁ অর্ডার করেন', ai: { replyText: 'অর্ডার হয়েছে!', meta: { decision: { orderPlaced: true }, order: { orderNumber: 42 } } } },
  ]);

  it('dish cards only when the storefront shows them', () => {
    expect(turns[0].screen.dishCards).toEqual([
      { name: 'Hot Wings', price: 320, note: 'our signature' },
      { name: 'Triple Cheese Tower', price: 590 },
    ]);
    expect(turns[2].screen.dishCards).toBeNull();
  });

  it('cards kept on screen, with the highlighted dish by name', () => {
    expect(turns[1].screen.keptCardsOnScreen).toBe(true);
    expect(turns[1].screen.highlighted).toEqual(['Hot Wings']);
  });

  it('upsell tray, cart change, tray total, order', () => {
    expect(turns[2].input).toBe('typed');
    expect(turns[2].screen.upsellTray).toEqual([{ name: 'Fries', price: 120 }]);
    expect(turns[2].cart).toMatchObject({ changes: ['add 1× Triple Cheese Tower'], trayTotalAfter: 590 });
    expect(turns[3].screen.orderPlaced).toBe(42);
  });

  it('an unheard turn says why; midnight is 00:00, not 24:00', () => {
    const [u] = exportVisit([
      {
        ts: new Date(Date.UTC(2026, 10, 18, 18, 0, 5)), // 00:00:05 in Dhaka
        text: '',
        status: 'unheard',
        ai: { replyText: 'দুঃখিত', meta: { guards: ['no-speech'], audioLevels: { ms: 2100, speechMs: 0, peakDb: -52.3, roomDb: -61 } } },
      },
    ]);
    expect(u.guest.notHeardWhy).toBe('clip 2.1 s · voice 0 ms · loudest -52.3 dB · room -61 dB');
    const txt = toText({ from: at(0), to: at(60), tz: 'Asia/Dhaka', menus: [], conversations: [
      { restaurant: 'R', subdomain: 'r', branch: null, channel: 'online', table: null, startedAt: u.at, endedAt: u.at, ordered: false, turns: [u] },
    ] });
    expect(txt).toContain('[00:00:05] GUEST (voice): (not heard — clip 2.1 s · voice 0 ms');
    expect(txt).toContain('2026-11-19, 00:00');
    expect(txt).not.toContain('24:00');
  });

  it('the readable file has the menu, the turns and what was shown', () => {
    const txt = toText({
      from: at(0),
      to: at(60),
      tz: 'Asia/Dhaka',
      menus: [{ restaurant: 'Burger House', subdomain: 'burger-house', lines: menuLines([{ name: 'Hot Wings', price: 320, categoryId: 'c', offline: true }], new Map([['c', 'Sides']])) }],
      conversations: [
        { restaurant: 'Burger House', subdomain: 'burger-house', branch: null, channel: 'dine-in', table: '4', startedAt: at(0).toISOString(), endedAt: at(3).toISOString(), ordered: true, turns },
      ],
    });
    expect(txt).toContain('- Hot Wings — 320 · sold out');
    expect(txt).toContain('CONVERSATION 1 · Burger House (burger-house) · dine-in table 4 · 2026-11-18, 14:00');
    expect(txt).toContain('SCREEN dish cards: Hot Wings 320 (our signature) | Triple Cheese Tower 590');
    expect(txt).toContain('SCREEN upsell tray: Fries 120');
    expect(txt).toContain('CART: add 1× Triple Cheese Tower');
    expect(txt).toContain('ORDER PLACED #42');
  });
});
