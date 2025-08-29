import { z } from 'zod';

/** ObjectId string schema */
const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

/** Variation schema */
const variationSchema = z.object({
  name: z.string().min(1, 'Variation name is required'),
  price: z.coerce.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
});

/** Schema for POST /magic-link */
export const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
});

/** Schema for POST /me (profile update) */
export const profileUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company: z.string().min(1, 'Company is required'),
});

/** Create menu item: price required, compareAtPrice optional */
export const menuItemSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    price: z.coerce.number().nonnegative('Price must be a non-negative number'),
    compareAtPrice: z.coerce.number().nonnegative().optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
    media: z.array(z.string().url()).max(20).optional(),
    variations: z.array(variationSchema).max(100).optional(),
    tags: z.array(z.string().min(1).max(30)).max(100).optional(),
    restaurantId: objectId.optional(),
  })
  .refine((v) => v.compareAtPrice === undefined || v.compareAtPrice >= v.price, {
    message: 'compareAtPrice must be >= price',
    path: ['compareAtPrice'],
  });

/** Update menu item: partial, keep price/compareAt if provided */
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
  .refine(
    (v) =>
      v.compareAtPrice === undefined ||
      v.price === undefined ||
      (v.compareAtPrice as number) >= (v.price as number),
    { message: 'compareAtPrice must be >= price', path: ['compareAtPrice'] }
  );

/** Category schemas */
export const categorySchema = z.object({ name: z.string().min(1, 'Name is required') });
export const categoryUpdateSchema = z.object({ name: z.string().min(1, 'Name is required') });