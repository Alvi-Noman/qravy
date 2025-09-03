import { MongoClient } from 'mongodb';
import logger from './logger.js';

/**
 * Ensure required indexes and JSON Schema validators exist.
 * - users: unique email, magicLinkToken idx, $jsonSchema validator
 * - menuItems: userId+createdAt idx, userId+category idx, $jsonSchema validator
 * - categories: unique (userId,name) idx, $jsonSchema validator
 * - audits: userId+createdAt idx, $jsonSchema validator
 */

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

/**
 * Menu item validator
 * - price is optional (variant-only pricing allowed)
 * - compareAtPrice optional and can be null
 * - variations[].imageUrl can be string or null
 */
function menuItemJsonSchema() {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'name', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        userId: { bsonType: 'objectId' },
        restaurantId: { bsonType: ['objectId', 'null'] },
        name: { bsonType: 'string' },
        price: { bsonType: ['double', 'int', 'long', 'decimal'] },
        compareAtPrice: { bsonType: ['double', 'int', 'long', 'decimal', 'null'] },
        description: { bsonType: ['string', 'null'] },
        category: { bsonType: ['string', 'null'] },
        categoryId: { bsonType: ['objectId', 'null'] },
        media: {
          bsonType: ['array', 'null'],
          items: { bsonType: 'string' },
        },
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
        tags: {
          bsonType: ['array', 'null'],
          items: { bsonType: 'string' },
        },
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
      required: ['userId', 'name', 'createdAt', 'updatedAt'],
      additionalProperties: true,
      properties: {
        _id: { bsonType: 'objectId' },
        userId: { bsonType: 'objectId' },
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

type MongoErrorLike = { code?: number; codeName?: string; message?: string };

function isNamespaceNotFound(e: unknown): e is MongoErrorLike {
  const obj = e as MongoErrorLike;
  return obj && (obj.code === 26 || obj.codeName === 'NamespaceNotFound');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Apply validator via collMod or create collection with validator */
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

/** Ensure indexes and validators on all collections */
export async function ensureUserIndexes(client: MongoClient): Promise<void> {
  const db = client.db('authDB');

  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  logger.info('Ensured unique index on users.email');
  await users.createIndex({ magicLinkToken: 1 });
  logger.info('Ensured index on users.magicLinkToken');

  const menuItems = db.collection('menuItems');
  await menuItems.createIndex({ userId: 1, createdAt: -1 });
  logger.info('Ensured compound index on menuItems.userId,createdAt');
  await menuItems.createIndex({ userId: 1, category: 1 });
  logger.info('Ensured compound index on menuItems.userId,category');

  const categories = db.collection('categories');
  await categories.createIndex({ userId: 1, name: 1 }, { unique: true });
  logger.info('Ensured unique compound index on categories.userId,name');

  const audits = db.collection('audits');
  await audits.createIndex({ userId: 1, createdAt: -1 });
  logger.info('Ensured index on audits.userId,createdAt');

  await ensureValidator(client, 'users', userJsonSchema());
  await ensureValidator(client, 'menuItems', menuItemJsonSchema());
  await ensureValidator(client, 'categories', categoryJsonSchema());
  await ensureValidator(client, 'audits', auditJsonSchema());
}