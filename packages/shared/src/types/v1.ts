// packages/shared/src/types/v1.ts

export interface UserDTO {
  id: string;
  email: string;
  isVerified: boolean;
  tenantId: string | null;
  isOnboarded: boolean;
}

/** A variant option, e.g. { name: 'Size', values: ['Small', 'Large'] } */
export interface VariantOptionDTO {
  name: string;
  values: string[];
}

/**
 * A sellable variant. When the item has `options`, `optionValues` holds one value per option
 * (same order) and `name` is those values joined with " / " (e.g. "Large / Spicy").
 */
export interface VariationDTO {
  name: string;
  price?: number;
  imageUrl?: string;
  optionValues?: string[];
  /** Kitchen minutes for this size when it differs from the item (wait-time estimation) */
  prepMinutes?: number;
}

/** One choice inside an add-on group, e.g. { name: 'Extra cheese', price: 50 } */
export interface ModifierOptionDTO {
  id: string;
  name: string;
  /** Surcharge added to the item price (0 for free choices) */
  price: number;
}
/**
 * An add-on / choice group on a menu item.
 *   min = 0            → optional add-ons ("Extras")
 *   min = 1, max = 1   → required single choice ("Choose your side")
 *   min = 0, max = 3   → pick up to 3
 */
export interface ModifierGroupDTO {
  id: string;
  name: string;
  min: number;
  max: number;
  options: ModifierOptionDTO[];
}
export interface MenuItemDTO {
  id: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  description?: string;
  category?: string;
  categoryId?: string;
  media: string[];
  variations: VariationDTO[];
  options?: VariantOptionDTO[];
  /** Add-on / choice groups (e.g. "Extras", "Choose a side") */
  modifierGroups?: ModifierGroupDTO[];
  /** Item-level serving hours (e.g. Friday special); empty/omitted = always */
  availability?: AvailabilityWindowDTO[];
  /** ISO time when a "sold out until tomorrow" switch turns back on (admin list) */
  soldOutUntil?: string | null;
  /** Switched off restaurant-wide (restaurants without branch records) */
  offline?: boolean;
  /** Service periods (from Settings) the item is served in */
  servicePeriodIds?: string[];
  /** Only sold between these dates (YYYY-MM-DD, inclusive) */
  availableFrom?: string;
  availableUntil?: string;
  /** Display position within its category (ascending) */
  sortOrder?: number;
  tags: string[];
  /** Star-marked by the owner: highlighted on the menu and recommended first by the virtual waiter */
  signature?: boolean;
  /** Kitchen minutes for one portion; omitted = the restaurant default (wait-time estimation) */
  prepMinutes?: number;
  /** owner = set by the restaurant, menu = printed on the menu, ai / guess = estimated */
  prepSource?: 'owner' | 'menu' | 'ai' | 'guess';
  restaurantId?: string;

  // Branch scope
  locationId?: string | null;

  // Per-channel baseline visibility (computed from item/category)
  visibility?: {
    dineIn?: boolean;
    online?: boolean;
  };

  /** Baseline channel scope */
  channel?: 'dine-in' | 'online' | 'both';

  /** ---------- Advanced availability/exclusion hints for editor ---------- */
  excludeChannel?: 'dine-in' | 'online';
  excludeAtLocationIds?: string[];
  excludeChannelAt?: 'dine-in' | 'online';
  excludeChannelAtLocationIds?: string[];
  includeLocationIds?: string[];
  excludeLocationIds?: string[];

  createdAt: string;
  updatedAt: string;
  hidden?: boolean;
  status?: 'active' | 'hidden';
}

/**
 * A time window when a category is served, e.g. Breakfast Mon–Fri 07:00–11:00.
 * days: 0 = Sunday … 6 = Saturday. end < start means the window runs past midnight.
 */
