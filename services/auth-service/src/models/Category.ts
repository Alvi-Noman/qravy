import { ObjectId } from 'mongodb';

export interface CategoryDoc {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}