import { ObjectId } from 'mongodb';

export interface TenantDoc {
  _id?: ObjectId;
  name: string;
  subdomain: string;
  ownerId: ObjectId;
  onboardingCompleted: boolean;

  /** Menu-wide notes shown to customers ("Prices include VAT", allergen info) */
  menuNotes?: string[];

  /** House facts the virtual waiter may tell guests (Wi-Fi, payment methods, parking, halal…) */
  waiterKnowledge?: string[];

  /** Language the virtual waiter speaks by default (guests can switch on the storefront); missing = 'bn' */
  waiterLanguage?: 'bn' | 'en';
  /** The restaurant's logo (uploaded in Settings → Branding); the guest app's start screen shows it */
  logoUrl?: string | null;

  /** IANA time zone used for all hours (default Asia/Dhaka) */
  timezone?: string;
  /** Restaurant opening hours; empty/missing = always open */
  openingHours?: Array<{ days: number[]; start: string; end: string }>;
  /** Daily "HH:mm" when "sold out until tomorrow" items come back (default 05:00) */
  dailyResetTime?: string;
  /** Named service periods (Breakfast, Lunch…) items/categories reference; missing = defaults */
  servicePeriods?: Array<{ id: string; name: string; days: number[]; start: string; end: string }>;
  /** Wait-time estimation: minutes for a dish with no time set, and orders the kitchen cooks at once */
  kitchen?: { defaultPrepMinutes?: number; parallelOrders?: number };
  /** Dine-in table labels ("1", "A4", "PATIO-2"); each gets a QR code that opens the menu with ?table= */
  tables?: string[];
  /** Each table's secret QR key (utils/tableKeys): "/dine-in?table=12&k=<key>" proves the guest scanned that table */
  tableKeys?: Record<string, string>;

  ownerInfo?: {
    fullName: string;
    phone: string;
  };

  restaurantInfo?: {
    restaurantType: string;
    country: string;
    address: string;
    email?: string;
    phone?: string;
    locationMode?: 'single' | 'multiple';
    hasLocations?: boolean; // ADD
    onlineSalesEnabled?: boolean;
    dineInEnabled?: boolean;
  };

  // Access settings for central email/device enrollment
  accessSettings?: {
    centralEmail: string;
    emailVerified: boolean;
    enrollment: {
      requireOtpForNewDevice: boolean;
      requireManagerPinOnAssign: boolean;
      sessionDays: number;
      autoApproveAssignment: boolean;
    };
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