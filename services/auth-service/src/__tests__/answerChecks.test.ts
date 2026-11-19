// Cortex "Flagged answers": which of the AI waiter's answers look wrong (services/cortex/answerChecks.ts).
import { checkVisit } from '../services/cortex/answerChecks.js';

let n = 0;
const turn = (text: string, reply: string, meta: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  _id: `t${n++}`,
  ts: new Date(2026, 10, 18, 12, n),
  text,
  ai: { replyText: reply, meta: { language: 'bn', ...meta } },
  ...extra,
});
const codes = (turns: ReturnType<typeof turn>[]) => checkVisit(turns).map((fs) => fs.map((f) => f.code));

describe('checkVisit', () => {
  it('a normal order is not flagged', () => {
    expect(
      codes([
        turn('একটা চিকেন বার্গার দেন', 'একটা চিকেন বার্গার যোগ করা হয়েছে।', { cartOps: [{ op: 'add', name: 'Chicken Burger', quantity: 1 }] }),
        turn('আর কিছু না', 'ঠিক আছে! অর্ডার কনফার্ম করবেন?'),
      ])
    ).toEqual([[], []]);
  });

  it('says it added, but the tray did not change', () => {
    expect(codes([turn('একটা কোক', 'একটা কোক যোগ করা হয়েছে।')])[0]).toContain('claimed_added');
  });

  it('an offer ending in "?" is not a claim', () => {
    expect(codes([turn('কোক আছে?', 'হ্যাঁ, কোক আছে ৳৬০। যোগ করে দিই?')])[0]).toEqual([]);
  });

  it('both spellings of য় match (one code point, or য + nukta)', () => {
    expect(codes([turn('একটা কোক', 'একটা কোক যোগ করা হয়েছে।')])[0]).toContain('claimed_added');
    expect(codes([turn('একটা কোক', 'একটা কোক যোগ করা হয়েছে।')])[0]).toContain('claimed_added');
  });

  it('the guest pushes back on the next turn → the answer before is flagged', () => {
    const c = codes([
      turn('দুইটা বার্গার', 'একটা বার্গার যোগ করা হয়েছে।', { cartOps: [{ op: 'add', name: 'Burger', quantity: 1 }] }),
      turn('না না দুইটা বললাম', 'দুঃখিত, দুইটা করে দিলাম।', { cartOps: [{ op: 'set', name: 'Burger', quantity: 2 }] }),
    ]);
    expect(c[0]).toContain('guest_pushed_back');
    expect(c[1]).not.toContain('guest_pushed_back');
  });

  it('"এটা না" with nothing after it is pushback; a bare "না" is not', () => {
    expect(codes([turn('বিফ বার্গার', 'চিকেন বার্গার যোগ করব?'), turn('এটা না', 'ঠিক আছে।')])[0]).toContain('guest_pushed_back');
    expect(codes([turn('আর কিছু?', 'আর কিছু লাগবে?'), turn('না, আর কিছু লাগবে না', 'ঠিক আছে।')])[0]).toEqual([]);
  });

  it('the guest says the same thing again', () => {
    expect(codes([turn('ঝাল কম হবে এমন কিছু আছে', 'আমাদের স্পেশাল ট্রিপল চিজ টাওয়ার।'), turn('ঝাল কম হবে এমন কিছু আছে?', 'হ্যাঁ, ...')])[0]).toContain(
      'guest_repeated'
    );
    // "হ্যাঁ" twice is just answering two questions
    expect(codes([turn('হ্যাঁ', 'বড়টা দিই?'), turn('হ্যাঁ', 'ঠিক আছে।')])[0]).toEqual([]);
  });

  it('wrong language', () => {
    expect(codes([turn('কি কি আছে', 'We have burgers, wings and fries today.')])[0]).toContain('wrong_language');
    expect(codes([turn('what do you have', 'আমাদের বার্গার, উইংস আর ফ্রাইজ আছে, সবগুলোই খুব জনপ্রিয় আজকে।', { language: 'en' })])[0]).toContain(
      'wrong_language'
    );
  });

  it('model down / trouble / "didn’t hear" when it did', () => {
    expect(codes([turn('বার্গার', '', { fallback: true })])[0]).toEqual(['model_down']);
    expect(codes([turn('বার্গার', 'দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?')])[0]).toContain('trouble_reply');
    expect(codes([turn('বার্গার', 'দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?', { fallback: true })])[0]).toEqual(['model_down']);
    expect(codes([turn('বার্গার', 'দুঃখিত, শুনতে পাইনি। আবার বলবেন কি?')])[0]).toContain('said_didnt_hear');
  });

  it('an outage is one finding — the guest repeating after "say it again?" is not another', () => {
    const r = 'দুঃখিত, একটু সমস্যা হচ্ছে। আবার বলবেন কি?';
    const c = codes([turn('এখন কী খেতে পারি?', r, { fallback: true }), turn('এখন কী খেতে পারি?', r, { fallback: true })]);
    expect(c[0]).toEqual(['model_down']);
    expect(c[1]).toEqual(['model_down']);
  });

  it('"বুঝতে পারিনি" to garbled words is the right answer, not "didn’t hear"', () => {
    expect(codes([turn('কান্তে যোগুলো হবে গরেছে কই', 'দুঃখিত, ঠিক বুঝতে পারিনি। আরেকবার বলবেন?', { guards: ['not_understood'] })])[0]).toEqual([
      'not_understood',
    ]);
  });

  it('a turn the waiter could not hear is not judged', () => {
    expect(codes([turn('', 'দুঃখিত, শুনতে পাইনি।', {}, { status: 'unheard' })])[0]).toEqual([]);
  });

  it('safety net caught the model; routine guards are ignored', () => {
    const fs = checkVisit([turn('কোক', 'কোক যোগ করব?', { guards: ['false_added_claim_replaced', 'list_as_cards'] })])[0];
    expect(fs).toEqual([{ code: 'caught', severity: 'caught', label: expect.any(String), detail: 'false_added_claim_replaced' }]);
  });

  it('added, then removed right after', () => {
    const c = codes([
      turn('উইংস', 'হট উইংস যোগ করা হয়েছে।', { cartOps: [{ op: 'add', name: 'Hot Wings', quantity: 1 }] }),
      turn('উইংস বাদ দেন', 'হট উইংস বাদ দিলাম।', { cartOps: [{ op: 'remove', name: 'Hot Wings' }] }),
    ]);
    expect(c[0]).toContain('removed_right_after');
  });

  it('same answer twice in a row', () => {
    const r = 'আমাদের স্পেশাল হলো ট্রিপল চিজ টাওয়ার আর হট উইংস।';
    expect(codes([turn('কি ভালো', r), turn('আর কি আছে', r)])[1]).toContain('same_reply_twice');
  });
});
