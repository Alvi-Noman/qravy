// services/auth-service/src/utils/initDb.ts
import { MongoClient } from 'mongodb';
import logger from './logger.js';

function userJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        email: { bsonType: 'string' },
        isVerified: { bsonType: ['bool', 'null'] },
        tenantId: { bsonType: ['objectId', 'null'] },
        isOnboarded: { bsonType: ['bool', 'null'] },
        refreshTokens: {
          bsonType: ['array', 'null'],
          items: {
            bsonType: 'object',
            required: ['tokenId', 'tokenHash', 'createdAt', 'expiresAt'],
            properties: {
              tokenId: { bsonType: 'string' },
              tokenHash: { bsonType: 'string' },
              createdAt: { bsonType: 'date' },
              expiresAt: { bsonType: 'date' },
              userAgent: { bsonType: ['string', 'null'] },
              ip: { bsonType: ['string', 'null'] },
            },
          },
        },
        failedLoginAttempts: { bsonType: ['int', 'long', 'null'] },
        lockUntil: { bsonType: ['date', 'null'] },
        magicLinkToken: { bsonType: ['string', 'null'] },
        magicLinkTokenExpires: { bsonType: ['date', 'null'] },
      },
    },
  };
}

function tenantJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'subdomain', 'ownerId', 'onboardingCompleted', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        name: { bsonType: 'string' },
        subdomain: { bsonType: 'string' },
        ownerId: { bsonType: 'objectId' },
        onboardingCompleted: { bsonType: 'bool' },
        ownerInfo: {
          bsonType: ['object', 'null'],
          properties: {
            fullName: { bsonType: 'string' },
            phone: { bsonType: 'string' },
          },
        },
        restaurantInfo: {
          bsonType: ['object', 'null'],
          properties: {
            restaurantType: { bsonType: 'string' },
            country: { bsonType: 'string' },
            address: { bsonType: 'string' },
            locationMode: { enum: ['single', 'multiple', null] },
            locationCount: { bsonType: ['int', 'long', 'double', 'decimal', 'null'] },
            hasLocations: { bsonType: ['bool', 'null'] },
          },
        },
        planInfo: {
          bsonType: ['object', 'null'],
          properties: {
            planId: { bsonType: 'string' },
          },
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };
}

function membershipJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'userId', 'role', 'status', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        userId: { bsonType: 'objectId' },
        role: { enum: ['owner', 'admin', 'editor', 'viewer'] },
        status: { enum: ['active', 'invited'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };
}

function menuItemJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'name', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        createdBy: { bsonType: ['objectId', 'null'] },
        updatedBy: { bsonType: ['objectId', 'null'] },
        restaurantId: { bsonType: ['objectId', 'null'] },

        scope: { enum: ['all', 'location', null] },
        locationId: { bsonType: ['objectId', 'null'] },

        visibility: {
          bsonType: ['object', 'null'],
          additionalProperties: false,
          properties: {
            dineIn: { bsonType: ['bool', 'null'] },
            online: { bsonType: ['bool', 'null'] },
          },
        },

        name: { bsonType: 'string' },
        price: { bsonType: ['double', 'int', 'long', 'decimal'] },
        compareAtPrice: { bsonType: ['double', 'int', 'long', 'decimal', 'null'] },
        description: { bsonType: ['string', 'null'] },
        category: { bsonType: ['string', 'null'] },
        categoryId: { bsonType: ['objectId', 'null'] },
        media: { bsonType: ['array', 'null'], items: { bsonType: 'string' } },
        variations: {
          bsonType: ['array', 'null'],
          items: {
            bsonType: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: { bsonType: 'string' },
              price: { bsonType: ['double', 'int', 'long', 'decimal'] },
              imageUrl: { bsonType: ['string', 'null'] },
            },
          },
        },
        tags: { bsonType: ['array', 'null'], items: { bsonType: 'string' } },
        hidden: { bsonType: ['bool', 'null'] },
        status: { enum: ['active', 'hidden', null] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };
}

function categoryJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'name', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        createdBy: { bsonType: ['objectId', 'null'] },

        scope: { enum: ['all', 'location', null] },
        locationId: { bsonType: ['objectId', 'null'] },

        channelScope: { enum: ['all', 'dine-in', 'online', null] },

        name: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };
}

function auditJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'action', 'createdAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        userId: { bsonType: 'objectId' },
        action: { bsonType: 'string' },
        before: {},
        after: {},
        metadata: {},
        ip: { bsonType: ['string', 'null'] },
        userAgent: { bsonType: ['string', 'null'] },
        createdAt: { bsonType: 'date' },
      },
    },
  };
}

function locationJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'name', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        createdBy: { bsonType: ['objectId', 'null'] },
        name: { bsonType: 'string' },
        address: { bsonType: ['string', 'null'] },
        zip: { bsonType: ['string', 'null'] },
        country: { bsonType: ['string', 'null'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };
}

