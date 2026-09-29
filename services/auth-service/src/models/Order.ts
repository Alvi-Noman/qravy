import { ObjectId } from 'mongodb';

/** Kitchen/service flow. Terminal: completed, cancelled. */
export const ORDER_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderChannel = 'dine-in' | 'online';
export type Fulfillment = 'pickup' | 'delivery';
export interface OrderCustomer {
  name: string;
  phone: string;
  /** Delivery only */
  address?: string;
}

/** One priced line — everything is a server-side snapshot taken when the order was placed. */
export interface OrderLine {
  itemId: ObjectId;
  name: string;
  qty: number;
  variation?: string;
  /** Item (or variation) price before add-ons */
  basePrice: number;
  modifiers: Array<{ groupId: string; groupName: string; optionId: string; name: string; price: number }>;
  /** basePrice + add-ons */
  unitPrice: number;
  lineTotal: number;
  notes?: string;
  /** Kitchen minutes for one portion of this line, snapshotted at placement */
  prepMinutes?: number;
}

/** Wait-time estimate (see services/orders/waitTime.ts). */
export interface OrderEta {
  /** Cooking time of this order alone */
  prepMinutes: number;
  /** Wait for a free kitchen station when it was placed */
  queueMinutes: number;
  /** What the guest was told when ordering */
  promisedReadyAt: Date;
  /** Current best estimate (moves when cooking starts or staff adjust it) */
  readyAt: Date;
  /** Minutes staff added (+) or took off (−) */
  adjustedMinutes?: number;
}

export interface OrderDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  locationId?: ObjectId | null;
  /** Branch label as the guest's link had it (display only) */
  branch?: string | null;
  channel: OrderChannel;
  /** Short, human number that resets daily per restaurant (restaurant time zone) */
  orderNumber: number;
  /** yyyy-mm-dd in the restaurant's time zone */
  businessDay: string;
  status: OrderStatus;
  statusHistory: Array<{ status: OrderStatus; at: Date; by?: string }>;
  /** Set for dine-in orders */
  dineIn?: { tableNumber: string } | null;
  /** Set for online orders: collected at the counter, or brought to the guest */
  online?: { fulfillment: Fulfillment; customer: OrderCustomer } | null;
  items: OrderLine[];
  subtotal: number;
  total: number;
  currency: 'BDT';
  /** counter = pay at the table/counter or on pickup; cod = cash on delivery */
  payment: { method: 'counter' | 'cod'; status: 'unpaid' | 'paid' };
  notes?: string;
  source: 'ai-waiter' | 'menu' | 'staff';
  /** Unguessable, lets the guest follow their order without an account */
  publicToken: string;
  /** Same key → same order (double taps, retries, voice + button at once) */
  idempotencyKey?: string;
  sessionId?: string;
  eta?: OrderEta;
  createdAt: Date;
  updatedAt: Date;
}
