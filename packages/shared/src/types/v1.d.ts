export interface UserDTO {
    id: string;
    email: string;
    isVerified: boolean;
    tenantId: string | null;
    isOnboarded: boolean;
}
export interface VariationDTO {
    name: string;
    price?: number;
    imageUrl?: string;
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
    tags: string[];
    restaurantId?: string;
    locationId?: string | null;
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
export interface CategoryDTO {
    id: string;
    name: string;
    /** Baseline channel scope */
    channel?: 'dine-in' | 'online' | 'both';
    /** Optional overlays (only present for global categories) */
    includeLocationIds?: string[];
    excludeLocationIds?: string[];
    createdAt: string;
    updatedAt: string;
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
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'maestro' | 'unionpay' | 'unknown';
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
    updatedAt?: string;
}
export type TaxExemptType = 'none' | 'exempt' | 'reverse';
export interface BillingAddressDTO {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
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
    updatedAt?: string;
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
    locationMode?: 'single' | 'multiple';
    hasLocations?: boolean;
}
export interface TenantDTO {
    id: string;
    name: string;
    subdomain: string;
    onboardingCompleted: boolean;
    trialStartedAt?: string | null;
    trialEndsAt?: string | null;
    subscriptionStatus?: SubscriptionStatus;
    planInfo?: TenantPlanInfoDTO;
    cancelRequestedAt?: string | null;
    cancelEffectiveAt?: string | null;
    cancelAtPeriodEnd?: boolean | null;
    hasCardOnFile?: boolean;
    payment?: TenantPaymentDTO;
    billingProfile?: BillingProfileDTO;
    onboardingProgress?: TenantOnboardingProgressDTO;
    restaurantInfo?: RestaurantInfoDTO;
    createdAt: string;
    updatedAt: string;
}
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
