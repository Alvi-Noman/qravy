import { ObjectId } from 'mongodb';
import type { CommitResult, DraftMenu } from '../services/menuImport/types.js';

export type MenuImportStatus = 'processing' | 'ready' | 'failed' | 'committing' | 'committed';

/**
 * An AI menu import job (collection `menuImports`).
 * The uploaded PDF itself is never stored — only the extracted draft.
 */
export interface MenuImportDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  createdBy: ObjectId;

  /** Branch the import targets (null → global items). */
  locationId: ObjectId | null;

  fileName: string;
  /** What was uploaded; pageCount = number of photos for 'photos' */
  sourceType?: 'pdf' | 'photos';
  pageCount: number;

  status: MenuImportStatus;
  progress: { done: number; total: number };
  error?: string;
  warnings: string[];

  draft?: DraftMenu;
  result?: CommitResult;

  model?: string;
  usage: { inputTokens: number; outputTokens: number };

  /** TTL for uncommitted jobs; unset on commit. */
  expiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
