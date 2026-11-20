// services/auth-service/src/services/cortex/conversationExport.ts
// Cortex → "Export conversations": every AI waiter conversation in a date range as a file to read or hand to an AI —
// what the guest said, what the waiter said (and spoke), and what it SHOWED: dish cards, the upsell tray, the offer,
// cart changes, checkout / order. Plus each restaurant's menu, so a reader can tell a wrong price or a dish that
// doesn't exist. What counts as "shown" follows the storefront (apps/tastebud/src/waiter/useWaiterSession.tsx):
// cards when intent is "suggestions" or decision.showSuggestionsModal (meta.onScreen: the cards already there stay),
// the upsell tray when decision.showUpsellTray and there are upsell items.
import type { Document } from 'mongodb';
import { checkVisit } from './answerChecks.js';

type Pick = { name: string; price: number | null; note?: string };

export type ExportTurn = {
  at: string;
  input: 'voice' | 'typed';
  /** notHeardWhy: an unheard turn's clip as the waiter measured it (ai-waiter endpointer.clip_levels) */
  guest: { heard: string; cleanedUp: string | null; notHeard: boolean; notHeardWhy?: string | null };
  understood: { language: string | null; intent: string | null; topic: string | null };
  waiter: { said: string; spoke: string | null; aiUnavailable: boolean; error: string | null };
  screen: {
    dishCards: Pick[] | null;
    keptCardsOnScreen: boolean;
    highlighted: string[];
    upsellTray: Pick[] | null;
    offer: string | null;
    checkout: string | null;
    orderPlaced: number | true | null;
  };
  cart: { changes: string[]; cleared: boolean; trayTotalAfter: number | null; warnings: string[] };
  safetyNet: string[];
  autoFlags: string[];
};

export type ExportConversation = {
  restaurant: string;
  subdomain: string;
  branch: string | null;
  channel: string | null;
  table: string | null;
  startedAt: string;
  endedAt: string;
  ordered: boolean;
  turns: ExportTurn[];
};

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const picks = (list: unknown): Pick[] =>
  (Array.isArray(list) ? (list as Document[]) : [])
    .filter(Boolean)
    .map((s) => ({ name: str(s.title ?? s.name), price: num(s.price), ...(s.subtitle ? { note: str(s.subtitle) } : {}) }))
    .filter((p) => p.name);

function cartChange(op: Document): string {
  const q = op.quantity !== undefined && op.quantity !== null ? `${op.quantity}× ` : '';
  const v = op.variant ? ` (${str(op.variant)})` : '';
  const extra = op.note ? ` — note: ${str(op.note)}` : '';
  return `${str(op.op)} ${q}${str(op.name ?? op.itemId)}${v}${extra}`.trim();
}

/** "clip 2.1 s · voice 0 ms · loudest -52 dB · room -61 dB" — why a turn wasn't heard (a silent mic, too short, loud room) */
function clipWhy(lv: Document | undefined): string | null {
  if (!lv || typeof lv !== 'object') return null;
  const parts: string[] = [];
  if (typeof lv.ms === 'number') parts.push(`clip ${(lv.ms / 1000).toFixed(1)} s`);
  if (typeof lv.speechMs === 'number') parts.push(`voice ${lv.speechMs} ms`);
  if (typeof lv.peakDb === 'number') parts.push(`loudest ${lv.peakDb} dB`);
  if (typeof lv.roomDb === 'number') parts.push(`room ${lv.roomDb} dB`);
  return parts.length ? parts.join(' · ') : null;
}

