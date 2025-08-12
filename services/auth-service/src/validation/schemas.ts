import { z } from 'zod';

// Schema for POST /magic-link
export const magicLinkSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// Schema for POST /me (profile update) - reserved
export const profileUpdateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().min(1, "Company is required"),
});

// Schema for POST /menu-items
export const menuItemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  price: z.coerce.number().positive('Price must be a positive number'),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
});