/**
 * Overlays (per-location, per-channel) — allow either:
 *  A) availability overlay: has `available` (removed absent/false)
 *  B) tombstone: has `removed: true` (no `available` required)
 */
function itemAvailabilityJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      // always-required identity + timestamps
      required: ['tenantId', 'itemId', 'locationId', 'channel', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        itemId: { bsonType: 'objectId' },
        locationId: { bsonType: 'objectId' },
        channel: { enum: ['dine-in', 'online'] },

        // shape A fields
        available: { bsonType: ['bool', 'null'] },

        // shape B field
        removed: { bsonType: ['bool', 'null'] },

        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
      oneOf: [
        // A) overlay document
        {
          required: ['available'],
          properties: {
            removed: { enum: [false, null] },
          },
        },
        // B) tombstone document
        {
          required: ['removed'],
          properties: {
            removed: { enum: [true] },
          },
        },
      ],
    },
  };
}

/**
 * Category visibility overlays — same dual-shape approach as above.
 */
function categoryVisibilityJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'categoryId', 'locationId', 'channel', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        categoryId: { bsonType: 'objectId' },
        locationId: { bsonType: 'objectId' },
        channel: { enum: ['dine-in', 'online'] },

        // overlay field
        visible: { bsonType: ['bool', 'null'] },

        // tombstone field
        removed: { bsonType: ['bool', 'null'] },

        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
      oneOf: [
        // A) overlay document
        {
          required: ['visible'],
          properties: {
            removed: { enum: [false, null] },
          },
        },
        // B) tombstone document
        {
          required: ['removed'],
          properties: {
            removed: { enum: [true] },
          },
        },
      ],
    },
  };
}

/** ---------- NEW: Orders collection validator ---------- */
function ordersJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'channel', 'status', 'items', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        tenantId: { bsonType: 'objectId' },
        channel: { enum: ['dine-in', 'online'] },
        status: { bsonType: 'string' }, // placed | paid | preparing | completed | cancelled | ...
        items: {
          bsonType: 'array',
          minItems: 1,
          items: {
            bsonType: 'object',
            required: ['itemId', 'qty'],
            additionalProperties: true,
            properties: {
              itemId: { bsonType: 'objectId' },
              qty: { bsonType: ['int', 'long', 'double', 'decimal'] },
              variation: { bsonType: ['string', 'null'] },
              notes: { bsonType: ['string', 'null'] },
            },
          },
        },
        dineIn: {
          bsonType: ['object', 'null'],
          properties: {
            tableNumber: { bsonType: ['string', 'null'] },
          },
        },
        online: {
          bsonType: ['object', 'null'],
          properties: {
            customer: {
              bsonType: ['object', 'null'],
              properties: {
                name: { bsonType: ['string', 'null'] },
                phone: { bsonType: ['string', 'null'] },
                address: { bsonType: ['string', 'null'] },
              },
            },
          },
        },
        notes: { bsonType: ['string', 'null'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };
}

type MongoErrorLike = { code?: number; codeName?: string; message?: string };

