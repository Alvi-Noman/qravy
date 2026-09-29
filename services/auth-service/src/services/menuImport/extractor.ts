/**
 * Provider-agnostic menu extractor interface.
 * Add another provider (e.g. Claude) by implementing MenuExtractor and
 * selecting it in getMenuExtractor() via MENU_IMPORT_PROVIDER.
 */
import type { ExtractUsage, RawMenu } from './types.js';
import { OpenAIMenuExtractor } from './openaiExtractor.js';

type ExtractBase = {
  fileName: string;
  pageStart: number; // 1-based, absolute
  pageEnd: number;
  totalPages: number;
  existingCategoryNames: string[];
};

/** A standalone PDF containing just the pages to read. */
export type PdfExtractInput = ExtractBase & { kind: 'pdf'; pdf: Buffer };

/** A rendered page (or one tile of a large page) as JPEG, plus its text layer. */
export type ImageExtractInput = ExtractBase & {
  kind: 'image';
  image: Buffer;
  /** Low-res whole page, sent with tiles so section headings are visible. */
  overview: Buffer | null;
  /** Text found inside the image area ('' for scanned pages). */
  text: string;
  tile: { index: number; count: number; label: string };
};

export type ExtractInput = PdfExtractInput | ImageExtractInput;

export type ExtractOutput = {
  menu: RawMenu;
  usage: ExtractUsage;
};

/** Thrown when the model hit its output limit — caller should retry with less content. */
export class ExtractionTruncatedError extends Error {
  constructor() {
    super('Model output was truncated');
  }
}

export interface MenuExtractor {
  readonly model: string;
  extract(input: ExtractInput): Promise<ExtractOutput>;
}

export function isMenuImportConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

let cached: MenuExtractor | null = null;

export function getMenuExtractor(): MenuExtractor {
  if (cached) return cached;
  const provider = (process.env.MENU_IMPORT_PROVIDER || 'openai').toLowerCase();
  switch (provider) {
    case 'openai':
      cached = new OpenAIMenuExtractor();
      return cached;
    default:
      throw new Error(`Unknown MENU_IMPORT_PROVIDER: ${provider}`);
  }
}
