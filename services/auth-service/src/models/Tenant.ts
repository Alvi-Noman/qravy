import { ObjectId } from 'mongodb';

export interface TenantDoc {
  _id?: ObjectId;
  name: string;
  subdomain: string;
  ownerId: ObjectId;
  onboardingCompleted: boolean;

  ownerInfo?: {
    fullName: string;
    phone: string;
  };
  restaurantInfo?: {
    restaurantType: string;
    country: string;
    address: string;
  };
  planInfo?: {
    planId: string;
  };

  createdAt: Date;
  updatedAt: Date;
}