function checkoutOf(meta: Document): string | null {
  const c = meta.checkout as Document | undefined;
  const parts: string[] = [];
  if (c && typeof c === 'object') {
    for (const [k, v] of Object.entries(c)) if (v !== '' && v !== null && v !== undefined && v !== false) parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : str(v)}`);
  }
  return parts.length ? parts.join(', ') : null;
}

/** One visit (oldest first) → its turns, as the guest experienced them. */
export function exportVisit(visit: Document[]): ExportTurn[] {
  const flags = checkVisit(visit);
  let cards: Pick[] = [];
  const names = new Map<string, string>();
  return visit.map((d, i) => {
    const ai = (d.ai ?? {}) as Document;
    const meta = (ai.meta ?? {}) as Document;
    const decision = (meta.decision ?? {}) as Document;
    for (const s of [...((meta.suggestions as Document[]) ?? []), ...((meta.upsell as Document[]) ?? []), ...((meta.mentionedItems as Document[]) ?? []), ...((meta.items as Document[]) ?? [])])
      if (s && (s.itemId || s.id)) names.set(str(s.itemId ?? s.id), str(s.title ?? s.name));
    const kept = !!meta.onScreen;
    let shownCards: Pick[] | null = null;
    if (!kept && (meta.intent === 'suggestions' || decision.showSuggestionsModal)) {
      const fresh = picks(meta.suggestions);
      if (fresh.length) {
        shownCards = fresh;
        cards = fresh;
      }
    }
    const upsell = picks(meta.upsell);
    const said = str(ai.replyText);
    const spoke = str(meta.voiceReplyText);
    const order = meta.order as Document | undefined;
    return {
      at: new Date(d.ts).toISOString(),
      input: d.engine === 'typed' ? 'typed' : 'voice',
      guest: {
        heard: str(d.text),
        cleanedUp: d.text_norm && d.text_norm !== d.text ? str(d.text_norm) : null,
        notHeard: d.status === 'unheard',
        notHeardWhy: d.status === 'unheard' ? clipWhy(meta.audioLevels as Document | undefined) : null,
      },
      understood: { language: meta.language ?? null, intent: meta.intent ?? null, topic: meta.topic ?? null },
      waiter: {
        said,
        spoke: spoke && spoke !== said ? spoke : null,
        aiUnavailable: !!meta.fallback,
        error: meta.error ? str(meta.error).replace(/\s+/g, ' ').slice(0, 160) : null,
      },
      screen: {
        dishCards: shownCards,
        keptCardsOnScreen: kept && cards.length > 0,
        highlighted: (Array.isArray(meta.highlight) ? meta.highlight : []).map((id: unknown) => names.get(str(id)) ?? str(id)),
        upsellTray: decision.showUpsellTray && upsell.length ? upsell : null,
        offer: (meta.upsellOffer as Document | undefined)?.text ? str((meta.upsellOffer as Document).text) : null,
        checkout: checkoutOf(meta),
        orderPlaced: decision.orderPlaced ? num(order?.orderNumber) ?? true : null,
      },
      cart: {
        changes: ((meta.cartOps ?? []) as Document[]).filter((o) => o && o.op).map(cartChange),
        cleared: !!meta.clearCart,
        trayTotalAfter: num(meta.traySubtotal),
        warnings: ((meta.cartWarnings ?? []) as unknown[]).map((w) => (typeof w === 'string' ? w : JSON.stringify(w))),
      },
      safetyNet: ((meta.guards ?? []) as unknown[]).map(str).filter((g) => g && g !== 'model_unavailable'),
      autoFlags: flags[i].map((f) => f.label + (f.detail ? ` — ${f.detail}` : '')),
    };
  });
}

/* ------------------------------------------------------------------ menus */

export type MenuLine = { category: string; name: string; price: number | null; variations: string[]; notes: string[]; description: string };

export function menuLines(items: Document[], categoryNames: Map<string, string>): MenuLine[] {
  return items
    .map((m) => {
      const notes: string[] = [];
      if (m.hidden || m.status === 'hidden') notes.push('hidden');
      if (m.offline) notes.push('sold out');
      if (m.signature) notes.push('signature');
      if (m.visibility?.dineIn === false) notes.push('not for dine-in');
      if (m.visibility?.online === false) notes.push('not online');
      if (m.availableFrom || m.availableUntil) notes.push(`served ${str(m.availableFrom) || '…'}–${str(m.availableUntil) || '…'}`);
      for (const t of (m.tags ?? []) as unknown[]) notes.push(str(t));
      const variations = ((m.variations ?? []) as Document[]).map((v) => `${str(v.name)}${num(v.price) !== null ? ` ${v.price}` : ''}`);
      for (const g of (m.modifierGroups ?? []) as Document[])
        variations.push(`${str(g.name)}: ${((g.options ?? []) as Document[]).map((o) => `${str(o.name)}${o.price ? ` +${o.price}` : ''}`).join(' / ')}`);
      return {
        category: categoryNames.get(str(m.categoryId)) ?? str(m.category) ?? '',
        name: str(m.name),
        price: num(m.price),
        variations,
        notes,
        description: str(m.description).replace(/\s+/g, ' ').slice(0, 200),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ the readable file */

const AI_BRIEF = `HOW TO READ THIS FILE
Conversations between restaurant guests and Qravy's AI waiter (voice or typed, mostly Bangla / English), grouped
into visits. For each turn:
  GUEST     what speech-to-text heard (voice may contain mis-hearings); "cleaned up" = the waiter's correction
  WAITER    what the waiter wrote; "spoke" = the spoken version when different
  SCREEN    what the waiter showed: dish cards, highlighted dish, upsell tray, an offer, checkout, order placed
  CART      tray changes the waiter made, and the tray total after the turn
  SAFETY    the waiter's own code corrected the AI's answer before the guest saw it
  FLAG      an automatic check thinks this answer may be wrong (hints only — judge for yourself)
Each restaurant's CURRENT menu is listed first (prices in the menu's currency). It may have changed since a conversation.

