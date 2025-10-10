// services/auth-service/src/utils/mapper.ts
import type { ObjectId } from 'mongodb';
import type { MenuItemDoc } from '../models/MenuItem.js';
import type { CategoryDoc } from '../models/Category.js';
import type { TenantDoc } from '../models/Tenant.js';
import type { UserDoc } from '../models/User.js';
import type { v1 } from '../../../../packages/shared/src/types/index.js';

/** Convert a MongoDB ObjectId to a string. */
function toId(id?: ObjectId): string {
  return id ? id.toString() : '';
}

/** Map a UserDoc from MongoDB into a UserDTO for external API responses. */
export function toUserDTO(user: UserDoc, tenant?: TenantDoc): v1.UserDTO {
  return {
    id: toId(user._id),
    email: user.email,
    isVerified: !!user.isVerified,
    tenantId: user.tenantId ? toId(user.tenantId) : null,
    isOnboarded: tenant?.onboardingCompleted ?? false,
  };
}

/**
 * Map a MenuItemDoc into a MenuItemDTO.
 * Accepts optional `extras` so controllers can attach advanced
 * availability/exclusion hints that the editor uses to seed its state.
 */
export function toMenuItemDTO(
  doc: MenuItemDoc,
  extras?: Partial<v1.MenuItemDTO>
): v1.MenuItemDTO {
  const scope = (doc as any).channelScope as 'dine-in' | 'online' | 'all' | undefined;

  const base: v1.MenuItemDTO = {
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

    // Branch scope
    locationId: doc.locationId ? toId(doc.locationId) : null,

    // Per-channel baseline visibility (default true if missing)
    visibility: {
      dineIn: doc.visibility?.dineIn ?? true,
      online: doc.visibility?.online ?? true,
    },

    // NEW: baseline channel scope
    channel: scope === 'all' || scope == null ? 'both' : scope,

    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    hidden: !!doc.hidden,
    status: (doc.status as 'active' | 'hidden') ?? (doc.hidden ? 'hidden' : 'active'),
  };

  // Merge controller-provided extras (excludeChannel, per-location tombstones, etc.)
  return { ...base, ...(extras ?? {}) };
}

/** Local extension of CategoryDTO with advanced fields */
export type CategoryDTOWithExtras = v1.CategoryDTO & {
  channel?: 'dine-in' | 'online' | 'both';
  includeLocationIds?: string[];
  excludeLocationIds?: string[];
};

/** Map a CategoryDoc into a CategoryDTO with extras. */
export function toCategoryDTO(doc: CategoryDoc): CategoryDTOWithExtras {
  const scope = (doc as any).channelScope as 'dine-in' | 'online' | 'all' | undefined;

  return {
    id: toId(doc._id),
    name: doc.name,

    // NEW: expose channelScope to client
    channel: scope === 'all' || scope == null ? 'both' : scope,

    // Optional overlays (only present for global categories)
    includeLocationIds: (doc as any).includeLocationIds?.map(toId),
    excludeLocationIds: (doc as any).excludeLocationIds?.map(toId),

    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Map a TenantDoc into a TenantDTO.
 */
export function toTenantDTO(doc: TenantDoc): v1.TenantDTO {
  const paymentUpdatedAt =
    doc.payment?.updatedAt instanceof Date
      ? doc.payment.updatedAt.toISOString()
      : doc.payment?.updatedAt
      ? String(doc.payment.updatedAt)
      : undefined;

  return {
    id: toId(doc._id),
    name: doc.name,
    subdomain: doc.subdomain,
    onboardingCompleted: !!doc.onboardingCompleted,

    // trial info
    trialStartedAt: doc.trialStartedAt ? doc.trialStartedAt.toISOString() : null,
    trialEndsAt: doc.trialEndsAt ? doc.trialEndsAt.toISOString() : null,

    // plan info
    planInfo: doc.planInfo ? { planId: doc.planInfo.planId } : undefined,

    // subscription status
    subscriptionStatus: doc.subscriptionStatus ?? 'none',

    // Server-computed onboarding progress
    onboardingProgress: doc.onboardingProgress
      ? {
          hasCategory: !!doc.onboardingProgress.hasCategory,
          hasMenuItem: !!doc.onboardingProgress.hasMenuItem,
          hasLocations: !!doc.onboardingProgress.hasLocations,
          checklist: doc.onboardingProgress.checklist,
        }
      : undefined,

    // Restaurant info
    restaurantInfo: doc.restaurantInfo
      ? {
          restaurantType: doc.restaurantInfo.restaurantType,
          country: doc.restaurantInfo.country,
          address: doc.restaurantInfo.address,
          locationMode: doc.restaurantInfo.locationMode,
          hasLocations: !!doc.restaurantInfo.hasLocations,
        }
      : undefined,

    cancelRequestedAt: doc.cancelRequestedAt ? doc.cancelRequestedAt.toISOString() : null,
    cancelEffectiveAt: doc.cancelEffectiveAt ? doc.cancelEffectiveAt.toISOString() : null,
    cancelAtPeriodEnd: typeof doc.cancelAtPeriodEnd === 'boolean' ? doc.cancelAtPeriodEnd : null,

    hasCardOnFile: !!doc.hasCardOnFile,
    payment: doc.payment
      ? {
          provider: doc.payment.provider ?? 'mock',
          customerId: doc.payment.customerId,
          defaultPaymentMethodId: doc.payment.defaultPaymentMethodId,
          brand: doc.payment.brand ?? 'unknown',
          last4: doc.payment.last4,
          expMonth: doc.payment.expMonth,
          expYear: doc.payment.expYear,
          country: doc.payment.country,
          funding: doc.payment.funding ?? 'unknown',
          updatedAt: paymentUpdatedAt,
        }
      : undefined,

    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
