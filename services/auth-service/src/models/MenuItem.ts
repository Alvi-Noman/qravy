import { ObjectId } from 'mongodb';

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