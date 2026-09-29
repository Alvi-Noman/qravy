import { ObjectId } from 'mongodb';

export type CategoryScope = 'all' | 'location';
export type ChannelScope = 'all' | 'dine-in' | 'online';

export interface CategoryDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  createdBy?: ObjectId;

  // Branch-aware scoping
  // scope='all' -> visible to all locations
  // scope='location' -> only for the specific locationId
  scope?: CategoryScope;
  locationId?: ObjectId | null;

  // Channel-aware scoping for this category:
  // 'all' = belongs to both channels
  // 'dine-in' or 'online' = belongs only to that channel
  channelScope?: ChannelScope;

  name: string;

  /** Shown under the section heading (e.g. "All curries served with rice") */
  description?: string;
  /** Display position, ascending */
  sortOrder?: number;
  /** Serving hours; empty/missing = always available */
  availability?: Array<{ days: number[]; start: string; end: string }>;
  /** Service periods from Settings this category is served in (combined with availability) */
  servicePeriodIds?: string[];
  /** Per-branch overrides of availability ([] = always available at that branch) */
  branchAvailability?: Array<{
    locationId: ObjectId;
    availability: Array<{ days: number[]; start: string; end: string }>;
  }>;

  createdAt: Date;
  updatedAt: Date;
}