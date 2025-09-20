import { ObjectId } from 'mongodb';

export interface LocationDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  createdBy?: ObjectId;

  name: string;
  address?: string;
  zip?: string;
  country?: string;

  createdAt: Date;
  updatedAt: Date;
}