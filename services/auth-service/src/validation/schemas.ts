/**
 * Validation schemas for auth-service
 */
import { z } from 'zod';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
export const channelEnum = z.enum(['dine-in', 'online']);
// NEW: category channel can also allow "both"
export const categoryChannelEnum = z.enum(['dine-in', 'online', 'both']);

const variationSchema = z.object({
  name: z.string().min(1, 'Variation name is required'),
  price: z.coerce.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  optionValues: z.array(z.string().min(1).max(60)).max(10).optional(),
  prepMinutes: z.coerce.number().int().min(1).max(240).optional(),
});

/** Kitchen minutes for one portion (wait-time estimation); null clears on update */
const prepMinutesField = z.coerce.number().int().min(1, "At least 1 minute").max(240, "At most 240 minutes");

const variantOptionSchema = z.object({
  name: z.string().trim().min(1, 'Option name is required').max(60),
  values: z.array(z.string().trim().min(1).max(60)).min(1, 'Add at least one option value').max(50),
});

const modifierGroupSchema = z
  .object({
    id: z.string().max(40).optional(),
    name: z.string().trim().min(1, 'Add-on group name is required').max(60),
    min: z.coerce.number().int().min(0).max(50),
    max: z.coerce.number().int().min(1).max(50),
    options: z
      .array(
        z.object({
          id: z.string().max(40).optional(),
          name: z.string().trim().min(1, 'Add-on name is required').max(60),
          price: z.coerce.number().nonnegative().max(1_000_000),
        })
      )
      .min(1, 'Add at least one option')
      .max(50),
  })
  .refine((g) => g.min <= g.max, { message: 'Minimum cannot be more than maximum', path: ['min'] })
  .refine((g) => g.max <= g.options.length, { message: 'Maximum cannot exceed the number of options', path: ['max'] });

/** Serving-hours window: days 0 (Sun)–6 (Sat), "HH:mm" times; end < start runs past midnight */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const availabilityWindowSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day').max(7),
    start: timeOfDay,
    end: timeOfDay,
  })
  .refine((w) => w.start !== w.end, { message: 'Start and end must differ', path: ['end'] });

const periodIdsSchema = z.array(z.string().trim().min(1).max(40)).max(12);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const itemTimingFields = {
  servicePeriodIds: periodIdsSchema.optional(),
  /** null clears */
  availableFrom: dateOnly.nullable().optional(),
  availableUntil: dateOnly.nullable().optional(),
};
export const servicePeriodSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1, 'Give the period a name').max(40),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: timeOfDay,
  end: timeOfDay,
});

const categoryExtraFields = {
  servicePeriodIds: periodIdsSchema.optional(),
  description: z.string().max(500).optional(),
  availability: z.array(availabilityWindowSchema).max(7).optional(),
  /** Branch override: availability null → use the shared hours again */
  branchAvailability: z
    .object({ locationId: objectId, availability: z.array(availabilityWindowSchema).max(7).nullable() })
    .optional(),
};

const availabilityFields = {
  hidden: z.boolean().optional(),
  status: z.enum(['active', 'hidden']).optional(),
};

export const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const profileUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company: z.string().min(1, 'Company is required'),
});

export const tenantCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  subdomain: z
    .string()
    .toLowerCase()
    .trim()
    .regex(/^[a-z0-9-]{3,32}$/, 'Invalid subdomain')
    .refine((s) => !s.startsWith('-') && !s.endsWith('-') && !s.includes('--'), {
      message: 'Invalid subdomain',
    }),
  dineInEnabled: z.boolean().optional(),
  onlineSalesEnabled: z.boolean().optional(),
});

