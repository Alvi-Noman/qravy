/**
 * MenuItem document shape for MongoDB (TypeScript-only type).
 */
import { ObjectId } from 'mongodb';

export interface MenuItemDoc {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  price: number;
  description?: string;
  category?: string;
  createdAt: Date;
  updatedAt: Date;
}