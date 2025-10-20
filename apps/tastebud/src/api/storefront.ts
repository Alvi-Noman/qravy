import axios from 'axios';
import type { v1 } from '../../../../packages/shared/src/types';

const api = axios.create({
  baseURL: '/api/v1', // gateway will proxy to auth-service
  withCredentials: true,
});

export type Channel = 'dine-in' | 'online';

export async function listMenu(channel?: Channel, locationId?: string) {
  const params: Record<string, string> = {};
  if (channel) params.channel = channel;
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/auth/menu-items', { params });
  return data.items as v1.MenuItemDTO[];
}

export async function listCategories(channel?: Channel, locationId?: string) {
  const params: Record<string, string> = {};
  if (channel) params.channel = channel;
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/auth/categories', { params });
  return data.items as v1.CategoryDTO[];
}

/** Order payloads — adjust to your backend once the orders API is ready */
export type DineInOrder = {
  channel: 'dine-in';
  tableNumber: string;
  items: Array<{ id: string; qty: number; variation?: string }>;
  notes?: string;
};
export type OnlineOrder = {
  channel: 'online';
  customer: { name: string; phone: string; address: string };
  items: Array<{ id: string; qty: number; variation?: string }>;
  notes?: string;
};

export async function placeDineInOrder(payload: DineInOrder) {
  const { data } = await api.post('/orders', payload); // TODO: ensure backend route
  return data;
}
export async function placeOnlineOrder(payload: OnlineOrder) {
  const { data } = await api.post('/orders', payload); // TODO: ensure backend route
  return data;
}
