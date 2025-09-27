import { ObjectId } from 'mongodb';

export type Channel = 'dine-in' | 'online';

/**
 * Per-location, per-channel availability overlay for a menu item.
 * Unique on (tenantId, itemId, locationId, channel).
 */
export interface ItemAvailabilityDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  itemId: ObjectId;
  locationId: ObjectId;
  channel: Channel;

  available: boolean;

  createdAt: Date;
  updatedAt: Date;
}