export const menuItemSchema = z
  .object({
    name: z.string().min(1),
    price: z.coerce.number().nonnegative().optional(),
    compareAtPrice: z.coerce.number().nonnegative().optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
    media: z.array(z.string().url()).max(20).optional(),
    variations: z.array(variationSchema).max(250).optional(),
    options: z.array(variantOptionSchema).max(10).optional(),
    modifierGroups: z.array(modifierGroupSchema).max(20).optional(),
    availability: z.array(availabilityWindowSchema).max(7).optional(),
    ...itemTimingFields,
    tags: z.array(z.string().min(1).max(30)).max(100).optional(),
    signature: z.boolean().optional(),
    prepMinutes: prepMinutesField.optional(),
    /** Import: printed on the menu vs estimated by the AI (manual saves are the owner's) */
    prepSource: z.enum(['menu', 'ai']).optional(),
    restaurantId: objectId.optional(),

    // owner/admin can target a single branch (branch-scoped item)
    locationId: objectId.optional(),

    // per-channel seed (when creating under a specific channel)
    channel: channelEnum.optional(),

    // for global items, target branches explicitly
    includeLocationIds: z.array(objectId).optional(),
    excludeLocationIds: z.array(objectId).optional(),

    // ---------- NEW: item-level channel exclusion controls ----------
    // exclude one channel globally (e.g., hide from 'online' everywhere)
    excludeChannel: channelEnum.optional(),
    // exclude item entirely at these locations (both channels)
    excludeAtLocationIds: z.array(objectId).optional(),
    // exclude a specific channel at specific locations
    excludeChannelAt: channelEnum.optional(),
    excludeChannelAtLocationIds: z.array(objectId).optional(),
    // ----------------------------------------------------------------

    ...availabilityFields,
  })
  .superRefine((data, ctx) => {
    if (data.availableFrom && data.availableUntil && data.availableFrom > data.availableUntil) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['availableUntil'], message: 'End date is before start date' });
    }
    const hasProductPrice = typeof data.price === 'number';
    const hasVariantPrice =
      Array.isArray(data.variations) && data.variations.some((v) => typeof v.price === 'number');

    if (!hasProductPrice && !hasVariantPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: 'Provide a product price or at least one variation price',
      });
    }

    if (!hasProductPrice && data.compareAtPrice !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compareAtPrice'],
        message: 'compareAtPrice is only allowed with product price',
      });
    }

    if (hasProductPrice && data.compareAtPrice !== undefined && data.compareAtPrice < (data.price as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compareAtPrice'],
        message: 'compareAtPrice must be >= price',
      });
    }

    // Targeting validation
    const hasInclude = Array.isArray(data.includeLocationIds) && data.includeLocationIds.length > 0;
    const hasExclude = Array.isArray(data.excludeLocationIds) && data.excludeLocationIds.length > 0;

    if (hasInclude && hasExclude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'Provide only one of includeLocationIds or excludeLocationIds, not both',
      });
    }
    if (data.locationId && (hasInclude || hasExclude)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'include/excludeLocationIds are only valid when creating a global item (omit locationId)',
      });
    }

    // Light coupling checks for the new fields (non-blocking but helpful)
    if (
      Array.isArray(data.excludeChannelAtLocationIds) &&
      data.excludeChannelAtLocationIds.length > 0 &&
      !data.excludeChannelAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['excludeChannelAt'],
        message: 'excludeChannelAt is required when excludeChannelAtLocationIds is provided',
      });
    }
  });

export const menuItemUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    price: z.coerce.number().nonnegative().optional(),
    compareAtPrice: z.coerce.number().nonnegative().optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
    media: z.array(z.string().url()).max(20).optional(),
    variations: z.array(variationSchema).max(250).optional(),
    options: z.array(variantOptionSchema).max(10).optional(),
    modifierGroups: z.array(modifierGroupSchema).max(20).optional(),
    availability: z.array(availabilityWindowSchema).max(7).optional(),
    ...itemTimingFields,
    tags: z.array(z.string().min(1).max(30)).max(100).optional(),
    signature: z.boolean().optional(),
    prepMinutes: prepMinutesField.nullable().optional(),
    restaurantId: objectId.optional(),

    // ---------- NEW: allow updating item-level channel exclusions ----------
    excludeChannel: channelEnum.optional(),
    excludeAtLocationIds: z.array(objectId).optional(),
    excludeChannelAt: channelEnum.optional(),
    excludeChannelAtLocationIds: z.array(objectId).optional(),
    // ----------------------------------------------------------------------

    ...availabilityFields,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
    path: ['_'],
  })
  .superRefine((data, ctx) => {
    if (data.price !== undefined && data.compareAtPrice !== undefined && data.compareAtPrice < data.price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compareAtPrice'],
        message: 'compareAtPrice must be >= price',
      });
    }
    if (
      Array.isArray(data.excludeChannelAtLocationIds) &&
      data.excludeChannelAtLocationIds.length > 0 &&
      !data.excludeChannelAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['excludeChannelAt'],
        message: 'excludeChannelAt is required when excludeChannelAtLocationIds is provided',
      });
    }
  });