SUGGESTED TASK FOR AN AI READER
List every waiter answer that was wrong or unhelpful: wrong dish, wrong price, a dish that is not on the menu, a wrong
cart change, a claim it didn't do, wrong language, ignored what the guest asked, bad recommendation, confusing or
too-long reply, cards on screen that don't match what was said. For each: the conversation number and time, what the
guest said, what the waiter said/showed, what was wrong, and what it should have done. Then group them by cause.
`;

const money = (n: number | null) => (n === null ? '?' : String(n));
const pickText = (p: Pick) => `${p.name} ${money(p.price)}${p.note ? ` (${p.note})` : ''}`;

export function toText(opts: {
  from: Date;
  to: Date;
  tz: string;
  conversations: ExportConversation[];
  menus: Array<{ restaurant: string; subdomain: string; lines: MenuLine[] }>;
}): string {
  const fmtDate = (d: Date | string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: opts.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
  const fmtTime = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: opts.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(d));
  const turns = opts.conversations.reduce((n, c) => n + c.turns.length, 0);
  const L: string[] = [];
  L.push(`QRAVY AI WAITER — CONVERSATIONS ${fmtDate(opts.from)} to ${fmtDate(opts.to)} (${opts.tz})`);
  L.push(`${opts.conversations.length} conversations · ${turns} turns · ${opts.menus.length} restaurants`, '', AI_BRIEF);

  for (const m of opts.menus) {
    L.push(`################ MENU — ${m.restaurant} (${m.subdomain}) · ${m.lines.length} dishes`);
    let cat = '\u0000';
    for (const x of m.lines) {
      if (x.category !== cat) {
        cat = x.category;
        L.push(`  [${cat || 'no category'}]`);
      }
      L.push(
        `    - ${x.name} — ${money(x.price)}${x.variations.length ? ` · ${x.variations.join('; ')}` : ''}${x.notes.length ? ` · ${x.notes.join(', ')}` : ''}${x.description ? ` · "${x.description}"` : ''}`
      );
    }
    L.push('');
  }

  opts.conversations.forEach((c, n) => {
    const where = c.channel === 'dine-in' ? `dine-in table ${c.table ?? '?'}` : c.channel ?? 'online';
    L.push(
      `================ CONVERSATION ${n + 1} · ${c.restaurant} (${c.subdomain})${c.branch ? ` · ${c.branch}` : ''} · ${where} · ${fmtDate(c.startedAt)}–${fmtTime(c.endedAt)} · ${c.turns.length} turns · ${c.ordered ? 'ORDERED' : 'no order'}`
    );
    for (const t of c.turns) {
      const u = t.understood;
      L.push(`[${fmtTime(t.at)}] GUEST (${t.input}${u.language ? `, ${u.language}` : ''}): ${t.guest.notHeard ? `(not heard${t.guest.notHeardWhy ? ` — ${t.guest.notHeardWhy}` : ''})` : t.guest.heard || '(nothing)'}`);
      if (t.guest.cleanedUp) L.push(`           cleaned up: ${t.guest.cleanedUp}`);
      if (u.intent || u.topic) L.push(`           understood: ${[u.intent, u.topic].filter(Boolean).join(' / ')}`);
      L.push(`           WAITER: ${t.waiter.said || '(nothing)'}`);
      if (t.waiter.spoke) L.push(`           spoke: ${t.waiter.spoke}`);
      if (t.waiter.aiUnavailable) L.push(`           (AI unavailable — a fallback answer${t.waiter.error ? `: ${t.waiter.error}` : ''})`);
      const s = t.screen;
      if (s.dishCards) L.push(`           SCREEN dish cards: ${s.dishCards.map(pickText).join(' | ')}`);
      if (s.keptCardsOnScreen) L.push('           SCREEN: the same dish cards stay on screen');
      if (s.highlighted.length) L.push(`           SCREEN highlighted: ${s.highlighted.join(', ')}`);
      if (s.upsellTray) L.push(`           SCREEN upsell tray: ${s.upsellTray.map(pickText).join(' | ')}`);
      if (s.offer) L.push(`           SCREEN offer: ${s.offer}`);
      if (s.checkout) L.push(`           SCREEN checkout: ${s.checkout}`);
      if (s.orderPlaced) L.push(`           ORDER PLACED${s.orderPlaced === true ? '' : ` #${s.orderPlaced}`}`);
      if (t.cart.changes.length || t.cart.cleared) L.push(`           CART: ${[...t.cart.changes, ...(t.cart.cleared ? ['cleared the tray'] : [])].join('; ')}`);
      if (t.cart.trayTotalAfter !== null && (t.cart.changes.length || t.cart.cleared)) L.push(`           tray total after: ${t.cart.trayTotalAfter}`);
      if (t.cart.warnings.length) L.push(`           cart warnings: ${t.cart.warnings.join('; ')}`);
      if (t.safetyNet.length) L.push(`           SAFETY: ${t.safetyNet.join(', ')}`);
      for (const f of t.autoFlags) L.push(`           FLAG: ${f}`);
    }
    L.push('');
  });
  if (!opts.conversations.length) L.push('(no conversations in this period)');
  return L.join('\n');
}
