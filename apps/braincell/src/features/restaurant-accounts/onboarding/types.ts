export type PlanId = 'p1' | 'p2';

export interface OwnerAdminInfo {
  fullName: string;
  phone: string;
}

export interface RestaurantInfo {
  restaurantType: string;
  country: string;
  address: string;
  locationMode?: 'single' | 'multiple';  
}

export interface PlanInfo {
  planId: PlanId | null;
}

export interface OnboardingState {
  owner: OwnerAdminInfo;
  restaurant: RestaurantInfo;
  plan: PlanInfo;
}