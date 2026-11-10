import { ObjectId } from 'mongodb';

/** How a rider gets around (shown to staff and to the guest: "Rakib · Bike"). */
export const RIDER_VEHICLES = ['bike', 'cycle', 'car', 'walk'] as const;
export type RiderVehicle = (typeof RIDER_VEHICLES)[number];

/**
 * A restaurant's own delivery rider. Riders never sign in: each has one private link (linkToken) to a page with
 * their deliveries — sent to them once on WhatsApp, reset any time (the old link stops working at once).
 */
export interface RiderDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  /** The branch they ride for; null = every branch */
  locationId?: ObjectId | null;
  name: string;
  phone: string;
  photoUrl?: string | null;
  vehicle?: RiderVehicle | null;
  /** Only riders on duty are offered when assigning */
  onDuty: boolean;
  /** The rider page's key (/rider/<linkToken>) — long and random, never the phone number */
  linkToken: string;
  /** Last time staff took the cash they were holding */
  cashHandedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Removed riders keep their history (past orders still name them) but their link stops working */
  removedAt?: Date | null;
}

/** One delivery order's trip — on the order (OrderDoc.delivery). The order's status stays the kitchen's flow;
 *  "picked up" moves it to ready (if it wasn't), "delivered" to completed. */
export interface OrderDelivery {
  riderId: ObjectId;
  /** A snapshot, so the guest's page and old orders still show who brought it if the rider is edited or removed */
  name: string;
  phone: string;
  photoUrl?: string | null;
  vehicle?: RiderVehicle | null;
  assignedAt: Date;
  assignedBy?: string;
  pickedUpAt?: Date | null;
  deliveredAt?: Date | null;
  /** Cash the rider took at the door (cash on delivery) — until staff mark it handed in */
  cashCollected?: number;
  cashSettledAt?: Date | null;
  /** "Couldn't deliver" from the rider: why, and when */
  problem?: { reason: string; note?: string; at: Date } | null;
}
