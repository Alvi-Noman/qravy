import { ObjectId } from 'mongodb';

export type CategoryScope = 'all' | 'location';
export type ChannelScope = 'all' | 'dine-in' | 'online';

export interface CategoryDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  createdBy?: ObjectId;

  // Branch-aware scoping
  // scope='all' -> visible to all locations
  // scope='location' -> only for the specific locationId
  scope?: CategoryScope;
  locationId?: ObjectId | null;

  // Channel-aware scoping for this category:
  // 'all' = belongs to both channels
  // 'dine-in' or 'online' = belongs only to that channel
  channelScope?: ChannelScope;

  name: string;

  createdAt: Date;
  updatedAt: Date;
}