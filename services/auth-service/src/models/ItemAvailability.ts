import { ObjectId } from 'mongodb';

export type Channel = 'dine-in' | 'online';

/**
 * Per-location, per-channel availability overlay for a menu item.
 * Unique on (tenantId, itemId, locationId, channel).
 * removed=true acts as a scoped delete tombstone.
 */
export interface ItemAvailabilityDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  itemId: ObjectId;
  locationId: ObjectId;
  channel: Channel;

  // Optional: availability overlay (not present for tombstones)
  available?: boolean;

  // Optional: scoped delete tombstone
  removed?: boolean;

  // "Sold out until tomorrow": switch back on (available:true) at this time
  resumeAt?: Date;

  // Off only because its section was off at this branch when the dish was added: switching that section back on
  // switches the dish back on too. A person's own on/off switch clears it.
  fromCategory?: boolean;

  createdAt: Date;
  updatedAt: Date;
}