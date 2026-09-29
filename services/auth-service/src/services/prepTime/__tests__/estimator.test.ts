import { estimateWithAI, guessPrep } from '../estimator.js';

describe('prep time: rule of thumb per dish (never one number for the whole menu)', () => {
  it.each([
    ['Coke', 'Beverage', 2],
    ['Mineral Water (large)', 'Drinks', 2],
    ['Masala Tea', 'Hot Drinks', 5],
    ['Onion Ring', 'Appetizer', 11],
    ['French Fry', 'Appetizer', 11],
    ['Hot & Sour Soup', 'Soup', 10],
    ['Chicken Cashew Nut Salad (regular)', 'Salad', 9],
    ['Egg Fried Rice', 'Rice & Noodles', 14],
    ['Chicken Chili Onion', 'Chicken', 16],
    ['Beef with Red Curry', 'Beef', 16],
    ['Beef Sizzling', 'Sizzling', 20],
    ['Kacchi Biryani', 'Biryani', 9],
    ['Whole Fish Snapper', 'Fish', 28],
    ['Set Menu A-02', 'Set Menu', 18],
  ])('%s → %i min', (name, category, minutes) => {
    expect(guessPrep({ name, category })).toBe(minutes);
  });

  it('falls back to the description, then 15', () => {
    expect(guessPrep({ name: 'House Special', category: 'Mains', description: 'Chicken in a rich masala curry' })).toBe(16);
    expect(guessPrep({ name: 'Special Fried Prawn', category: 'Prawn' })).toBe(15);
  });

  it('without an AI key, every dish still gets its own rule-of-thumb time', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await estimateWithAI([
        { id: 'a', name: 'Coke', category: 'Beverage' },
        { id: 'b', name: 'Beef Sizzling', category: 'Sizzling', sizes: ['Regular', 'Large'] },
      ]);
      expect(r.source).toBe('guess');
      expect(r.estimates).toEqual([
        { id: 'a', minutes: 2, sizes: {} },
        { id: 'b', minutes: 20, sizes: {} },
      ]);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});
