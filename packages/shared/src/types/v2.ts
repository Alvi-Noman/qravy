// packages/shared/src/types/v2.ts
import type * as v1 from './v1.js';

export type UserDTO = v1.UserDTO;
export type TenantDTO = v1.TenantDTO;

// Example evolution: add currency
export type MenuItemDTO = Omit<v1.MenuItemDTO, 'price'> & {
  price: number;
  currency: string;
};

export type CategoryDTO = v1.CategoryDTO;