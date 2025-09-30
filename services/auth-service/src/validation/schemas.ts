/**
 * Validation schemas for auth-service
 */
import { z } from 'zod';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const channelEnum = z.enum(['dine-in', 'online']);

const variationSchema = z.object({
  name: z.string().min(1, 'Variation name is required'),
  price: z.coerce.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
});

const availabilityFields = {
  hidden: z.boolean().optional(),
  status: z.enum(['active', 'hidden']).optional(),
};

export const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const profileUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company: z.string().min(1, 'Company is required'),
});

export const tenantCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  subdomain: z
    .string()
    .toLowerCase()
    .trim()
    .regex(/^[a-z0-9-]{3,32}$/, 'Invalid subdomain')
    .refine((s) => !s.startsWith('-') && !s.endsWith('-') && !s.includes('--'), {
      message: 'Invalid subdomain',
    }),
});

export const menuItemSchema = z
  .object({
    name: z.string().min(1),
    price: z.coerce.number().nonnegative().optional(),
    compareAtPrice: z.coerce.number().nonnegative().optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
    media: z.array(z.string().url()).max(20).optional(),
    variations: z.array(variationSchema).max(100).optional(),
    tags: z.array(z.string().min(1).max(30)).max(100).optional(),
    restaurantId: objectId.optional(),

    // owner/admin can target a single branch (branch-scoped item)
    locationId: objectId.optional(),

    // per-channel seed (when creating under a specific channel)
    channel: channelEnum.optional(),

    // for global items, target branches explicitly
    includeLocationIds: z.array(objectId).optional(),
    excludeLocationIds: z.array(objectId).optional(),

    ...availabilityFields,
  })
  .superRefine((data, ctx) => {
    const hasProductPrice = typeof data.price === 'number';
    const hasVariantPrice =
      Array.isArray(data.variations) && data.variations.some((v) => typeof v.price === 'number');

    if (!hasProductPrice && !hasVariantPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: 'Provide a product price or at least one variation price',
      });
    }

    if (!hasProductPrice && data.compareAtPrice !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compareAtPrice'],
        message: 'compareAtPrice is only allowed with product price',
      });
    }

    if (hasProductPrice && data.compareAtPrice !== undefined && data.compareAtPrice < (data.price as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compareAtPrice'],
        message: 'compareAtPrice must be >= price',
      });
    }

    // Targeting validation
    const hasInclude = Array.isArray(data.includeLocationIds) && data.includeLocationIds.length > 0;
    const hasExclude = Array.isArray(data.excludeLocationIds) && data.excludeLocationIds.length > 0;

    if (hasInclude && hasExclude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'Provide only one of includeLocationIds or excludeLocationIds, not both',
      });
    }
    if (data.locationId && (hasInclude || hasExclude)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'include/excludeLocationIds are only valid when creating a global item (omit locationId)',
      });
    }
  });

export const menuItemUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    price: z.coerce.number().nonnegative().optional(),
    compareAtPrice: z.coerce.number().nonnegative().optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
    media: z.array(z.string().url()).max(20).optional(),
    variations: z.array(variationSchema).max(100).optional(),
    tags: z.array(z.string().min(1).max(30)).max(100).optional(),
    restaurantId: objectId.optional(),
    ...availabilityFields,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
    path: ['_'],
  })
  .superRefine((data, ctx) => {
    if (data.price !== undefined && data.compareAtPrice !== undefined && data.compareAtPrice < data.price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compareAtPrice'],
        message: 'compareAtPrice must be >= price',
      });
    }
  });

/** Bulk: availability (per-branch, per-channel) */
export const bulkAvailabilitySchema = z.object({
  ids: z.array(objectId).min(1).max(100),
  active: z.boolean(),
  locationId: objectId.optional(), // owner/admin can target a branch
  channel: channelEnum.optional(), // per-channel toggle
});

/** Bulk: delete (supports optional scope) */
export const bulkDeleteSchema = z.object({
  ids: z.array(objectId).min(1).max(100),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

/** Bulk: change category */
export const bulkCategorySchema = z
  .object({
    ids: z.array(objectId).min(1).max(100),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
  })
  .refine((d) => d.category !== undefined || d.categoryId !== undefined, {
    path: ['_'],
    message: 'Provide category or categoryId',
  });

export const categorySchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    // owner/admin can create branch-only categories
    locationId: objectId.optional(),
    // per-channel category creation (belongs to this channel only)
    channel: channelEnum.optional(),
    // for global categories, target branches explicitly
    includeLocationIds: z.array(objectId).optional(),
    excludeLocationIds: z.array(objectId).optional(),
  })
  .superRefine((data, ctx) => {
    const hasInclude = Array.isArray(data.includeLocationIds) && data.includeLocationIds.length > 0;
    const hasExclude = Array.isArray(data.excludeLocationIds) && data.excludeLocationIds.length > 0;

    if (hasInclude && hasExclude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'Provide only one of includeLocationIds or excludeLocationIds, not both',
      });
    }
    if (data.locationId && (hasInclude || hasExclude)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'include/excludeLocationIds are only valid when creating a global category (omit locationId)',
      });
    }
  });

export const categoryUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

/** Optional single-item toggles */
export const menuItemToggleSchema = z.object({
  active: z.boolean(),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

export const categoryToggleSchema = z.object({
  visible: z.boolean(),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

/** Query schemas for GET routes */
export const listMenuItemsQuerySchema = z.object({
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

export const listCategoriesQuerySchema = z.object({
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

/** NEW: Bulk category visibility (per-branch, per-channel) */
export const bulkCategoryVisibilitySchema = z.object({
  ids: z.array(objectId).min(1).max(100),
  visible: z.boolean(),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

/**
 * Restaurant onboarding
 */
export const restaurantOnboardingSchema = z.object({
  restaurantType: z.string().min(1, 'restaurantType is required'),
  country: z.string().min(1, 'country is required'),
  address: z.string().min(1, 'address is required'),
  locationMode: z.enum(['single', 'multiple']).optional(),
});