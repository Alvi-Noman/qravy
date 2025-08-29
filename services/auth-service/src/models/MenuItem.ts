import { ObjectId } from 'mongodb';

/** One purchasable option for a menu item */
export interface Variation {
  name: string;
  price?: number;
  imageUrl?: string;
}

/** Mongo document for a menu item (per user/restaurant) */
export interface MenuItemDoc {
  _id?: ObjectId;
  userId: ObjectId;
  restaurantId?: ObjectId;
  name: string;
  price: number;
  compareAtPrice?: number;
  description?: string;
  category?: string;
  categoryId?: ObjectId;
  media?: string[];
  variations?: Variation[];
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}