/**
 * Prep-time estimation: every dish gets its OWN kitchen time, never one number for the whole menu.
 *
 *   guessPrep()         instant rule of thumb from the dish type (no network) — used on save and as fallback
 *   estimateWithAI()    one OpenAI call per ~60 dishes: a realistic time per dish (and per size when it differs)
 *
 * Where the time came from is kept on the item as `prepSource`:
 *   owner  set by the restaurant (never overwritten)       menu   printed on the imported menu
 *   ai     estimated by the AI                               guess  rule of thumb, waiting for the AI
 */
import OpenAI from 'openai';
import { clampPrep } from '../orders/waitTime.js';

export type PrepSource = 'owner' | 'menu' | 'ai' | 'guess';

export type PrepInput = {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  sizes?: string[];
};

export type PrepEstimate = { id: string; minutes: number; sizes: Record<string, number> };

/* ------------------------------------------------------------------ rule of thumb */

// First match wins — most specific first. Same guide the menu-import prompt gives the AI.
const RULES: Array<[RegExp, number]> = [
  [/\b(water|mineral|coke|cola|sprite|7 ?up|pepsi|fanta|mojo|soda|soft drinks?|can|bottle)\b/i, 2],
  [/\b(tea|coffee|espresso|latte|cappuccino|americano|lassi|juice|shake|smoothie|lemonade|mojito|borhani|milk)\b/i, 5],
  [/\b(ice ?cream|pudding|firni|kulfi|brownie|cake|pastry|mishti|sweets?|faluda|dessert)\b/i, 4],
  [/\b(whole .*(fish|snapper|chicken)|roast|kacchi.*(full|family)|family (pack|platter))\b/i, 28],
  [/\b(sizzl\w*|steak|tandoor\w*|grill\w*|bbq|barbecue|kebab|tikka|shashlik|naga)\b/i, 20],
  [/\b(pizza)\b/i, 18],
  [/\b(set menu|platter|thali|combo|choice of \d)\b/i, 18],
  [/\b(curry|masala|korma|bhuna|rezala|chili|chilli|manchurian|jalfrezi|dopiaza|with (red|green) curry|stir.?fr\w*)\b/i, 16],
  [/\b(fried rice|chow ?mein|noodles?|pasta|spaghetti|chop ?suey|khichuri|polao|pulao)\b/i, 14],
  [/\b(burger|sandwich|sub|wrap|shawarma|club)\b/i, 13],
  [/\b(biry?ani|kacchi|tehari|halim)\b/i, 9], // served from the pot
  [/\b(fry|fries|onion rings?|wedges|spring rolls?|wonton|won ?thon|dumplings?|momo|pakora|nuggets?|wings|finger|samosa|singara|puri)\b/i, 11],
  [/\b(soup)\b/i, 10],
  [/\b(salad)\b/i, 9],
  [/\b(rice|naan|paratha|porota|roti|bread|papad)\b/i, 6],
];

/** Instant, product-specific guess from the dish name + category (never the same number for everything). */
export function guessPrep(item: Pick<PrepInput, 'name' | 'category' | 'description'>): number {
  const own = `${item.name ?? ''} ${item.category ?? ''}`;
  for (const [re, m] of RULES) if (re.test(own)) return m;
  for (const [re, m] of RULES) if (re.test(item.description ?? '')) return m;
  return 15;
}

/* ------------------------------------------------------------------ AI */

const SYSTEM = `You are an experienced head chef estimating kitchen prep times for a restaurant's menu.
For each dish, give the realistic number of MINUTES from the order reaching the kitchen until ONE portion is ready to serve, in a normal busy service with the usual mise en place done (sauces, marinated meat, cooked rice, biryani already in the pot).

Guide: bottled/canned drinks, water 1–2 · tea, coffee, juice, lassi, shakes 3–6 · desserts from the fridge 3–5 · salads 7–10 · soups 8–12 · fries, spring rolls, wontons, fried starters 9–12 · fried rice, noodles, chowmein, pasta 12–15 · curries, stir-fries 14–18 · burgers, sandwiches 12–15 · pizza 15–20 · grills, kebabs, tandoori, steaks 18–25 · sizzlers ~20 · biryani/kacchi/tehari served from the pot 8–10 · whole fish or whole chicken 25–35 · set menus/platters = their slowest component + 3.
Judge each dish by its own name, category and description (a "Beef Sizzling" is not a "Beef Curry"). Whole minutes, never 0.
When a dish has sizes, give a size its own time ONLY when it clearly takes longer or shorter (a large pizza, a full vs half portion of a cooked-to-order dish); otherwise leave sizes empty.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'minutes', 'sizes'],
        properties: {
          id: { type: 'string' },
          minutes: { type: 'integer' },
          sizes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'minutes'],
              properties: { name: { type: 'string' }, minutes: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
} as const;

const BATCH = 60;

export function aiAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** AI estimates for many dishes. Dishes the model skips get the rule-of-thumb guess. Throws only on no API key. */
export async function estimateWithAI(items: PrepInput[]): Promise<{ estimates: PrepEstimate[]; source: 'ai' | 'guess' }> {
  const fallback = (it: PrepInput): PrepEstimate => ({ id: it.id, minutes: guessPrep(it), sizes: {} });
  if (!items.length) return { estimates: [], source: 'ai' };
  if (!aiAvailable()) return { estimates: items.map(fallback), source: 'guess' };

  const model = process.env.PREP_TIME_MODEL || process.env.MENU_IMPORT_MODEL || 'gpt-4.1-mini';
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE || undefined,
    timeout: 90_000,
    maxRetries: 2,
  });

  const out: PrepEstimate[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const lines = batch.map((it) =>
      JSON.stringify({
        id: it.id,
        name: it.name,
        ...(it.category ? { category: it.category } : {}),
        ...(it.description ? { description: it.description.slice(0, 200) } : {}),
        ...(it.sizes?.length ? { sizes: it.sizes.slice(0, 12) } : {}),
      })
    );
    const completion = await client.chat.completions.create({
      model,
      ...(/^gpt-4/i.test(model) ? { temperature: 0 } : {}),
      max_completion_tokens: 6000,
      response_format: { type: 'json_schema', json_schema: { name: 'prep_times', strict: true, schema: SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Estimate prep time for each dish (one JSON object per line):\n${lines.join('\n')}` },
      ],
    });
    let parsed: { items?: Array<{ id: string; minutes: number; sizes: Array<{ name: string; minutes: number }> }> } = {};
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch {
      parsed = {};
    }
    const byId = new Map((parsed.items ?? []).map((r) => [String(r.id), r]));
    for (const it of batch) {
      const r = byId.get(it.id);
      const minutes = clampPrep(r?.minutes);
      if (!r || minutes === undefined) {
        out.push(fallback(it));
        continue;
      }
      const sizes: Record<string, number> = {};
      const known = new Set((it.sizes ?? []).map((s) => s.trim().toLowerCase()));
      for (const s of r.sizes ?? []) {
        const m = clampPrep(s?.minutes);
        const key = String(s?.name ?? '').trim().toLowerCase();
        if (m !== undefined && known.has(key) && m !== minutes) sizes[key] = m;
      }
      out.push({ id: it.id, minutes, sizes });
    }
  }
  return { estimates: out, source: 'ai' };
}
