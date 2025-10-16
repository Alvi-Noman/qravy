import { config } from 'dotenv';
import { z } from 'zod';
config();
const envSchema = z.object({
    PORT: z.string().optional(),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    NODE_ENV: z.string().optional(),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}
export const env = parsed.data;
