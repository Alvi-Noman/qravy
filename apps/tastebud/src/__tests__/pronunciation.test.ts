// Learned pronunciations: the voice is fed the respelling, word events map back to what the screen shows.
import { forSpeech, fromSpeech, setPronunciations } from '../state/speechWords';

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

  it('the built-in fixes still apply', () => {
    expect(forSpeech('স্বাগতম')).toBe('স্বাগোতম');
  });
});
