/**
 * MongoDB models for menu items
 */
import { ObjectId } from 'mongodb';

export interface Variation {
  name: string;
  price?: number;
  imageUrl?: string;
}

export interface MenuItemDoc {
  _id?: ObjectId;
  userId: ObjectId;
  restaurantId?: ObjectId;
  name: string;
  price?: number;
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