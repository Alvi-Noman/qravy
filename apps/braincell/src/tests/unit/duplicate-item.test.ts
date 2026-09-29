import { describe, it, expect } from 'vitest';
import { buildDuplicatePayload } from '../../components/menu-items/useMenuItems';
import type { MenuItem } from '../../api/menuItems';

const base = {
  id: 'i1',
  name: 'Pizza',
  price: 450,
  category: 'Pizza',
  categoryId: 'c1',
  media: ['https://cdn.example.com/p.jpg'],
  variations: [],
  tags: ['Spicy'],
  createdAt: '',
  updatedAt: '',
} as unknown as MenuItem;

describe('duplicate item', () => {
  it('copies variations, options, add-ons, photos and tags', () => {
    const item = {
      ...base,
      compareAtPrice: 500,
      description: 'Stone baked',
      options: [{ name: 'Size', values: ['Small', 'Large'] }],
      variations: [
        { name: 'Small', price: 450, optionValues: ['Small'] },
        { name: 'Large', price: 850, imageUrl: 'https://cdn.example.com/l.jpg', optionValues: ['Large'] },
      ],
      modifierGroups: [
        { id: 'g1', name: 'Extras', min: 0, max: 2, options: [{ id: 'o1', name: 'Cheese', price: 50 }, { id: 'o2', name: 'Olives', price: 30 }] },
      ],
    } as unknown as MenuItem;

    const p = buildDuplicatePayload(item);
    expect(p).toMatchObject({
      name: 'Pizza (Copy)',
      description: 'Stone baked',
      category: 'Pizza',
      categoryId: 'c1',
      media: ['https://cdn.example.com/p.jpg'],
      tags: ['Spicy'],
      options: [{ name: 'Size', values: ['Small', 'Large'] }],
      variations: [
        { name: 'Small', price: 450, optionValues: ['Small'] },
        { name: 'Large', price: 850, imageUrl: 'https://cdn.example.com/l.jpg', optionValues: ['Large'] },
      ],
      modifierGroups: [{ name: 'Extras', min: 0, max: 2, options: [{ name: 'Cheese', price: 50 }, { name: 'Olives', price: 30 }] }],
    });
    // priced variants → server derives the base price; compare-at needs a product price
    expect(p.price).toBeUndefined();
    expect(p.compareAtPrice).toBeUndefined();
    // add-on ids are not reused, so the copy's groups are independent
    expect(JSON.stringify(p.modifierGroups)).not.toMatch(/"id"/);
  });

  it('copies price and compare-at for simple items', () => {
    const p = buildDuplicatePayload({ ...base, compareAtPrice: 500 } as MenuItem);
    expect(p).toMatchObject({ price: 450, compareAtPrice: 500 });
    expect(p.variations).toBeUndefined();
    expect(p.modifierGroups).toBeUndefined();
  });

  it('does not copy the copies mutably', () => {
    const p = buildDuplicatePayload(base);
    p.tags!.push('x');
    expect(base.tags).toEqual(['Spicy']);
  });
});
