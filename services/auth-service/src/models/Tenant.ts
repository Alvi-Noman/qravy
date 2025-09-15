// services/auth-service/src/models/Tenant.ts
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

  trialStartedAt?: Date;
  trialEndsAt?: Date;

  subscriptionStatus?: 'none' | 'active';

  createdAt: Date;
  updatedAt: Date;
}