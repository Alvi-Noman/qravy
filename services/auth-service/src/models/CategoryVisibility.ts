import { ObjectId } from 'mongodb';

export type Channel = 'dine-in' | 'online';

/**
 * Per-location, per-channel visibility overlay for a category.
 * Unique on (tenantId, categoryId, locationId, channel).
 * removed=true acts as a scoped delete tombstone.
 */
export interface CategoryVisibilityDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  categoryId: ObjectId;
  locationId: ObjectId;
  channel: Channel;

  // Optional: visibility overlay (not present for tombstones)
  visible?: boolean;

  // Optional: scoped delete tombstone
  removed?: boolean;

  createdAt: Date;
  updatedAt: Date;
}