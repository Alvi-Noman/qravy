import { ObjectId } from 'mongodb';

/**
 * Per-location visibility overlay for a category.
 * Unique on (tenantId, categoryId, locationId).
 */
export interface CategoryVisibilityDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  categoryId: ObjectId;
  locationId: ObjectId;

  visible: boolean;

  createdAt: Date;
  updatedAt: Date;
}