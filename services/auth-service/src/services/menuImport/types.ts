/**
 * Types for the AI menu import pipeline.
 *
 * Raw*   = what the extractor (LLM) returns, loosely trusted.
 * Draft* = normalized, editable menu the owner reviews before commit.
 *          Fields map 1:1 onto menuItemSchema / categorySchema.
 */

/* ----------------------------- Extractor output ---------------------------- */

export type RawOption = { name: string; values: string[] };
export type RawVariant = { optionValues: string[]; price: number | null; prepMinutes?: number | null };
export type RawAddOnGroup = {
  name: string;
  min: number;
  max: number;
  options: Array<{ name: string; price: number | null }>;
};

export type RawItem = {
  name: string;
  description: string | null;
  price: number | null;
  compareAtPrice: number | null;
  priceText: string | null;
  options: RawOption[];
  variants: RawVariant[];
  tags: string[];
  addOnGroups: RawAddOnGroup[];
  /** Dish-level serving times ("Fridays only", "Lunch 12–3pm") */
  hours: Array<{ days: number[]; start: string; end: string }>;
  /** Kitchen minutes for one portion — printed on the menu, or a typical time for this kind of dish */
  prepMinutes?: number | null;
  prepSource?: 'printed' | 'estimated' | null;
  confidence: 'high' | 'low';
  issues: string[];
  page: number; // 1-based page inside the chunk
};

export type RawCategory = {
  name: string;
  description: string | null;
  /** Add-ons printed for the whole section (apply to every item in it). */
  addOnGroups: RawAddOnGroup[];
  /** Serving hours printed for the section ("Breakfast 7–11am") */
  hours: Array<{ days: number[]; start: string; end: string }>;
  items: RawItem[];
};

export type RawMenu = {
  currency: string | null;
  /** Menu-wide notes: VAT/service charge, hours, allergen legend… */
  notes: string[];
  categories: RawCategory[];
};

export type ExtractUsage = { inputTokens: number; outputTokens: number };

/* ---------------------------------- Draft ---------------------------------- */

export type DraftVariation = {
  name: string;
  price?: number;
  imageUrl?: string;
  optionValues?: string[];
  prepMinutes?: number;
};

/** Add-on / choice group (ids are assigned by the server on commit). */
export type DraftModifierGroup = {
  id?: string;
  name: string;
  min: number;
  max: number;
  options: Array<{ id?: string; name: string; price: number }>;
};

export type DraftItemAction = 'create' | 'update' | 'skip';

export type DraftItem = {
  tempId: string;
  name: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  options: Array<{ name: string; values: string[] }>;
  variations: DraftVariation[];
  tags: string[];
  media: string[];
  modifierGroups: DraftModifierGroup[];
  /** Item serving hours; empty/missing = whenever its category is served */
  availability?: Array<{ days: number[]; start: string; end: string }>;
  /** Kitchen minutes for one portion (wait-time estimation) */
  prepMinutes?: number;
  /** The menu didn't print a time — this is a typical time for the dish (owner should check) */
  prepEstimated?: boolean;
  /** Legacy: free-text add-ons from older imports (now parsed into modifierGroups). */
  addOnsNote?: string;
  confidence: 'high' | 'low';
  issues: string[];
  sourcePage?: number;
  /** Existing item with the same name in the matched category. */
  duplicateOfItemId?: string | null;
  action: DraftItemAction;
};

export type DraftCategory = {
  tempId: string;
  name: string;
  description?: string;
  /** Existing category to merge into; null/undefined → create new. */
  matchCategoryId?: string | null;
  /** Serving hours; empty = always available */
  availability?: Array<{ days: number[]; start: string; end: string }>;
  items: DraftItem[];
};

export type DraftMenu = {
  currency?: string;
  /** Menu-wide notes to show customers */
  notes?: string[];
  categories: DraftCategory[];
};

/* ---------------------------------- Commit --------------------------------- */

export type CommitResult = {
  categoriesCreated: number;
  categoriesMerged: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: Array<{ tempId: string; name: string; message: string }>;
};
