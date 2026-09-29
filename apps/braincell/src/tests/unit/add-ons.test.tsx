import { describe, it, expect } from 'vitest';
import {
  toApiModifierGroups,
  toUiModifierGroups,
  validateModifierGroups,
  type UiModifierGroup,
} from '../../components/menu-item-modal/AddOns';

const ui = (over: Partial<UiModifierGroup>): UiModifierGroup => ({
  key: 'k',
  name: 'Extras',
  min: 0,
  max: 3,
  options: [
    { name: 'Cheese', price: '50' },
    { name: 'Egg', price: '' },
    { name: '', price: '' },
  ],
  ...over,
});

describe('add-ons editor helpers', () => {
  it('converts to API shape: drops blank options, free = 0, clamps max', () => {
    expect(toApiModifierGroups([ui({})])).toEqual([
      {
        name: 'Extras',
        min: 0,
        max: 2,
        options: [
          { name: 'Cheese', price: 50 },
          { name: 'Egg', price: 0 },
        ],
      },
    ]);
  });

  it('keeps ids so carts/orders stay valid after edits', () => {
    const round = toApiModifierGroups(
      toUiModifierGroups([{ id: 'g1', name: 'Side', min: 1, max: 1, options: [{ id: 'o1', name: 'Fries', price: 0 }] }])
    );
    expect(round[0]).toMatchObject({ id: 'g1', options: [{ id: 'o1', name: 'Fries', price: 0 }] });
  });

  it('validates names, options, prices and required counts', () => {
    expect(validateModifierGroups([ui({})])).toBeNull();
    expect(validateModifierGroups([ui({ name: '' })])).toMatch(/name/);
    expect(validateModifierGroups([ui({ options: [{ name: '', price: '' }] })])).toMatch(/at least one option/);
    expect(validateModifierGroups([ui({ options: [{ name: 'Cheese', price: 'abc' }] })])).toMatch(/valid price/);
    expect(validateModifierGroups([ui({ min: 3, max: 3 })])).toMatch(/more choices/);
    expect(validateModifierGroups([ui({ name: '', options: [{ name: '', price: '' }] })])).toBeNull(); // empty group ignored
  });
});
