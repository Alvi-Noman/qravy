import {
  fixShouting,
  stripItemNumber,
  toDraftModifierGroups,
  matchExisting,
  mergeChunks,
  nameKey,
  parsePrice,
  rawItemToDraft,
  toAsciiDigits,
} from '../normalize.js';
import type { RawItem, RawMenu } from '../types.js';

function rawItem(over: Partial<RawItem> = {}): RawItem {
  return {
    name: 'Chicken Biryani',
    description: null,
    price: 250,
    compareAtPrice: null,
    priceText: null,
    options: [],
    variants: [],
    tags: [],
    addOnGroups: [],
    hours: [],
    confidence: 'high',
    issues: [],
    page: 1,
    ...over,
  };
}

describe('menu import normalize', () => {
  describe('parsePrice', () => {
    it.each([
      [250, 250],
      ['৳ ২৫০', 250],
      ['250/-', 250],
      ['Tk. 1,200', 1200],
      ['1,20,000', 120000],
      ['$12.50', 12.5],
      ['12,50 €', 12.5],
      ['1.234,56', 1234.56],
      ['BDT ৪৯৯.৯৯', 499.99],
    ])('%p → %p', (input, expected) => {
      expect(parsePrice(input)).toBe(expected);
    });

    it.each([[null], [undefined], [-5], ['Market price'], [NaN]])('%p → undefined', (input) => {
      expect(parsePrice(input)).toBeUndefined();
    });
  });

  it('converts Bangla/Devanagari digits', () => {
    expect(toAsciiDigits('০১২৩৪৫৬৭৮৯ ०१२')).toBe('0123456789 012');
  });

  it('fixes ALL-CAPS names only', () => {
    expect(fixShouting('CHICKEN BIRYANI')).toBe('Chicken Biryani');
    expect(fixShouting('BBQ')).toBe('Bbq');
    expect(fixShouting('iPhone Special')).toBe('iPhone Special');
    expect(fixShouting('কাচ্চি বিরিয়ানি')).toBe('কাচ্চি বিরিয়ানি');
  });

  it('nameKey ignores case, punctuation and simple plurals', () => {
    expect(nameKey('Drinks')).toBe(nameKey('drink'));
    expect(nameKey('Soups & Salads')).toBe(nameKey('soup and salad'));
    expect(nameKey('Glass')).toBe('glass');
  });

  it.each([
    ['12. Chicken Tikka', 'Chicken Tikka'],
    ['A3 - Beef Burger', 'Beef Burger'],
    ['#5 Club Sandwich', 'Club Sandwich'],
    ['(7) Tomato Soup', 'Tomato Soup'],
    ['7 Up', '7 Up'],
    ['1/2 Grilled Chicken', '1/2 Grilled Chicken'],
    ['3 Cheese Pizza', '3 Cheese Pizza'],
    ['A1 Steak Sauce', 'A1 Steak Sauce'],
  ])('stripItemNumber(%p) → %p', (input, expected) => {
    expect(stripItemNumber(input)).toBe(expected);
  });

  it('cleans add-on groups and clamps min/max', () => {
    expect(
      toDraftModifierGroups([
        { name: 'EXTRAS', min: -1, max: 9, options: [{ name: 'Cheese', price: 50 }, { name: 'cheese', price: 60 }, { name: 'Egg', price: null }] },
        { name: 'Empty', min: 0, max: 1, options: [] },
        { name: 'Side', min: 3, max: 1, options: [{ name: 'Fries', price: 0 }, { name: 'Salad', price: 0 }] },
      ])
    ).toEqual([
      { name: 'Extras', min: 0, max: 2, options: [{ name: 'Cheese', price: 50 }, { name: 'Egg', price: 0 }] },
      { name: 'Side', min: 1, max: 1, options: [{ name: 'Fries', price: 0 }, { name: 'Salad', price: 0 }] },
    ]);
  });

  it("applies section-wide add-ons to every item, after the item's own groups", () => {
    const draft = mergeChunks([
      {
        pageOffset: 0,
        menu: {
          currency: null, notes: [],
          categories: [
            {
              name: 'Burgers',
              description: null,
              addOnGroups: [{ name: 'Extras', min: 0, max: 2, options: [{ name: 'Cheese', price: 40 }, { name: 'Bacon', price: 80 }] }], hours: [],
              items: [
                rawItem({ name: 'Classic' }),
                rawItem({
                  name: 'Combo',
                  addOnGroups: [{ name: 'Choice of drink', min: 1, max: 1, options: [{ name: 'Coke', price: 0 }, { name: 'Water', price: 0 }] }],
                }),
              ],
            },
          ],
        },
      },
    ]);
    const [classic, combo] = draft.categories[0].items;
    expect(classic.modifierGroups.map((g) => g.name)).toEqual(['Extras']);
    expect(combo.modifierGroups.map((g) => [g.name, g.min, g.max])).toEqual([
      ['Choice of drink', 1, 1],
      ['Extras', 0, 2],
    ]);
  });

  it('keeps section hours/descriptions and dedupes menu notes across pages', () => {
    const cat = (hours: Array<{ days: number[]; start: string; end: string }>, description: string | null) => ({
      name: 'Breakfast',
      description,
      addOnGroups: [],
      hours,
      items: [rawItem({ name: 'Paratha', price: 30 })],
    });
    const draft = mergeChunks([
      {
        pageOffset: 0,
        menu: {
          currency: 'BDT',
          notes: ['All prices include VAT', 'V = Vegetarian'],
          categories: [cat([], null)],
        },
      },
      {
        pageOffset: 3,
        menu: {
          currency: 'BDT',
          notes: ['all prices include vat.', 'Service charge 5% applies'],
          categories: [cat([{ days: [0, 1, 2, 3, 4, 5, 6], start: '7:00', end: '11:00' }], 'Served till 11am')],
        },
      },
    ]);
    expect(draft.notes).toEqual(['All prices include VAT', 'V = Vegetarian', 'Service charge 5% applies']);
    expect(draft.categories).toHaveLength(1);
    expect(draft.categories[0]).toMatchObject({
      description: 'Served till 11am',
      availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '11:00' }],
    });
  });

  describe('rawItemToDraft', () => {
    it('uses priceText when price is missing and keeps a valid compare-at price', () => {
      const d = rawItemToDraft(rawItem({ price: null, priceText: '৳৩২০', compareAtPrice: 400 }), 0)!;
      expect(d.price).toBe(320);
      expect(d.compareAtPrice).toBe(400);
      expect(d.action).toBe('create');
    });

    it('drops a compare-at price that is not higher than the price', () => {
      const d = rawItemToDraft(rawItem({ price: 300, compareAtPrice: 250 }), 0)!;
      expect(d.compareAtPrice).toBeUndefined();
    });

    it('builds size variants and offsets the page number', () => {
      const d = rawItemToDraft(
        rawItem({
          name: 'MARGHERITA',
          price: null,
          options: [{ name: 'Size', values: ['Small', 'Large'] }],
          variants: [
            { optionValues: ['Small'], price: 450 },
            { optionValues: ['Large'], price: 850 },
          ],
          page: 2,
        }),
        3
      )!;
      expect(d.name).toBe('Margherita');
      expect(d.options).toEqual([{ name: 'Size', values: ['Small', 'Large'] }]);
      expect(d.variations).toEqual([
        { name: 'Small', price: 450, optionValues: ['Small'] },
        { name: 'Large', price: 850, optionValues: ['Large'] },
      ]);
      expect(d.issues).toEqual([]);
      expect(d.sourcePage).toBe(5);
    });

    it("keeps a dish's own serving hours", () => {
      const d = rawItemToDraft(rawItem({ hours: [{ days: [5], start: '12:00', end: '15:00' }] }), 0)!;
      expect(d.availability).toEqual([{ days: [5], start: '12:00', end: '15:00' }]);
      expect(rawItemToDraft(rawItem(), 0)!.availability).toBeUndefined();
    });

    it('flags items without any price', () => {
      const d = rawItemToDraft(rawItem({ price: null }), 0)!;
      expect(d.confidence).toBe('low');
      expect(d.issues).toContain('No price found');
    });

    it('removes options whose variants do not match', () => {
      const d = rawItemToDraft(
        rawItem({
          options: [{ name: 'Size', values: ['S', 'L'] }],
          variants: [{ optionValues: ['XL'], price: 10 }],
        }),
        0
      )!;
      expect(d.options).toEqual([]);
      expect(d.variations).toEqual([]);
      expect(d.confidence).toBe('low');
    });

    it('returns null for nameless items', () => {
      expect(rawItemToDraft(rawItem({ name: '   ' }), 0)).toBeNull();
    });
  });

  describe('mergeChunks', () => {
    it('merges a category continuing across chunks and dedupes items', () => {
      const a: RawMenu = {
        currency: 'BDT', notes: [],
        categories: [
          { name: 'Biryani', description: null, addOnGroups: [], hours: [], items: [rawItem({ name: 'Kacchi', price: null })] },
        ],
      };
      const b: RawMenu = {
        currency: 'BDT', notes: [],
        categories: [
          {
            name: 'BIRYANI',
            description: null,
            addOnGroups: [], hours: [],
            items: [rawItem({ name: 'kacchi', price: 380 }), rawItem({ name: 'Tehari', price: 220 })],
          },
          { name: 'Drinks', description: null, addOnGroups: [], hours: [], items: [] },
        ],
      };
      const draft = mergeChunks([
        { menu: a, pageOffset: 0 },
        { menu: b, pageOffset: 3 },
      ]);
      expect(draft.currency).toBe('BDT');
      expect(draft.categories).toHaveLength(1); // empty "Drinks" dropped
      const [cat] = draft.categories;
      expect(cat.name).toBe('Biryani');
      expect(cat.items.map((i) => [i.name, i.price])).toEqual([
        ['kacchi', 380], // better copy (has price) wins
        ['Tehari', 220],
      ]);
    });

    it('puts unnamed categories into "Other"', () => {
      const draft = mergeChunks([
        { menu: { currency: null, notes: [], categories: [{ name: '', description: null, addOnGroups: [], hours: [], items: [rawItem()] }] }, pageOffset: 0 },
      ]);
      expect(draft.categories[0].name).toBe('Other');
    });
  });

  describe('matchExisting', () => {
    it('merges into existing categories and skips duplicate items', () => {
      const draft = mergeChunks([
        {
          menu: {
            currency: null, notes: [],
            categories: [
              {
                name: 'drinks',
                description: null,
                addOnGroups: [], hours: [],
                items: [rawItem({ name: 'Coke' }), rawItem({ name: 'Lassi' })],
              },
              { name: 'Desserts', description: null, addOnGroups: [], hours: [], items: [rawItem({ name: 'Firni' })] },
            ],
          },
          pageOffset: 0,
        },
      ]);
      matchExisting(
        draft,
        [
          { id: 'c1', name: 'Drinks' },
          { id: 'c2', name: 'Specials' },
        ],
        [
          { id: 'i1', name: 'COKE', categoryId: 'c1' },
          { id: 'i2', name: 'Firni', categoryId: 'c2' },
        ]
      );
      const [drinks, desserts] = draft.categories;
      expect(drinks.matchCategoryId).toBe('c1');
      expect(drinks.items[0]).toMatchObject({ name: 'Coke', action: 'skip', duplicateOfItemId: 'i1' });
      expect(drinks.items[1]).toMatchObject({ name: 'Lassi', action: 'create', duplicateOfItemId: null });
      expect(desserts.matchCategoryId).toBeNull();
      expect(desserts.items[0].action).toBe('create');
      expect(desserts.items[0].issues).toContain('An item with this name already exists in "Specials"');
    });
  });

  describe('prep time', () => {
    it('keeps a printed time and flags an estimated one for review', () => {
      const printed = rawItemToDraft(rawItem({ prepMinutes: 25, prepSource: 'printed' }), 0)!;
      expect(printed.prepMinutes).toBe(25);
      expect(printed.prepEstimated).toBeUndefined();

      const guessed = rawItemToDraft(rawItem({ prepMinutes: 17.6, prepSource: 'estimated' }), 0)!;
      expect(guessed.prepMinutes).toBe(18);
      expect(guessed.prepEstimated).toBe(true);
    });

    it('drops missing or nonsense times', () => {
      expect(rawItemToDraft(rawItem({ prepMinutes: 0, prepSource: 'estimated' }), 0)!.prepMinutes).toBeUndefined();
      expect(rawItemToDraft(rawItem(), 0)!.prepMinutes).toBeUndefined();
    });

    it('keeps a slower size on its variant', () => {
      const d = rawItemToDraft(
        rawItem({
          price: null,
          prepMinutes: 15,
          prepSource: 'estimated',
          options: [{ name: 'Size', values: ['Small', 'Large'] }],
          variants: [
            { optionValues: ['Small'], price: 400, prepMinutes: null },
            { optionValues: ['Large'], price: 700, prepMinutes: 22 },
          ],
        }),
        0
      )!;
      expect(d.variations.map((v) => [v.name, v.prepMinutes])).toEqual([
        ['Small', undefined],
        ['Large', 22],
      ]);
    });
  });
});
