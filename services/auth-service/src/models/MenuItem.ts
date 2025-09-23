import { ObjectId } from 'mongodb';

export type ItemScope = 'all' | 'location';

export interface Variation {
  name: string;
  price?: number;
  imageUrl?: string;
}

export interface MenuItemDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  restaurantId?: ObjectId;

  // Branch-aware scoping
  // scope='all' -> visible to all locations
  // scope='location' -> only for the specific locationId
  scope?: ItemScope;
  locationId?: ObjectId | null;

  name: string;
  price?: number;
  compareAtPrice?: number;
  description?: string;

  category?: string;
  categoryId?: ObjectId;

  media?: string[];
  variations?: Variation[];
  tags?: string[];

  hidden?: boolean;
  status?: 'active' | 'hidden';

  createdAt: Date;
  updatedAt: Date;
}