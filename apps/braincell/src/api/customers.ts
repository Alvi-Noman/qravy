// apps/braincell/src/api/customers.ts — the restaurant's online customers (auth-service routes/customersRoutes.ts):
// delivery guests (name, phone, address) and pickup guests (name, phone). Dine-in guests aren't saved.
import api from './auth';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  /** delivery addresses, newest first */
  addresses: string[];
  lastFulfillment: 'delivery' | 'pickup';
  orders: number;
  deliveries: number;
  pickups: number;
  spent: number;
  firstOrderAt: string;
  lastOrderAt: string;
};

export async function listCustomers(params: { q?: string; limit?: number; skip?: number }): Promise<{ items: Customer[]; total: number }> {
  const res = await api.get('/api/v1/customers', { params });
  return { items: (res.data?.items ?? []) as Customer[], total: Number(res.data?.total ?? 0) };
}
