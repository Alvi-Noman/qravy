/**
 * Validation schemas for auth-service
 */
import { z } from 'zod';

/** ObjectId string */
const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

/** Variation shape */
const variationSchema = z.object({
  name: z.string().min(1, 'Variation name is required'),
  price: z.coerce.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
});

/** Magic link */
export const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
});

/** Profile update */
export const profileUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company: z.string().min(1, 'Company is required'),
});

/** Menu item create: product price or any variation price required */
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
  });

/** Menu item update */
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

/** Category create */
export const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

/** Category update */
export const categoryUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});