/** Bulk: availability (per-branch, per-channel) */
export const bulkAvailabilitySchema = z.object({
  /** With active:false — switch back on automatically at the next daily reset */
  untilReset: z.boolean().optional(),
  ids: z.array(objectId).min(1).max(100),
  active: z.boolean(),
  locationId: objectId.optional(), // owner/admin can target a branch
  channel: channelEnum.optional(), // per-channel toggle
});

/** Bulk: delete (supports optional scope) */
export const bulkDeleteSchema = z.object({
  ids: z.array(objectId).min(1).max(100),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

/** Bulk: change category */
export const bulkCategorySchema = z
  .object({
    ids: z.array(objectId).min(1).max(100),
    category: z.string().max(100).optional(),
    categoryId: objectId.optional(),
  })
  .refine((d) => d.category !== undefined || d.categoryId !== undefined, {
    path: ['_'],
    message: 'Provide category or categoryId',
  });

export const categorySchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    // owner/admin can create branch-only categories
    locationId: objectId.optional(),
    // per-channel category creation (belongs to this channel only)
    channel: categoryChannelEnum.optional(), // ✅ changed
    // for global categories, target branches explicitly
    includeLocationIds: z.array(objectId).optional(),
    excludeLocationIds: z.array(objectId).optional(),
    ...categoryExtraFields,
  })
  .superRefine((data, ctx) => {
    const hasInclude = Array.isArray(data.includeLocationIds) && data.includeLocationIds.length > 0;
    const hasExclude = Array.isArray(data.excludeLocationIds) && data.excludeLocationIds.length > 0;

    if (hasInclude && hasExclude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'Provide only one of includeLocationIds or excludeLocationIds, not both',
      });
    }
    if (data.locationId && (hasInclude || hasExclude)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message:
          'include/excludeLocationIds are only valid when creating a global category (omit locationId)',
      });
    }
  });

/**
 * Advanced Edit: allow channel + include/exclude locations on update.
 * All fields are optional; at least one must be provided.
 */
export const categoryUpdateSchema = z
  .object({
    name: z.string().min(1, 'Name is required').optional(),
    channel: categoryChannelEnum.optional(), // ✅ changed
    includeLocationIds: z.array(objectId).optional(),
    excludeLocationIds: z.array(objectId).optional(),
    ...categoryExtraFields,
  })
  .superRefine((data, ctx) => {
    const hasInclude = Array.isArray(data.includeLocationIds) && data.includeLocationIds.length > 0;
    const hasExclude = Array.isArray(data.excludeLocationIds) && data.excludeLocationIds.length > 0;
    if (hasInclude && hasExclude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeLocationIds'],
        message: 'Provide only one of includeLocationIds or excludeLocationIds, not both',
      });
    }
    if (
      data.name === undefined &&
      data.channel === undefined &&
      data.description === undefined &&
      data.availability === undefined &&
      data.servicePeriodIds === undefined &&
      data.branchAvailability === undefined &&
      !hasInclude &&
      !hasExclude
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['_'],
        message: 'At least one field (name, channel, includeLocationIds, excludeLocationIds) must be provided to update',
      });
    }
  });

