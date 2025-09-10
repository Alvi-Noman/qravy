export interface UserDTO {
  id: string;
  email: string;
  isVerified: boolean;
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

export interface TenantDTO {
  id: string;
  name: string;
  subdomain: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}