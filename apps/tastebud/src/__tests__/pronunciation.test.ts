// Learned pronunciations: the voice is fed the respelling, word events map back to what the screen shows.
import { forSpeech, fromSpeech, setPronunciations, speechPlan, wordToShow } from '../state/speechWords';

afterEach(() => setPronunciations([]));

describe('learned pronunciations', () => {
  it('a Bangla word is said the taught way, whole words only', () => {
    setPronunciations([{ word: 'ষোল', spoken: 'শোলো' }]);
    expect(forSpeech('ষোল আনা বাঙালি')).toBe('শোলো আনা বাঙালি');
    expect(forSpeech('ষোলজন')).toBe('ষোলজন'); // part of another word: untouched
    expect(fromSpeech('শোলো')).toBe('ষোল'); // the screen keeps the normal spelling
  });

  it('an English-letter word matches whatever its capitals; longer phrases first', () => {
    setPronunciations([
      { word: 'Sholo', spoken: 'শোলো' },
      { word: 'Sholo Aana', spoken: 'শোলো আনা' },
    ]);
    expect(forSpeech('Welcome to SHOLO aana!')).toBe('Welcome to শোলো আনা!');
    expect(forSpeech('sholo')).toBe('শোলো');
  });

  it('one written word said as several shows once, as written — by position (sholoaanabangali)', () => {
    setPronunciations([{ word: 'ষোলআনা', spoken: 'শোলো আনা' }]);
    const text = 'আমাদের রেস্টুরেন্টের নাম "ষোলআনা বাঙালি"। আনা দিন।';
    const plan = speechPlan(text);
    expect(plan.spoken).toBe('আমাদের রেস্টুরেন্টের নাম "শোলো আনা বাঙালি"। আনা দিন।');
    // the voice's word events (word, position in the spoken text) → what the screen shows
    const shown = plan.spoken
      .split(/(?<=\s)|(?=\s)/)
      .reduce<{ at: number; out: string[] }>(
        (acc, w) => {
          const word = w.trim();
          if (word) {
            const at = plan.spoken.indexOf(word, acc.at);
            const s = wordToShow(plan, word, at);
            if (s) acc.out.push(s);
            acc.at = at + word.length;
          }
          return acc;
        },
        { at: 0, out: [] }
      ).out;
    expect(shown.join(' ')).toBe('আমাদের রেস্টুরেন্টের নাম "ষোলআনা বাঙালি"। আনা দিন।');
    expect(shown).not.toContain('শোলো');
    expect(shown.filter((w) => w === 'আনা')).toHaveLength(1); // only the real "আনা" later on
  });

  it('the built-in fixes still apply', () => {
    expect(forSpeech('স্বাগতম')).toBe('স্বাগোতম');
  });
});