/** Optional single-item toggles */
export const menuItemToggleSchema = z.object({
  active: z.boolean(),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

export const categoryToggleSchema = z.object({
  visible: z.boolean(),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

/** Query schemas for GET routes */
export const listMenuItemsQuerySchema = z.object({
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
});

export const listCategoriesQuerySchema = z.object({
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
  // allow fetching specific category by name (used by getCategoryByName)
  name: z.string().optional(),
});

/** NEW: Bulk category visibility (per-branch, per-channel) */
export const bulkCategoryVisibilitySchema = z.object({
  ids: z.array(objectId).min(1).max(100),
  visible: z.boolean(),
  locationId: objectId.optional(),
  channel: channelEnum.optional(),
  // optional: true exclusion/tombstone (matches controller support)
  hardExclude: z.boolean().optional(),
});

/**
 * Restaurant onboarding
 */
export const restaurantOnboardingSchema = z.object({
  restaurantType: z.string().min(1, 'restaurantType is required'),
  country: z.string().min(1, 'country is required'),
  address: z.string().min(1, 'address is required'),
  locationMode: z.enum(['single', 'multiple']).optional(),
});

export const tenantUpdateSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100).optional(),
    restaurantInfo: z
      .object({
        restaurantType: z.string().min(1).optional(),
        country: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        email: z.string().email('Invalid email address').optional().or(z.literal('')),
        phone: z.string().optional(),
        locationMode: z.enum(['single', 'multiple']).optional(),
        dineInEnabled: z.boolean().optional(),
        onlineSalesEnabled: z.boolean().optional(),
      })
      .optional(),
    ownerInfo: z
      .object({
        fullName: z.string().min(1).optional(),
        phone: z.string().min(1).optional(),
      })
      .optional(),
    menuNotes: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
    waiterKnowledge: z.array(z.string().trim().min(1).max(500)).max(40).optional(),
    waiterLanguage: z.enum(['bn', 'en']).optional(),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Unknown time zone')
      .optional(),
    openingHours: z.array(availabilityWindowSchema).max(7).optional(),
    dailyResetTime: timeOfDay.optional(),
    servicePeriods: z.array(servicePeriodSchema).max(12).optional(),
    kitchen: z
      .object({
        defaultPrepMinutes: prepMinutesField,
        parallelOrders: z.coerce.number().int().min(1).max(50),
      })
      .optional(),
    // Same shape the guest app accepts from ?table= (apps/tastebud/src/utils/table.ts)
    tables: z
      .array(z.string().trim().regex(/^#?[A-Za-z0-9-]{1,12}$/, 'Table names: letters, numbers and dashes (max 12)'))
      .max(500)
      .optional(),
    // The restaurant's logo (an uploaded image's URL) — the guest app's start screen shows it; null removes it
    logoUrl: z.string().trim().url('Logo must be an image link').max(1000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.restaurantInfo) {
      const { dineInEnabled, onlineSalesEnabled } = data.restaurantInfo;
      if (dineInEnabled === false && onlineSalesEnabled === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['restaurantInfo', 'dineInEnabled'],
          message: 'At least one ordering channel (Dine-in or Online sales) must be enabled',
        });
      }
    }
  });

/** One requested line. Prices are NEVER taken from the client — the server recomputes them. */
const orderLineSchema = z.object({
  itemId: objectId,
  qty: z.coerce.number().int().min(1).max(50),
  variation: z.string().trim().max(80).nullable().optional(),
  modifiers: z
    .array(
      z.object({
        groupId: z.string().min(1).max(40),
        optionId: z.string().min(1).max(40).optional(),
        optionIds: z.array(z.string().min(1).max(40)).max(50).optional(),
      })
    )
    .max(100)
    .optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** Staff enter an order (authenticated; tenant comes from the session) */
export const orderCreateSchema = z.object({
  table: z.string().trim().min(1, 'table is required').max(20),
  items: z.array(orderLineSchema).min(1, 'At least one item is required').max(50),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
  locationId: objectId.optional(),
});

/**
 * Guest places an order: dine-in from the table's QR link (pay at the counter), or online for
 * pickup / delivery with contact details. Missing table / name / phone / address are reported by
 * createOrderCore with a `needs` hint so the client can focus that field.
 */
export const publicOrderCreateSchema = z.object({
  subdomain: z.string().trim().min(1),
  branch: z.string().trim().max(80).nullable().optional(),
  channel: z.enum(['dine-in', 'online']).optional(),
  table: z.string().trim().max(20).nullable().optional(),
  tableKey: z.string().trim().max(40).nullable().optional(),
  fulfillment: z.enum(['pickup', 'delivery']).nullable().optional(),
  customer: z
    .object({
      name: z.string().trim().max(80).optional(),
      phone: z.string().trim().max(30).optional(),
      address: z.string().trim().max(300).nullable().optional(),
    })
    .nullable()
    .optional(),
  items: z.array(orderLineSchema).min(1, 'Your order is empty').max(50),
  notes: z.string().trim().max(500).nullable().optional(),
  sessionId: z.string().trim().max(100).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(100).nullable().optional(),
  source: z.enum(['ai-waiter', 'menu']).optional(),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled']),
});

/** Staff push the ready time back (+) or forward (−), e.g. "kitchen is slammed, +10 min" */
export const orderEtaUpdateSchema = z.object({
  addMinutes: z.coerce.number().int().min(-60).max(120).refine((n) => n !== 0, 'Add or remove at least a minute'),
});

/** Settings → Kitchen: AI prep times for dishes without one (ids = only these; redoAi = refresh AI estimates too) */
export const prepEstimateSchema = z.object({
  ids: z.array(objectId).max(2000).optional(),
  redoAi: z.boolean().optional(),
});

/** Item modal: "Ask AI" for a dish that isn't saved yet */
export const prepSuggestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().max(100).optional(),
  description: z.string().max(2000).optional(),
  sizes: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

/** Guest asks "how long would this take?" before ordering (cart / tray) */
export const publicWaitTimeSchema = z.object({
  subdomain: z.string().trim().min(1),
  branch: z.string().trim().max(80).nullable().optional(),
  items: z
    .array(z.object({ itemId: objectId, qty: z.coerce.number().int().min(1).max(50), variation: z.string().trim().max(80).nullable().optional() }))
    .max(50)
    .default([]),
});

export const publicMenuQuerySchema = z.object({
  subdomain: z.string().min(1),
  branch: z.string().optional(),
  channel: channelEnum.optional(),
});
/* ---------------------------- Menu import (PDF) ---------------------------- */

const draftItemSchema = z.object({
  tempId: z.string().min(1).max(64),
  name: z.string().trim().max(100),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative().optional(),
  compareAtPrice: z.number().nonnegative().optional(),
  options: z.array(variantOptionSchema).max(10),
  variations: z.array(variationSchema).max(250),
  modifierGroups: z.array(modifierGroupSchema).max(20).default([]),
  prepMinutes: prepMinutesField.optional(),
  prepEstimated: z.boolean().optional(),
  availability: z.array(availabilityWindowSchema).max(7).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(100),
  media: z.array(z.string().url()).max(20),
  addOnsNote: z.string().max(500).optional(),
  confidence: z.enum(['high', 'low']),
  issues: z.array(z.string().max(300)).max(20),
  sourcePage: z.number().int().positive().optional(),
  duplicateOfItemId: objectId.nullable().optional(),
  action: z.enum(['create', 'update', 'skip']),
});

const draftCategorySchema = z.object({
  tempId: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Category name is required').max(100),
  description: z.string().max(500).optional(),
  matchCategoryId: objectId.nullable().optional(),
  availability: z.array(availabilityWindowSchema).max(7).optional(),
  items: z.array(draftItemSchema).max(1000),
});

export const menuImportDraftSchema = z.object({
  draft: z.object({
    currency: z.string().max(10).optional(),
    notes: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
    categories: z.array(draftCategorySchema).max(200),
  }),
});

export const menuImportCommitSchema = z.object({
  draft: menuImportDraftSchema.shape.draft.optional(),
});

/** Drag-and-drop ordering: ids in their new display order */
export const reorderSchema = z.object({
  ids: z.array(objectId).min(1).max(1000),
});

/** Bulk: set serving hours on many items ([] = whenever their category is served) */
export const bulkHoursSchema = z.object({
  ids: z.array(objectId).min(1).max(500),
  availability: z.array(availabilityWindowSchema).max(7),
  servicePeriodIds: periodIdsSchema.optional(),
});
