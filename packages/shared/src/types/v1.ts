export type UserDTO = {
  id: string;
  email: string;
  isVerified?: boolean;
  isOnboarded?: boolean;
};

export type MenuItemDTO = {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type CategoryDTO = {
  id: string;
  name: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};