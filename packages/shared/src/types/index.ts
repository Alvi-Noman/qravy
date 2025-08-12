/**
 * Shared public DTO types (frontend + backend).
 */

export type UserDTO = {
  id: string;
  email: string;
  isVerified?: boolean;
  isOnboarded?: boolean;
};

export type NewMenuItemDTO = {
  name: string;
  price: number;
  description?: string;
  category?: string;
};

export type MenuItemDTO = {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
};