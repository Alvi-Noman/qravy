/**
 * Mapper utilities: Mongo Doc -> Public DTO
 */
import type { ObjectId } from 'mongodb';
import type { UserDoc } from '../models/User.js';
import type { MenuItemDoc } from '../models/MenuItem.js';
// ESM + NodeNext: must include .js extension in the import specifier.
// Path from: services/auth-service/src/utils/mapper.ts -> root -> packages/shared/src/types/index.ts
import type {
  UserDTO,
  MenuItemDTO,
} from '../../../../packages/shared/src/types/index.js';

function toId(id?: ObjectId): string {
  return id ? id.toString() : '';
}

export function toUserDTO(user: UserDoc): UserDTO {
  return {
    id: toId(user._id),
    email: user.email,
    isVerified: user.isVerified,
    isOnboarded: user.isOnboarded,
  };
}

export function toMenuItemDTO(doc: MenuItemDoc): MenuItemDTO {
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