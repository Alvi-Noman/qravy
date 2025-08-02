import { z } from 'zod';

// Schema for POST /magic-link
export const magicLinkSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// Schema for POST /me (profile update)
export const profileUpdateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().min(1, "Company is required"),
});