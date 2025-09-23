import { ObjectId } from 'mongodb';

/**
 * Per-location availability overlay for a menu item.
 * Unique on (tenantId, itemId, locationId).
 */
export interface ItemAvailabilityDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  itemId: ObjectId;
  locationId: ObjectId;

  available: boolean;

  createdAt: Date;
  updatedAt: Date;
}