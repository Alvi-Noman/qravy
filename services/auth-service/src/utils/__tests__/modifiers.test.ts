import { normalizeModifierGroups, resolveModifierSelections } from '../modifiers.js';

describe('modifier groups', () => {
  const groups = normalizeModifierGroups([
    {
      id: 'side',
      name: ' Choose a side ',
      min: 1,
      max: 1,
      options: [
        { id: 'fries', name: 'Fries', price: 0 },
        { id: 'salad', name: 'Salad', price: '20' },
      ],
    },
    {
      name: 'Extras',
      min: 0,
      max: 10,
      options: [
        { name: 'Cheese', price: 50 },
        { name: 'cheese', price: 99 },
        { name: 'Egg', price: -5 },
        { name: '  ' },
      ],
    },
    { name: 'No options', options: [] },
  ]);

  it('normalizes: trims, dedupes, clamps and assigns ids', () => {
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: 'side', name: 'Choose a side', min: 1, max: 1 });
    expect(groups[0].options[1]).toEqual({ id: 'salad', name: 'Salad', price: 20 });
    expect(groups[1].max).toBe(2);
    expect(groups[1].options.map((o) => [o.name, o.price])).toEqual([
      ['Cheese', 50],
      ['Egg', 0],
    ]);
    expect(groups[1].id).toMatch(/^[a-f0-9]{12}$/);
  });

  it('keeps existing ids stable on re-save', () => {
    expect(normalizeModifierGroups(groups)).toEqual(groups);
  });

  it('resolves valid selections with server prices', () => {
    const cheese = groups[1].options[0].id;
    const out = resolveModifierSelections(groups, [
      { groupId: 'side', optionIds: ['salad'] },
      { groupId: groups[1].id, optionIds: [cheese] },
    ]);
    expect(out.map((m) => [m.name, m.price])).toEqual([
      ['Salad', 20],
      ['Cheese', 50],
    ]);
  });

  it('rejects missing required choices, too many, and unknown options', () => {
    expect(() => resolveModifierSelections(groups, [])).toThrow('Please choose an option for "Choose a side"');
    expect(() => resolveModifierSelections(groups, [{ groupId: 'side', optionIds: ['fries', 'salad'] }])).toThrow(
      'Choose only one'
    );
    expect(() => resolveModifierSelections(groups, [{ groupId: 'side', optionIds: ['onion-rings'] }])).toThrow(
      'no longer available'
    );
    expect(() =>
      resolveModifierSelections(groups, [
        { groupId: 'side', optionIds: ['fries'] },
        { groupId: 'ghost', optionIds: ['x'] },
      ])
    ).toThrow('no longer available');
  });
});
