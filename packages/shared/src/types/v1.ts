// packages/shared/src/types/v1.ts

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
  createdAt: string;
  updatedAt: string;
  hidden?: boolean;
  status?: 'active' | 'hidden';
}

export interface CategoryDTO {
  id: string;
  name: string;
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

export interface TenantDTO {
  id: string;
  name: string;
  subdomain: string;
  onboardingCompleted: boolean;

  // Trial info (ISO strings)
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;

  // Subscription status
  subscriptionStatus?: SubscriptionStatus;

  // Selected plan
  planInfo?: TenantPlanInfoDTO;

  createdAt: string;
  updatedAt: string;
}