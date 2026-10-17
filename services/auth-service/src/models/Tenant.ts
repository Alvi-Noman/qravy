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
  faviconUrl?: string | null;
  /** the start screen's logo: the shape behind it ('none': the logo alone), corner roundness (% of size), size (px) */
  logoBackground?: 'white' | 'black' | 'none';
  logoRadius?: number;
  logoSize?: number;
  /** the digits prices are shown in: 'bn' → ৳২৫০ (set by a menu import that prints Bangla prices) */
  priceDigits?: 'latin' | 'bn';
  guestMessages?: Record<string, { bn?: string; en?: string }>;
  waiterName?: string | null;
  waiterVoice?: 'female' | 'male';
  customAnswers?: Array<{ question: string; answer: string }>;
  /** the owner's upsells: a guest orders one of these dishes / a dish of these categories → the waiter offers these */
  upsellRules?: Array<{ whenItemIds: string[]; whenCategories: string[]; offerItemIds: string[]; on: boolean }>;
  /** the owner's picks: a guest asks for one of these words → the waiter shows these dishes, in this order */
  suggestRules?: Array<{ phrases: string[]; itemIds: string[]; on: boolean }>;
  pronunciations?: Array<{ word: string; sayAs: string; spoken: string }>;
  /** this restaurant's own way of saying words (Menu Items): its voice only, over Qravy's dictionary (routes/pronounceRoutes.ts) */
  ownPronunciations?: Array<{ word: string; sayAs: string; spoken: string; by: string; updatedAt: Date }>;

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
  /** Two or more branches: the branch the main link (no branch in it) orders from. Missing → guests pick one. */
  mainBranchId?: ObjectId | null;

  /**
   * Set only on a quick-demo restaurant (/quick-demo, no account): created from photos of a real menu to show the
   * owner a live storefront. ownerId is a placeholder with no user. Everything is deleted after expiresAt.
   */
  demo?: {
    /** Secret in the demo page's URL; the only way to read or name this demo */
    key: string;
    importId: ObjectId;
    /** The restaurant name was typed in (until then the menu is read but not built) */
    named: boolean;
    expiresAt: Date;
  };

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
  /** what the restaurant pays Qravy, kept by hand: a custom price, paid until, payments, history (services/billing.ts) */
  billing?: import('../services/billing.js').Billing;

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