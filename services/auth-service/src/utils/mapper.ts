/**
 * Mapper utilities: Mongo Doc -> Public DTO
 */
import type { ObjectId } from 'mongodb';
import type { UserDoc } from '../models/User.js';
import type { MenuItemDoc } from '../models/MenuItem.js';
import type { CategoryDoc } from '../models/Category.js';
import type { v1 } from '../../../../packages/shared/src/types/index.js';

function toId(id?: ObjectId): string {
  return id ? id.toString() : '';
}

export function toUserDTO(user: UserDoc): v1.UserDTO {
  return {
    id: toId(user._id),
    email: user.email,
    isVerified: !!user.isVerified,
    isOnboarded: !!user.isOnboarded,
  };
}

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
    status: (doc.status as 'active' | 'hidden') ?? (doc.hidden ? 'hidden' : 'active'),
  };
}

export function toCategoryDTO(doc: CategoryDoc): v1.CategoryDTO {
  return {
    id: toId(doc._id),
    name: doc.name,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}