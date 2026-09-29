import { ObjectId } from 'mongodb';

export type ItemScope = 'all' | 'location';
export type Channel = 'dine-in' | 'online';

export interface VariantOption {
  name: string;
  values: string[];
}

export interface Variation {
  name: string;
  price?: number;
  imageUrl?: string;
  // One value per entry in MenuItemDoc.options (same order)
  optionValues?: string[];
  /** Kitchen time for this size when it differs from the item's (e.g. a large pizza) */
  prepMinutes?: number;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number; // surcharge, 0 for free choices
}

/** Add-on / choice group: min=0 optional extras, min=1,max=1 required single choice. */
export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: ModifierOption[];
}

export interface MenuItemDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  restaurantId?: ObjectId;

  // Branch-aware scoping
  // scope='all' -> visible to all locations
  // scope='location' -> only for the specific locationId
  scope?: ItemScope;
  locationId?: ObjectId | null;

  // Channel-aware baseline visibility (per-channel default)
  // If omitted, treat both channels as visible by default.
  visibility?: {
    dineIn?: boolean;  // default true if undefined
    online?: boolean;  // default true if undefined
  };

  name: string;
  price?: number;
  compareAtPrice?: number;
  description?: string;

  category?: string;
  categoryId?: ObjectId;

  media?: string[];
  variations?: Variation[];
  options?: VariantOption[];
  modifierGroups?: ModifierGroup[];
  /** Display position within its category, ascending */
  sortOrder?: number;
  /**
   * Switched off for the whole restaurant. Used when the restaurant has no
   * branch records (per-branch switches live in itemAvailability overlays).
   */
  offline?: boolean;
  /** "Sold out today": switch back on at this time */
  offlineResumeAt?: Date;
  /** Item-level custom hours (e.g. Friday special); combined with servicePeriodIds */
  availability?: Array<{ days: number[]; start: string; end: string }>;
  /** Service periods from Settings (Breakfast, Lunch…) this item is served in */
  servicePeriodIds?: string[];
  /** Only sold between these dates, "YYYY-MM-DD" inclusive (restaurant time zone) */
  availableFrom?: string;
  availableUntil?: string;
  tags?: string[];
  /** Star-marked signature dish (menu badge + first in virtual-waiter recommendations) */
  signature?: boolean;
  /** Minutes the kitchen needs for one portion (wait-time estimation); missing = restaurant default */
  prepMinutes?: number;
  /** Where prepMinutes came from: owner/menu are never overwritten; ai/guess are estimates */
  prepSource?: 'owner' | 'menu' | 'ai' | 'guess';

  // Legacy/global flags. Derived per-view; kept for backward-compat.
  hidden?: boolean;
  status?: 'active' | 'hidden';

  createdAt: Date;
  updatedAt: Date;
}