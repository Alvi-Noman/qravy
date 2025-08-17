/**
 * Mapper utilities: Mongo Doc -> Public DTO
 */
import type { ObjectId } from 'mongodb';
import type { UserDoc } from '../models/User.js';
import type { MenuItemDoc } from '../models/MenuItem.js';
import type { CategoryDoc } from '../models/Category.js';

// ESM + NodeNext: include .js in the import specifier for backend.
// Use v1 DTOs explicitly (v2 can be added later without breaking v1).
import type { v1 } from '../../../../packages/shared/src/types/index.js';

function toId(id?: ObjectId): string {
  return id ? id.toString() : '';
}

export function toUserDTO(user: UserDoc): v1.UserDTO {
  return {
    id: toId(user._id),
    email: user.email,
    isVerified: user.isVerified,
    isOnboarded: user.isOnboarded,
  };
}

export function toMenuItemDTO(doc: MenuItemDoc): v1.MenuItemDTO {
  return {
    id: toId(doc._id),
    name: doc.name,
    price: doc.price,
    description: doc.description,
    category: doc.category,
    createdAt:
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : new Date(doc.createdAt as any).toISOString(),
    updatedAt:
      doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : new Date(doc.updatedAt as any).toISOString(),
  };
}

export function toCategoryDTO(doc: CategoryDoc): v1.CategoryDTO {
  return {
    id: toId(doc._id),
    name: doc.name,
    createdAt:
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : new Date(doc.createdAt as any).toISOString(),
    updatedAt:
      doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : new Date(doc.updatedAt as any).toISOString(),
  };
}