export interface AvailabilityWindowDTO {
  days: number[];
  start: string;
  end: string;
}
/** Named restaurant-wide time slot (Breakfast, Lunch…) that items/categories reference */
export interface ServicePeriodDTO {
  id: string;
  name: string;
  days: number[];
  start: string;
  end: string;
}
/** Wait-time estimation settings */
export interface KitchenSettingsDTO {
  /** Minutes for a dish that has no time of its own */
  defaultPrepMinutes: number;
  /** How many orders the kitchen cooks side by side */
  parallelOrders: number;
}
/** Virtual waiter language: Bangla or English */
export type WaiterLanguage = 'bn' | 'en';
export interface CategoryDTO {
  id: string;
  name: string;
  /** Shown under the section heading (e.g. "Served with rice") */
  description?: string;
  /** Display position (ascending) */
  sortOrder?: number;
  /** Serving hours; empty/omitted = always available */
  availability?: AvailabilityWindowDTO[];
  /** Per-branch overrides of `availability` (admin) */
  branchAvailability?: Array<{ locationId: string; availability: AvailabilityWindowDTO[] }>;
  /** True when `availability` above is a branch override (branch-scoped reads) */
  availabilityOverridden?: boolean;
  /** Service periods (from Settings) the category is served in */
  servicePeriodIds?: string[];

  /** Channel scope ('all' | 'dine-in' | 'online') */
  channelScope?: 'all' | 'dine-in' | 'online';

  /** Whether category is hidden for this branch/channel */
  hidden?: boolean;

  /** Optional overlays (for multi-location/global categories) */
  includeLocationIds?: string[];
  excludeLocationIds?: string[];

  createdAt?: string;
  updatedAt?: string;
}

/**
 Plan info exposed to the client so it can render prices/plan name.
 Store planId in formats you prefer, e.g.:
 'starter' | 'starter_m' | 'starter_y'
 'pro' | 'pro_m' | 'pro_y'
*/
export interface TenantPlanInfoDTO {
  planId: string;
}

export type SubscriptionStatus = 'none' | 'active';

export type PaymentProvider = 'none' | 'stripe' | 'adyen' | 'mock';
export type CardBrand =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'discover'
  | 'diners'
  | 'jcb'
  | 'maestro'
  | 'unionpay'
  | 'unknown';
export type FundingType = 'credit' | 'debit' | 'prepaid' | 'unknown';

export interface TenantPaymentDTO {
  provider?: PaymentProvider;
  customerId?: string;
  defaultPaymentMethodId?: string;

  brand?: CardBrand;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  country?: string;
  funding?: FundingType;

  updatedAt?: string; // ISO string
}

export type TaxExemptType = 'none' | 'exempt' | 'reverse';

export interface BillingAddressDTO {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // ISO-2
}

export interface BillingProfileDTO {
  companyName: string;
  billingEmail: string;
  extraEmails: string[];
  address: BillingAddressDTO;
  taxId?: string;
  taxExempt?: TaxExemptType;
  dunningEnabled?: boolean;
  dunningDays?: number[];
  updatedAt?: string; // ISO
}

/** Server-computed onboarding progress flags */
export interface TenantOnboardingProgressDTO {
  hasCategory: boolean;
  hasMenuItem: boolean;
  hasLocations?: boolean;
  checklist?: Record<string, boolean>;
}

export interface RestaurantInfoDTO {
  restaurantType: string;
  country: string;
  address: string;
  email?: string;
  phone?: string;
  locationMode?: 'single' | 'multiple';
  hasLocations?: boolean;
  onlineSalesEnabled?: boolean;
  dineInEnabled?: boolean;
}

export type BillingMoney = { amount: number; currency: 'BDT' | 'USD' };
export interface TenantBilling {
  planId: string | null;
  plan: string | null;
  interval: 'month' | 'year';
  listPrice: BillingMoney | null;
  customPrice: (BillingMoney & { note: string; setBy: string; at: string }) | null;
  /** what they pay: the custom price when there is one, else the list price */
  price: BillingMoney | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  /** paidUntil, or the trial's end before the first payment */
  expiresAt: string | null;
  daysLeft: number | null;
  status: 'none' | 'trial' | 'active' | 'due' | 'overdue';
}

