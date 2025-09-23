import { ObjectId } from 'mongodb';

export type CategoryScope = 'all' | 'location';

export interface CategoryDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  createdBy?: ObjectId;

  // Branch-aware scoping
  // scope='all' -> visible to all locations
  // scope='location' -> only for the specific locationId
  scope?: CategoryScope;
  locationId?: ObjectId | null;

  name: string;

  createdAt: Date;
  updatedAt: Date;
}