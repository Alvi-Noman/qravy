import { ObjectId } from 'mongodb';
import { toMenuItemDTO } from '../mapper.js';

describe('"Also show in" categories on a menu item', () => {
  const home = new ObjectId();
  const base = { _id: new ObjectId(), tenantId: new ObjectId(), name: 'চিকেন বিরিয়ানি', price: 240, categoryId: home,
    createdAt: new Date(), updatedAt: new Date() } as any;

  it('sends the extra categories as plain ids, with the home category unchanged', () => {
    const extra = [new ObjectId(), new ObjectId()];
    const dto = toMenuItemDTO({ ...base, extraCategoryIds: extra });
    expect(dto.categoryId).toBe(String(home));
    expect(dto.extraCategoryIds).toEqual(extra.map(String));
  });

  it('leaves the field out when the dish is only in its own category', () => {
    expect(toMenuItemDTO(base)).not.toHaveProperty('extraCategoryIds');
    expect(toMenuItemDTO({ ...base, extraCategoryIds: [] })).not.toHaveProperty('extraCategoryIds');
  });
});
