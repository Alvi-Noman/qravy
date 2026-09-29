/**
 * OpenAI implementation of MenuExtractor.
 * Sends the PDF pages as a `file` content part (works for text and scanned
 * PDFs) and forces a strict JSON-schema response.
 *
 * Env:
 *   OPENAI_API_KEY      required
 *   OPENAI_BASE         optional base URL (same var the ai-waiter uses)
 *   MENU_IMPORT_MODEL   default gpt-4.1-mini (use gpt-4.1 for harder menus)
 */
import OpenAI from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import {
  ExtractionTruncatedError,
  type ExtractInput,
  type ExtractOutput,
  type MenuExtractor,
} from './extractor.js';
import { MENU_JSON_SCHEMA, MENU_SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import type { RawMenu } from './types.js';

const DEFAULT_MODEL = 'gpt-4.1-mini';
const MAX_OUTPUT_TOKENS = 16_000;

export class OpenAIMenuExtractor implements MenuExtractor {
  readonly model: string;
  private client: OpenAI;

  constructor() {
    this.model = process.env.MENU_IMPORT_MODEL || DEFAULT_MODEL;
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE || undefined,
      timeout: 180_000,
      maxRetries: 2,
    });
  }

  async extract(input: ExtractInput): Promise<ExtractOutput> {
    // Reasoning models (o*, gpt-5*) reject a custom temperature.
    const supportsTemperature = /^gpt-4/i.test(this.model);

    const content: ChatCompletionContentPart[] = [];
    if (input.kind === 'pdf') {
      content.push({
        type: 'file',
        file: {
          filename: input.fileName || 'menu.pdf',
          file_data: `data:application/pdf;base64,${input.pdf.toString('base64')}`,
        },
      });
    } else {
      if (input.overview) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${input.overview.toString('base64')}`, detail: 'low' },
        });
      }
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${input.image.toString('base64')}`, detail: 'high' },
      });
    }
    content.push({
      type: 'text',
      text: buildUserPrompt({
        existingCategoryNames: input.existingCategoryNames,
        pageStart: input.pageStart,
        pageEnd: input.pageEnd,
        totalPages: input.totalPages,
        tile: input.kind === 'image' ? { ...input.tile, text: input.text } : null,
      }),
    });

    const completion = await this.client.chat.completions.create({
      model: this.model,
      ...(supportsTemperature ? { temperature: 0 } : {}),
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'menu_extraction',
          strict: true,
          schema: MENU_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        { role: 'system', content: MENU_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    });

    const choice = completion.choices[0];
    if (choice?.finish_reason === 'length') throw new ExtractionTruncatedError();

    const refusal = choice?.message?.refusal;
    if (refusal) throw new Error(`Model refused: ${refusal}`);

    const text = choice?.message?.content;
    if (!text) throw new Error('Empty model response');

    let menu: RawMenu;
    try {
      menu = JSON.parse(text) as RawMenu;
    } catch {
      throw new Error('Model returned invalid JSON');
    }

    return {
      menu,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }
}
