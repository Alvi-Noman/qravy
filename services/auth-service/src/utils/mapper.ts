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

    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    hidden: !!doc.hidden,
    status: (doc.status as 'active' | 'hidden') ?? (doc.hidden ? 'hidden' : 'active'),
  };

  // Merge controller-provided extras (excludeChannel, per-location tombstones, etc.)
  return { ...base, ...(extras ?? {}) };
}

/** Map a CategoryDoc into a CategoryDTO. */
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
 * Supports onboarding status, plan info, trial info, subscription status,
 * plus optional cancellation and payment metadata (non-sensitive).
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

    // optional cancellation metadata
    cancelRequestedAt: doc.cancelRequestedAt ? doc.cancelRequestedAt.toISOString() : null,
    cancelEffectiveAt: doc.cancelEffectiveAt ? doc.cancelEffectiveAt.toISOString() : null,
    cancelAtPeriodEnd: typeof doc.cancelAtPeriodEnd === 'boolean' ? doc.cancelAtPeriodEnd : null,

    // payment metadata (non-sensitive)
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
