// apps/braincell/src/api/customers.ts — the restaurant's online customers (auth-service routes/customersRoutes.ts):
// delivery guests (name, phone, address) and pickup guests (name, phone). Dine-in guests aren't saved.
import api from './auth';
import type { AdminOrder } from './orders';

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

export type CustomerDetail = Customer & {
  favourites: Array<{ name: string; qty: number }>;
  averageOrder: number;
  cancelled: number;
  history: AdminOrder[];
};

/** One customer — profile, numbers, favourite dishes and every order (newest first). */
export async function getCustomer(id: string): Promise<CustomerDetail> {
  const res = await api.get(`/api/v1/customers/${encodeURIComponent(id)}`);
  return res.data?.customer as CustomerDetail;
}

export async function listCustomers(params: { q?: string; limit?: number; skip?: number }): Promise<{ items: Customer[]; total: number }> {
  const res = await api.get('/api/v1/customers', { params });
  return { items: (res.data?.items ?? []) as Customer[], total: Number(res.data?.total ?? 0) };
}
