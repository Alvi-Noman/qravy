import { ObjectId } from 'mongodb';

export type Channel = 'dine-in' | 'online';

/**
 * Per-location, per-channel visibility overlay for a category.
 * Unique on (tenantId, categoryId, locationId, channel).
 */
export interface CategoryVisibilityDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  categoryId: ObjectId;
  locationId: ObjectId;
  channel: Channel;

  visible: boolean;

  createdAt: Date;
  updatedAt: Date;
}