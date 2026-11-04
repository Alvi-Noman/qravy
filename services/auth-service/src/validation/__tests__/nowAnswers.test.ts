// The owner's "what can I eat now?" (Settings → What to eat now) as the admin saves it: real dishes, within limits.
import { tenantUpdateSchema } from '../schemas';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B1 = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('nowAnswers', () => {
  it('takes sentences of words and dishes, for any of the four times of day', () => {
    const got = tenantUpdateSchema.parse({
      nowAnswers: {
        lunch: { lines: [[{ t: 'text', v: 'এখন ' }, { t: 'dish', id: ID, backups: [B1], say: 'ভাত' }]] },
        night: null,
      },
    });
    expect(got.nowAnswers?.lunch?.lines[0][1]).toEqual({ t: 'dish', id: ID, backups: [B1], say: 'ভাত' });
    expect(got.nowAnswers?.night).toBeNull();
  });

  it('fills in a dish with no backups or way of saying it', () => {
    const got = tenantUpdateSchema.parse({ nowAnswers: { morning: { lines: [[{ t: 'dish', id: ID }]] } } });
    expect(got.nowAnswers?.morning?.lines[0][0]).toEqual({ t: 'dish', id: ID, backups: [], say: '' });
  });

  it('refuses what is not a dish, too many backups or too much', () => {
    const bad = (v: unknown) => tenantUpdateSchema.safeParse({ nowAnswers: { lunch: v } }).success;
    expect(bad({ lines: [[{ t: 'dish', id: 'not-an-id' }]] })).toBe(false);
    expect(bad({ lines: [[{ t: 'dish', id: ID, backups: [B1, B1, B1] }]] })).toBe(false);
    expect(bad({ lines: [[{ t: 'html', v: '<b>' }]] })).toBe(false);
    expect(bad({ lines: Array.from({ length: 9 }, () => [{ t: 'text', v: 'x' }]) })).toBe(false);
    expect(tenantUpdateSchema.safeParse({ nowAnswers: { brunch: { lines: [] } } }).success).toBe(true); // (unknown time: dropped)
    expect(tenantUpdateSchema.parse({ nowAnswers: { brunch: { lines: [] } } }).nowAnswers).toEqual({});
  });
});