export interface TenantDTO {
  id: string;
  name: string;
  subdomain: string;
  /** The restaurant's own domain when guests use it (connected, secured, set as the main address) — QR codes and links
   *  point there; null → "<subdomain>.qravy.com" */
  guestDomain?: string | null;
  onboardingCompleted: boolean;
  /** Menu-wide notes shown to customers (VAT, service hours, allergen info) */
  menuNotes?: string[];
  /** House facts the virtual waiter may tell guests (Wi-Fi, payment methods, parking…) */
  waiterKnowledge?: string[];
  /** Language the virtual waiter speaks by default; guests can switch it on the storefront */
  waiterLanguage?: WaiterLanguage;
  /** The browser tab's icon on the restaurant's site (null → the logo, then Qravy's) */
  faviconUrl?: string | null;
  /** The tile behind the logo on the waiter's start screen (default white) */
  logoBackground?: 'white' | 'black' | 'none';
  /** the start screen logo's corner roundness, % of its size (0 square → 50 circle); null: the default */
  logoRadius?: number | null;
  /** the start screen logo's size in px; null: the default (96) */
  logoSize?: number | null;
  /** the digits prices are shown in: 'bn' → ৳২৫০ */
  priceDigits?: 'latin' | 'bn';
  /** The restaurant's own words for guests (Settings → Guest messages); a missing one = the default */
  guestMessages?: Record<string, { bn?: string; en?: string }>;
  /** The AI waiter's name (null → "Pixie") */
  waiterName?: string | null;
  /** The AI waiter's voice */
  waiterVoice?: 'female' | 'male';
  /** The owner's own answers: when guests ask something like `question`, the waiter answers with `answer` */
  customAnswers?: Array<{ question: string; answer: string }>;
  /** The owner's upsells: a guest orders one of these dishes / a dish of these categories → the waiter offers these */
  upsellRules?: Array<{ whenItemIds: string[]; whenCategories: string[]; offerItemIds: string[]; on: boolean }>;
  /** The owner's picks: a guest asks for one of these words → the waiter shows these dishes, in this order */
  suggestRules?: Array<{ phrases: string[]; itemIds: string[]; on: boolean }>;
  /** The plan and what the restaurant pays Qravy (a custom price when one was agreed), until when, and the status
   *  from the dates — the dashboard shows a reminder when it's due or overdue (nothing is locked) */
  billing?: TenantBilling;
  /** The restaurant's logo (Settings → Branding); shown on the guest app's start screen */
  logoUrl?: string | null;
  /** IANA time zone for all hours (e.g. "Asia/Dhaka") */
  timezone?: string;
  /** Restaurant opening hours; empty = always open */
  openingHours?: AvailabilityWindowDTO[];
  /** Daily "HH:mm" when "sold out until tomorrow" items come back */
  dailyResetTime?: string;
  /** Named service periods (defaults: Breakfast, Lunch, Afternoon, Dinner, Late night) */
  servicePeriods?: ServicePeriodDTO[];
  /** 'auto' (default): categories follow their serving hours; 'manual': only their on/off switch */
  categoryHoursMode?: 'auto' | 'manual';
  /** Wait-time estimation: default minutes per dish and orders the kitchen cooks at once */
  kitchen?: KitchenSettingsDTO;
  /** Dine-in table labels; each gets a QR code ("/dine-in?table=<label>&k=<key>") */
  tables?: string[];
  /** Each table's secret QR key (staff only — never on the public tenant info) */
  tableKeys?: Record<string, string>;
  /** Two or more branches: the branch the main link orders from; null → guests pick one */
  mainBranchId?: string | null;

  // Trial info (ISO strings)
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;

  // Subscription status
  subscriptionStatus?: SubscriptionStatus;

  // Selected plan
  planInfo?: TenantPlanInfoDTO;

  // Cancellation metadata (ISO strings)
  cancelRequestedAt?: string | null;
  cancelEffectiveAt?: string | null;
  cancelAtPeriodEnd?: boolean | null;

  // Payment metadata
  hasCardOnFile?: boolean;
  payment?: TenantPaymentDTO;

  billingProfile?: BillingProfileDTO;
  onboardingProgress?: TenantOnboardingProgressDTO;
  restaurantInfo?: RestaurantInfoDTO;
  ownerInfo?: {
    fullName: string;
    phone: string;
  };

  createdAt: string;
  updatedAt: string;
}

/* Added for access feature */
export interface AccessSettingsDTO {
  centralEmail: string;
  emailVerified: boolean;
  enrollment: {
    requireOtpForNewDevice: boolean;
    requireManagerPinOnAssign: boolean;
    sessionDays: number;
    autoApproveAssignment: boolean;
  };
}

export type DeviceStatus = 'active' | 'pending' | 'revoked';
export type DeviceTrust = 'high' | 'medium' | 'low';

export interface DeviceDTO {
  id: string;
  label?: string | null;
  os?: string | null;
  browser?: string | null;
  lastSeenAt: string;
  createdAt: string;
  locationId: string | null;
  locationName?: string | null;
  status: DeviceStatus;
  trust: DeviceTrust;
  ipCountry?: string | null;
}
