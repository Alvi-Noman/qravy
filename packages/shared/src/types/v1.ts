/** Public user shape */
export interface UserDTO {
  id: string;
  email: string;
  isVerified: boolean;
  isOnboarded: boolean;
}

/** Public variation shape */
export interface VariationDTO {
  name: string;
  price?: number;
  imageUrl?: string;
}

/** Public menu item shape */
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
}

/** Public category shape */
export interface CategoryDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}