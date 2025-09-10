import { ObjectId } from 'mongodb';

export interface TenantDoc {
  _id?: ObjectId;
  name: string;
  subdomain: string;
  ownerId: ObjectId;
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}