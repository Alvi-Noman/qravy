import type { ObjectId } from 'mongodb';
import type { MenuItemDoc } from '../models/MenuItem.js';
import type { CategoryDoc } from '../models/Category.js';
import type { TenantDoc } from '../models/Tenant.js';
import type { UserDoc } from '../models/User.js';
import type { v1 } from '../../../../packages/shared/src/types/index.js';

/**
 * Convert a MongoDB ObjectId to a string.
 * Ensures frontend receives strings (not ObjectId objects) in DTOs.
 */
function toId(id?: ObjectId): string {
  return id ? id.toString() : '';
}

/**
 * Map a UserDoc from MongoDB into a UserDTO for external API responses.
 * 
 * @param user - User document from MongoDB
 * @param tenant - Optional tenant document context (to resolve onboarding status)
 * @returns UserDTO object safe for external consumers
 */
export function toUserDTO(user: UserDoc, tenant?: TenantDoc): v1.UserDTO {
  return {
    id: toId(user._id),
    email: user.email,
    isVerified: !!user.isVerified,
    tenantId: user.tenantId ? toId(user.tenantId) : null,
    // isOnboarded reflects the tenant’s onboardingCompleted flag
    isOnboarded: tenant?.onboardingCompleted ?? false,
  };
}

/**
 * Map a MenuItemDoc into a MenuItemDTO.
 * 
 * Ensures numeric conversions, array defaults, and consistent date serialization.
 * 
 * @param doc - MongoDB document of a menu item
 * @returns MenuItemDTO object formatted for API responses
 */
export function toMenuItemDTO(doc: MenuItemDoc): v1.MenuItemDTO {
  return {
    id: toId(doc._id),
    name: doc.name,
    price: doc.price as number,
    compareAtPrice: doc.compareAtPrice,
    description: doc.description,
    category: doc.category,
    categoryId: toId(doc.categoryId),
    media: doc.media ?? [],
    variations: (doc.variations ?? []).map((v) => ({
      name: v.name,
      price: v.price,
      imageUrl: v.imageUrl,
    })),
    tags: doc.tags ?? [],
    restaurantId: toId(doc.restaurantId),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    hidden: !!doc.hidden,
    // Normalize status - fallback ensures compatibility with older records
    status: (doc.status as 'active' | 'hidden') ?? (doc.hidden ? 'hidden' : 'active'),
  };
}

/**
 * Map a CategoryDoc into a CategoryDTO.
 *
 * @param doc - MongoDB document of a category
 * @returns CategoryDTO object safe for API consumers
 */
export function toCategoryDTO(doc: CategoryDoc): v1.CategoryDTO {
  return {
    id: toId(doc._id),
    name: doc.name,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Map a TenantDoc into a TenantDTO.
 * 
 * Supports onboarding status (used to determine which dashboard UI to render).
 * 
 * @param doc - Tenant MongoDB document
 * @returns TenantDTO object formatted for API consumption
 */
export function toTenantDTO(doc: TenantDoc): v1.TenantDTO {
  return {
    id: toId(doc._id),
    name: doc.name,
    subdomain: doc.subdomain,
    onboardingCompleted: !!doc.onboardingCompleted,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}