function isNamespaceNotFound(e: unknown): e is MongoErrorLike {
  const obj = e as MongoErrorLike;
  return obj && (obj.code === 26 || obj.codeName === 'NamespaceNotFound');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function ensureValidator(client: MongoClient, collection: string, schema: object): Promise<void> {
  const db = client.db('authDB');
  try {
    await db.command({
      collMod: collection,
      validator: schema,
      validationLevel: 'moderate',
      validationAction: 'error',
    });
    logger.info(`Applied validator to ${collection} (collMod).`);
  } catch (e) {
    if (isNamespaceNotFound(e)) {
      await db.createCollection(collection, {
        validator: schema,
        validationLevel: 'moderate',
        validationAction: 'error',
      });
      logger.info(`Created collection ${collection} with validator.`);
    } else {
      logger.warn(`Could not apply validator to ${collection}: ${errorMessage(e)}`);
    }
  }
}

async function dropIndexIfExists(db: MongoClient['db'], collection: string, indexName: string) {
  try {
    const col = db('authDB').collection(collection);
    const indexes = await col.indexes();
    if (indexes.some((ix) => ix.name === indexName)) {
      await col.dropIndex(indexName);
      logger.info(`Dropped index ${collection}.${indexName}`);
    }
  } catch (e) {
    logger.warn(`Could not drop index ${collection}.${indexName}: ${errorMessage(e)}`);
  }
}

export async function ensureUserIndexes(client: MongoClient): Promise<void> {
  const db = client.db('authDB');

  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  logger.info('Ensured unique index on users.email');
  await users.createIndex({ magicLinkToken: 1 });
  logger.info('Ensured index on users.magicLinkToken');
  await users.createIndex({ tenantId: 1 });
  logger.info('Ensured index on users.tenantId');

  const tenants = db.collection('tenants');
  await tenants.createIndex({ subdomain: 1 }, { unique: true });
  logger.info('Ensured unique index on tenants.subdomain');
  await tenants.createIndex({ ownerId: 1, createdAt: -1 });
  logger.info('Ensured index on tenants.ownerId,createdAt');

  const memberships = db.collection('memberships');
  await memberships.createIndex({ tenantId: 1, userId: 1 }, { unique: true, name: 'ux_tenant_user' });
  logger.info('Ensured unique index on memberships.tenantId,userId');

  const menuItems = db.collection('menuItems');
  await menuItems.createIndex({ tenantId: 1, createdAt: -1 });
  logger.info('Ensured compound index on menuItems.tenantId,createdAt');
  await menuItems.createIndex({ tenantId: 1, category: 1 });
  logger.info('Ensured compound index on menuItems.tenantId,category');

  // ✅ New: cover cascade-delete filters by (tenantId, category, locationId)
  await menuItems.createIndex(
    { tenantId: 1, category: 1, locationId: 1 },
    { name: 'ix_menuItems_tenant_category_location' }
  );
  logger.info('Ensured index on menuItems.tenantId,category,locationId');

  await menuItems.createIndex(
    { tenantId: 1, scope: 1, locationId: 1, createdAt: -1 },
    { name: 'ix_menuItems_scope_location_created' }
  );
  logger.info('Ensured index on menuItems.tenantId,scope,locationId,createdAt');

  const categories = db.collection('categories');
  await categories.createIndex({ tenantId: 1, name: 1 }, { unique: true });
  logger.info('Ensured unique compound index on categories.tenantId,name');
  await categories.createIndex(
    { tenantId: 1, scope: 1, locationId: 1, channelScope: 1, name: 1 },
    { name: 'ix_categories_scope_location_channel_name' }
  );
  logger.info('Ensured index on categories.tenantId,scope,locationId,channelScope,name');

  const audits = db.collection('audits');
  await audits.createIndex({ userId: 1, createdAt: -1 });
  logger.info('Ensured index on audits.userId,createdAt');

  const locations = db.collection('locations');
  await locations.createIndex(
    { tenantId: 1, name: 1 },
    { unique: true, name: 'ux_locations_tenant_name', collation: { locale: 'en', strength: 2 } }
  );
  logger.info('Ensured unique index on locations.tenantId,name');
  await locations.createIndex({ tenantId: 1, createdAt: -1 });
  logger.info('Ensured compound index on locations.tenantId,createdAt');

  // Overlays
  await dropIndexIfExists(client.db, 'itemAvailability', 'ux_itemAvailability');
  const itemAvailability = db.collection('itemAvailability');
  await itemAvailability.createIndex(
    { tenantId: 1, itemId: 1, locationId: 1, channel: 1 },
    { unique: true, name: 'ux_itemAvailability_loc_channel' }
  );
  logger.info('Ensured unique index on itemAvailability(tenantId,itemId,locationId,channel)');

  await dropIndexIfExists(client.db, 'categoryVisibility', 'ux_categoryVisibility');
  const categoryVisibility = db.collection('categoryVisibility');
  await categoryVisibility.createIndex(
    { tenantId: 1, categoryId: 1, locationId: 1, channel: 1 },
    { unique: true, name: 'ux_categoryVisibility_loc_channel' }
  );
  logger.info('Ensured unique index on categoryVisibility(tenantId,categoryId,locationId,channel)');

  // ✅ NEW: Orders
  await ensureValidator(client, 'orders', ordersJsonSchema());
  logger.info('Applied validator to orders');
  const orders = db.collection('orders');
  await orders.createIndex({ tenantId: 1, createdAt: -1 }, { name: 'ix_orders_tenant_created' });
  logger.info('Ensured index on orders.tenantId,createdAt');
  await orders.createIndex({ tenantId: 1, status: 1, createdAt: -1 }, { name: 'ix_orders_tenant_status_created' });
  logger.info('Ensured index on orders.tenantId,status,createdAt');
  await orders.createIndex({ tenantId: 1, channel: 1, createdAt: -1 }, { name: 'ix_orders_tenant_channel_created' });
  logger.info('Ensured index on orders.tenantId,channel,createdAt');

  // Validators (make sure these remain last to cover first-run create scenarios)
  await ensureValidator(client, 'users', userJsonSchema());
  await ensureValidator(client, 'tenants', tenantJsonSchema());
  await ensureValidator(client, 'memberships', membershipJsonSchema());
  await ensureValidator(client, 'menuItems', menuItemJsonSchema());
  await ensureValidator(client, 'categories', categoryJsonSchema());
  await ensureValidator(client, 'audits', auditJsonSchema());
  await ensureValidator(client, 'locations', locationJsonSchema());
  await ensureValidator(client, 'itemAvailability', itemAvailabilityJsonSchema());
  await ensureValidator(client, 'categoryVisibility', categoryVisibilityJsonSchema());
}
