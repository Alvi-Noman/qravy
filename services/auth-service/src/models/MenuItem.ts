import { ObjectId } from 'mongodb';

export type ItemScope = 'all' | 'location';
export type Channel = 'dine-in' | 'online';

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

  // Channel-aware baseline visibility (per-channel default)
  // If omitted, treat both channels as visible by default.
  visibility?: {
    dineIn?: boolean;  // default true if undefined
    online?: boolean;  // default true if undefined
  };

  name: string;
  price?: number;
  compareAtPrice?: number;
  description?: string;

  category?: string;
  categoryId?: ObjectId;

  media?: string[];
  variations?: Variation[];
  tags?: string[];

  // Legacy/global flags. Derived per-view; kept for backward-compat.
  hidden?: boolean;
  status?: 'active' | 'hidden';

  createdAt: Date;
  updatedAt: Date;
}