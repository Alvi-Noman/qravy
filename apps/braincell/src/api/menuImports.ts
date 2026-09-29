/**
 * AI menu import API (PDF → draft → review → commit)
 */
import api from './auth';

export type DraftVariation = {
  name: string;
  price?: number;
  imageUrl?: string;
  optionValues?: string[];
  prepMinutes?: number;
};

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
  /** Item serving hours (e.g. Friday special) */
  availability?: Array<{ days: number[]; start: string; end: string }>;
  /** Kitchen minutes for one portion (wait-time estimation) */
  prepMinutes?: number;
  /** The menu didn't print a time — the AI suggested a typical one; the owner should check it */
  prepEstimated?: boolean;
  /** Legacy free-text add-ons from older imports */
  addOnsNote?: string;
  confidence: 'high' | 'low';
  issues: string[];
  sourcePage?: number;
  duplicateOfItemId?: string | null;
  action: DraftItemAction;
};

export type DraftCategory = {
  tempId: string;
  name: string;
  description?: string;
  matchCategoryId?: string | null;
  /** Serving hours; empty = always available */
  availability?: Array<{ days: number[]; start: string; end: string }>;
  items: DraftItem[];
};

export type DraftMenu = {
  currency?: string;
  /** Menu-wide notes (VAT, allergen legend…) added to the restaurant's menu notes */
  notes?: string[];
  categories: DraftCategory[];
};

export type CommitResult = {
  categoriesCreated: number;
  categoriesMerged: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: Array<{ tempId: string; name: string; message: string }>;
};

export type MenuImportStatus = 'processing' | 'ready' | 'failed' | 'committing' | 'committed';

export type MenuImport = {
  id: string;
  status: MenuImportStatus;
  fileName: string;
  /** 'photos': pageCount is the number of photos */
  sourceType: 'pdf' | 'photos';
  pageCount: number;
  locationId: string | null;
  progress: { done: number; total: number };
  error: string | null;
  warnings: string[];
  draft?: DraftMenu | null;
  result: CommitResult | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number };
  createdAt: string;
  updatedAt: string;
};

const BASE = '/api/v1/menu-imports';

/** Reads the server's { message } from an axios error. */
export function importErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message || e?.message || fallback;
}

/** Uploads one menu PDF, or up to 10 menu photos (in page order). */
export async function uploadMenuFiles(
  files: File[],
  opts: { locationId?: string | null; onProgress?: (pct: number) => void } = {}
): Promise<MenuImport> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (opts.locationId) form.append('locationId', opts.locationId);
  const res = await api.post(BASE, form, {
    onUploadProgress: (e) => {
      if (opts.onProgress && e.total) opts.onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data.import as MenuImport;
}

export async function getMenuImport(id: string): Promise<MenuImport> {
  const res = await api.get(`${BASE}/${id}`, { params: { _: Date.now() } });
  return res.data.import as MenuImport;
}

export async function listMenuImports(): Promise<MenuImport[]> {
  const res = await api.get(BASE, { params: { _: Date.now() } });
  return res.data.items as MenuImport[];
}

export async function saveMenuImportDraft(id: string, draft: DraftMenu): Promise<MenuImport> {
  const res = await api.patch(`${BASE}/${id}/draft`, { draft });
  return res.data.import as MenuImport;
}

export async function commitMenuImport(id: string, draft?: DraftMenu): Promise<MenuImport> {
  const res = await api.post(`${BASE}/${id}/commit`, draft ? { draft } : {});
  return res.data.import as MenuImport;
}
