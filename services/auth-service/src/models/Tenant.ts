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
    locationMode?: 'single' | 'multiple';
    hasLocations?: boolean; // ADD
  };

  planInfo?: {
    planId: string;
  };

  billingProfile?: {
    companyName: string;
    billingEmail: string;
    extraEmails?: string[];
    address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
    taxId?: string;
    taxExempt?: 'none' | 'exempt' | 'reverse';
    dunningEnabled?: boolean;
    dunningDays?: number[];
    createdAt?: Date;
    updatedAt?: Date;
  };

  trialStartedAt?: Date;
  trialEndsAt?: Date;

  subscriptionStatus?: 'none' | 'active';

  cancelRequestedAt?: Date;
  cancelEffectiveAt?: Date;
  cancelAtPeriodEnd?: boolean;

  onboardingProgress?: {
    hasCategory?: boolean;
    hasMenuItem?: boolean;
    hasLocations?: boolean; 
    checklist?: Record<string, boolean>;
  };

  payment?: {
    provider?: 'stripe' | 'adyen' | 'mock' | 'none';
    customerId?: string;
    defaultPaymentMethodId?: string;

    brand?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'maestro' | 'unionpay' | 'unknown';
    last4?: string;
    expMonth?: number;
    expYear?: number;
    country?: string;
    funding?: 'credit' | 'debit' | 'prepaid' | 'unknown';

    createdAt?: Date;
    updatedAt?: Date;
  };

  hasCardOnFile?: boolean;

  createdAt: Date;
  updatedAt: Date;
}