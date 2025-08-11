export interface MenuItem {
  _id: string;
  name: string;
  price: number;
  restaurant: string;
}


export interface AuthUser {
  id: string;
  email: string;
  isOnboarded?: boolean;
  isVerified?: boolean;
}