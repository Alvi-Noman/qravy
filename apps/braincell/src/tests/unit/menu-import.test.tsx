import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DraftCategoryCard from '../../components/menu-import/DraftCategoryCard';
import {
  applyModalValues,
  draftStats,
  itemBlockingIssue,
  parsePriceInput,
  toModalInitial,
} from '../../components/menu-import/draftUtils';
import type { DraftCategory, DraftItem } from '../../api/menuImports';

const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  tempId: Math.random().toString(36).slice(2),
  name: 'Kacchi Biryani',
  price: 380,
  options: [],
  variations: [],
  tags: [],
  media: [],
  modifierGroups: [],
  confidence: 'high',
  issues: [],
  action: 'create',
  ...over,
});

const category = (items: DraftItem[], over: Partial<DraftCategory> = {}): DraftCategory => ({
  tempId: 'cat-1',
  name: 'Biryani',
  matchCategoryId: null,
  items,
  ...over,
});

describe('menu import draft utils', () => {
  it('blocks items without a name or any price, but not skipped ones', () => {
    expect(itemBlockingIssue(item({ name: ' ' }))).toBe('Name is required');
    expect(itemBlockingIssue(item({ price: undefined }))).toBe('Price is required');
    expect(itemBlockingIssue(item({ price: undefined, action: 'skip' }))).toBeNull();
    expect(
      itemBlockingIssue(item({ price: undefined, variations: [{ name: 'Half', price: 220, optionValues: ['Half'] }] }))
    ).toBeNull();
    expect(itemBlockingIssue(item({ price: 300, compareAtPrice: 250 }))).toMatch(/Compare-at/);
  });

  it('computes review stats', () => {
    const stats = draftStats({
      categories: [
        category([item(), item({ action: 'skip', duplicateOfItemId: 'x' }), item({ price: undefined })], {
          matchCategoryId: 'existing',
        }),
        category([item({ action: 'skip' })], { tempId: 'cat-2', name: 'Drinks' }),
      ],
    });
    expect(stats).toMatchObject({
      categories: 1, // Drinks has nothing to import
      merged: 1,
      items: 4,
      included: 2,
      skipped: 2,
      duplicates: 1,
      blocking: 1,
    });
  });

  it('parses price inputs', () => {
    expect(parsePriceInput('')).toBeUndefined();
    expect(parsePriceInput('1,200')).toBe(1200);
    expect(parsePriceInput('12.505')).toBe(12.51);
    expect(parsePriceInput('abc')).toBeNaN();
  });

  it('round-trips through the MenuItemModal shape and marks the item reviewed', () => {
    const it0 = item({
      price: undefined,
      options: [{ name: 'Size', values: ['Half', 'Full'] }],
      variations: [
        { name: 'Half', price: 220, optionValues: ['Half'] },
        { name: 'Full', price: 400, optionValues: ['Full'] },
      ],
      confidence: 'low',
      issues: ['Price partly unreadable'],
    });
    const initial = toModalInitial(it0, category([it0]));
    expect(initial.price).toBe('');
    expect(initial.variations.map((v) => [v.label, v.price])).toEqual([
      ['Half', '220'],
      ['Full', '400'],
    ]);

    const next = applyModalValues(it0, {
      name: ' Kacchi ',
      variations: [
        { name: 'Half', price: 250, optionValues: ['Half'] },
        { name: 'Full', price: 450, optionValues: ['Full'] },
      ],
      options: [{ name: 'Size', values: ['Half', 'Full'] }],
      tags: ['Spicy'],
      media: ['https://cdn.example.com/a.jpg'],
    });
    expect(next).toMatchObject({
      tempId: it0.tempId,
      name: 'Kacchi',
      confidence: 'high',
      issues: [],
      tags: ['Spicy'],
      media: ['https://cdn.example.com/a.jpg'],
    });
    expect(next.variations.map((v) => v.price)).toEqual([250, 450]);
  });
});

describe('imported add-ons', () => {
  it('pass through the item editor and show on the review row', () => {
    const extras = { name: 'Extras', min: 0, max: 2, options: [{ name: 'Cheese', price: 50 }, { name: 'Egg', price: 30 }] };
    const it0 = item({ modifierGroups: [extras] });
    expect(toModalInitial(it0, category([it0])).modifierGroups).toEqual([extras]);
    const side = { name: 'Choice of side', min: 1, max: 1, options: [{ name: 'Fries', price: 0 }] };
    expect(applyModalValues(it0, { name: 'Burger', price: 300, modifierGroups: [extras, side] }).modifierGroups).toHaveLength(2);

    render(
      <DraftCategoryCard
        category={category([item({ modifierGroups: [extras, side] })])}
        existingCategories={[]}
        otherCategories={[]}
        filter="all"
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onMoveItem={vi.fn()}
        onEditItem={vi.fn()}
      />
    );
    expect(screen.getByText('Extras · optional · 2 options')).toBeTruthy();
    expect(screen.getByText('Choice of side · required · 1 option')).toBeTruthy();
  });
});

describe('<DraftCategoryCard />', () => {
  const baseProps = {
    currency: 'BDT',
    existingCategories: [{ id: 'c1', name: 'Rice' }],
    otherCategories: [{ tempId: 'cat-2', name: 'Drinks' }],
    filter: 'all' as const,
    onRemove: vi.fn(),
    onMoveItem: vi.fn(),
    onEditItem: vi.fn(),
  };

  it('lets the owner merge into an existing category and skip items', () => {
    const onChange = vi.fn();
    const items = [item({ tempId: 'a' }), item({ tempId: 'b', name: 'Tehari', price: 220 })];
    render(<DraftCategoryCard {...baseProps} category={category(items)} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Category destination'), { target: { value: 'c1' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ matchCategoryId: 'c1' }));

    fireEvent.click(screen.getByLabelText('Include Tehari'));
    const updated = onChange.mock.calls.at(-1)![0] as DraftCategory;
    expect(updated.items.find((i) => i.tempId === 'b')!.action).toBe('skip');
  });

  it('offers skip / update / create for items already in the menu', () => {
    const onChange = vi.fn();
    const dup = item({ tempId: 'd', duplicateOfItemId: '65f000000000000000000001', action: 'skip' });
    render(<DraftCategoryCard {...baseProps} category={category([dup])} onChange={onChange} />);

    expect(screen.getByText('Already in your menu')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What to do with the existing item'), { target: { value: 'update' } });
    const updated = onChange.mock.calls.at(-1)![0] as DraftCategory;
    expect(updated.items[0].action).toBe('update');
  });

  it('shows variation prices instead of a price input', () => {
    const v = item({
      price: undefined,
      options: [{ name: 'Size', values: ['S', 'L'] }],
      variations: [
        { name: 'S', price: 450, optionValues: ['S'] },
        { name: 'L', price: 850, optionValues: ['L'] },
      ],
    });
    render(<DraftCategoryCard {...baseProps} category={category([v])} onChange={vi.fn()} />);
    expect(screen.getByText('Set by variations')).toBeTruthy();
    expect(screen.getByText('S ৳450 · L ৳850')).toBeTruthy();
    expect(screen.queryByLabelText('Price')).toBeNull();
  });
});
