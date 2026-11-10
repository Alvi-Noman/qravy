// Ember's captions: said words white, words still to come dimmed, the menu's dish names amber; when finished, the
// first sentence white and the rest dimmed.
import { captionSpans, CAPTION_COLORS as C, sayingIndex } from '../themes/ember/captions';

const join = (spans: { text: string; color: string }[], color: string) =>
  spans.filter((s) => s.color === color).map((s) => s.text.trim()).join(' | ');

describe('captionSpans', () => {
  const dishes = ['Prawn Malai Curry', 'Garlic Naan', 'Naan'];

  it('colours the menu’s dish names amber, the first sentence white and the rest dimmed', () => {
    const s = captionSpans({ text: 'Try the Prawn Malai Curry. Gentle heat, and the chef’s favourite.', spoken: null, dishes });
    expect(join(s, C.amber)).toBe('Prawn Malai Curry.');
    expect(join(s, C.text)).toBe('Try the');
    expect(join(s, C.dim)).toBe('Gentle heat, and the chef’s favourite.');
  });

  it('keeps a dish amber even in the dimmed follow-up', () => {
    const s = captionSpans({ text: 'Got both. Want some garlic naan with that?', spoken: null, dishes });
    expect(join(s, C.amber)).toBe('garlic naan');
    expect(join(s, C.text)).toBe('Got both.');
  });

  it('while speaking: words said so far are bright, the rest dimmed (dishes too, until said)', () => {
    const s = captionSpans({ text: 'Try the Prawn Malai Curry tonight.', spoken: 'Try the', dishes });
    expect(join(s, C.text)).toBe('Try the');
    expect(join(s, C.dim)).toBe('Prawn Malai Curry tonight.');
    const later = captionSpans({ text: 'Try the Prawn Malai Curry tonight.', spoken: 'Try the Prawn Malai Curry', dishes });
    expect(join(later, C.amber)).toBe('Prawn Malai Curry');
    expect(join(later, C.dim)).toBe('tonight.');
  });

  it('matches whole words only, and Bangla names', () => {
    expect(join(captionSpans({ text: 'Naanbread is not a dish here.', spoken: null, dishes }), C.amber)).toBe('');
    const bn = captionSpans({ text: 'চিকেন বিরিয়ানি নেবেন?', spoken: null, dishes: ['চিকেন বিরিয়ানি'] });
    expect(join(bn, C.amber)).toBe('চিকেন বিরিয়ানি নেবেন?'.replace(' নেবেন?', ''));
  });
});

describe('sayingIndex — the slider follows the voice', () => {
  const cards = [
    { id: 'a', name: 'Hot Wings' },
    { id: 'b', name: 'Oreo Milkshake' },
    { id: 'c', name: 'French Fries' },
  ];
  const said = [
    { id: 'a', said: 'হট উইংস' },
    { id: 'b', said: 'ওরিও মিল্কশেক' },
    { id: 'c', said: 'ফ্রেঞ্চ ফ্রাইজ' },
  ];
  const text = 'আছে হট উইংস, তারপর ওরিও মিল্কশেক, আর শেষে ফ্রেঞ্চ ফ্রাইজ।';
  const words = (n: number) => n;

  it('no card until a name has started', () => {
    expect(sayingIndex(text, words(1), cards, said)).toBeNull();
  });
  it('each card as its Bangla-script name is reached', () => {
    expect(sayingIndex(text, words(2), cards, said)).toBe(0);
    expect(sayingIndex(text, words(5), cards, said)).toBe(1);
    expect(sayingIndex(text, words(9), cards, said)).toBe(2);
  });
  it('English names straight from the menu', () => {
    const en = 'Try the Hot Wings, or an Oreo Milkshake.';
    expect(sayingIndex(en, 3, cards)).toBe(0);
    expect(sayingIndex(en, 7, cards)).toBe(1);
  });
  it('nothing said yet → nothing', () => {
    expect(sayingIndex(text, 0, cards, said)).toBeNull();
  });
});
