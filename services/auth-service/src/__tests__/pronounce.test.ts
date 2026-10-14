// "Say it like" in English letters → the Bangla spelling the voice reads that way.
import { cleanList, toSpoken } from '../utils/pronounce.js';

describe('toSpoken', () => {
  it('says every vowel typed — "sholo" ends in "lo", "shol" does not', () => {
    expect(toSpoken('sholo')).toBe('শোলো');
    expect(toSpoken('shol')).toBe('শোল্');
  });

  it('a doubled h adds nothing — "shholo" is "sholo"', () => {
    expect(toSpoken('shholo aana')).toBe('শোলো আনা');
    expect(toSpoken('khhichuri')).toBe('খিচুরি');
  });

  it('spells common Bangla words the way they are typed', () => {
    expect(toSpoken('kacchi')).toBe('কাচ্চি');
    expect(toSpoken('borhani')).toBe('বোর্হানি');
    expect(toSpoken('biriyani')).toBe('বিরিয়ানি');
    expect(toSpoken('bangali')).toBe('বাঙালি');
    expect(toSpoken('mitu')).toBe('মিতু');
    expect(toSpoken('jhal')).toBe('ঝাল্');
    expect(toSpoken('shagotom')).toBe('শাগোতোম্');
    expect(toSpoken('aana')).toBe('আনা');
  });

  it('capitals for the hard sounds; several words; Bangla kept as it is', () => {
    expect(toSpoken('Tehari')).toBe('টেহারি');
    expect(toSpoken('tehari')).toBe('তেহারি');
    expect(toSpoken('sholo aana bangali')).toBe('শোলো আনা বাঙালি');
    expect(toSpoken('ষোলো')).toBe('ষোলো');
    expect(toSpoken('  ')).toBe('');
  });
});

describe('cleanList', () => {
  it('trims, drops empty rows, keeps one entry per word', () => {
    expect(
      cleanList([
        { word: ' ষোল ', sayAs: 'sholo' },
        { word: '', sayAs: 'x' },
        { word: 'ষোল', sayAs: 'sholo' },
        { word: 'Mitu', sayAs: '' },
      ])
    ).toEqual([{ word: 'ষোল', sayAs: 'sholo', spoken: 'শোলো' }]);
  });
});
