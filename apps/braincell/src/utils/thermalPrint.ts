/**
 * Thermal printing for orders (58 mm / 80 mm receipt printers).
 *
 * Tickets are plain HTML printed through the browser, so any thermal printer installed on the computer works
 * (USB, network or Bluetooth) — and Bangla text and ৳ print correctly, which raw ESC/POS can't do.
 *   kitchen  — the KOT: big order + table number, items with choices and notes, no prices
 *   receipt  — for the guest: restaurant, items with prices, total, paid / pay at the counter / on pickup / cash on delivery
 *
 * Tip for a kitchen screen: start Chrome with --kiosk-printing to print without the dialog
 * (together with "auto-print new orders").
 */
import { orderWhere, type AdminOrder } from '../api/orders';

export type TicketKind = 'kitchen' | 'receipt';
export type PaperWidth = '58' | '80';

export type PrintSettings = {
  paper: PaperWidth;
  /** Print a kitchen ticket as soon as a new order arrives (this device only) */
  autoPrint: boolean;
  /** …and a receipt too */
  autoPrintReceipt: boolean;
};

const KEY = 'orders:print';
export const DEFAULT_PRINT: PrintSettings = { paper: '80', autoPrint: false, autoPrintReceipt: false };

export function loadPrintSettings(): PrintSettings {
  try {
    return { ...DEFAULT_PRINT, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<PrintSettings>) };
  } catch {
    return DEFAULT_PRINT;
  }
}

export function savePrintSettings(s: PrintSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked — settings last for this session */
  }
}

/* ------------------------------------------------------------------ ticket HTML */

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (n: number) => `৳${new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(n)}`;

function when(iso: string | undefined, tz?: string, withDate = false): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      ...(tz ? { timeZone: tz } : {}),
      ...(withDate ? { day: '2-digit', month: 'short', year: 'numeric' } : {}),
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

const SOURCE: Record<AdminOrder['source'], string> = { 'ai-waiter': 'Virtual waiter', menu: 'Menu', staff: 'Staff' };

export function buildTicketHtml(
  order: AdminOrder,
  opts: { kind: TicketKind; paper: PaperWidth; restaurant?: string; branch?: string | null; timezone?: string; reprint?: boolean }
): string {
  const w80 = opts.paper === '80';
  const body = w80 ? 72 : 48; // printable width in mm
  const base = w80 ? 13 : 11.5;
  const title = opts.kind === 'kitchen' ? 'KITCHEN' : 'RECEIPT';
  const branch = opts.branch ?? order.branch;

  const lines = order.items
    .map((l) => {
      const choices = [l.variation, ...l.modifiers.map((m) => m.name)].filter(Boolean);
      if (opts.kind === 'kitchen') {
        return `<div class="item">
  <div class="k-line"><span class="qty">${l.qty}×</span><span class="name">${esc(l.name)}</span></div>
  ${l.variation ? `<div class="sub">${esc(l.variation)}</div>` : ''}
  ${l.modifiers.map((m) => `<div class="sub">+ ${esc(m.name)}</div>`).join('')}
  ${l.notes ? `<div class="note">** ${esc(l.notes)} **</div>` : ''}
</div>`;
      }
      return `<div class="item">
  <div class="r-line"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.lineTotal)}</span></div>
  ${choices.length ? `<div class="sub">${esc(choices.join(', '))}</div>` : ''}
  ${l.qty > 1 ? `<div class="sub">@ ${money(l.unitPrice)}</div>` : ''}
</div>`;
    })
    .join('\n');

  // not accepted yet → no due time (the clock starts on accept), just how long it takes
  const eta =
    order.eta && opts.kind === 'kitchen'
      ? order.status === 'placed'
        ? `<div class="row"><span>Takes</span><b>~${order.eta.estimateMinutes ?? order.eta.prepMinutes + order.eta.queueMinutes} min</b></div>`
        : `<div class="row"><span>Due</span><b>${esc(when(order.eta.readyAt, opts.timezone))}</b></div>`
      : '';
  const itemCount = order.items.reduce((s, l) => s + l.qty, 0);
  const online = order.channel === 'online';
  const c = order.customer;
  const contact = online && c
    ? `<div class="row"><span>Name</span><b>${esc(c.name)}</b></div>
<div class="row"><span>Phone</span><span>${esc(c.phone)}</span></div>${
        order.fulfillment === 'delivery' && c.address ? `
<div class="note block">DELIVER TO: ${esc(c.address)}</div>` : ''
      }`
    : '';
  const payLine =
    order.payment.status === 'paid'
      ? 'PAID — thank you!'
      : order.payment.method === 'cod'
      ? 'Cash on delivery'
      : online
      ? 'Please pay on pickup'
      : 'Please pay at the counter';

  const head =
    opts.kind === 'kitchen'
      ? `<div class="center tag">${title}${opts.reprint ? ' · REPRINT' : ''}</div>
<div class="center big">#${order.orderNumber}</div>
<div class="center table">${esc(orderWhere(order).toUpperCase())}</div>
${contact}
<div class="row"><span>Placed</span><span>${esc(when(order.createdAt, opts.timezone))}</span></div>
${eta}
<div class="row"><span>From</span><span>${esc(SOURCE[order.source] ?? order.source)}</span></div>`
      : `${opts.restaurant ? `<div class="center shop">${esc(opts.restaurant)}</div>` : ''}
${branch ? `<div class="center sub">${esc(branch)}</div>` : ''}
<div class="center tag">${title}${opts.reprint ? ' · COPY' : ''}</div>
<div class="row"><span>Order</span><b>#${order.orderNumber}</b></div>
${online ? `<div class="row"><span>For</span><b>${esc(orderWhere(order))}</b></div>
${contact}` : `<div class="row"><span>Table</span><b>${esc(order.table)}</b></div>`}
<div class="row"><span>Date</span><span>${esc(when(order.createdAt, opts.timezone, true))}</span></div>`;

  const foot =
    opts.kind === 'kitchen'
      ? `${order.notes ? `<div class="note block">ORDER NOTE: ${esc(order.notes)}</div>` : ''}
<div class="center sub">${itemCount} item${itemCount === 1 ? '' : 's'}</div>`
      : `<div class="rule"></div>
<div class="row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
<div class="row total"><span>TOTAL</span><span>${money(order.total)}</span></div>
<div class="center pay">${payLine}</div>
${order.notes ? `<div class="sub">Note: ${esc(order.notes)}</div>` : ''}
<div class="center sub">Thank you for dining with us</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} #${order.orderNumber}</title>
<style>
  @page { size: ${opts.paper}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${body}mm; margin: 0 auto; padding: 3mm 0 6mm; font: ${base}px/1.35 "Noto Sans Bengali", "Segoe UI", Arial, sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .center { text-align: center; }
  .tag { font-weight: 700; letter-spacing: 2px; font-size: ${base - 1}px; border: 1.5px solid #000; padding: 1px 0; margin-bottom: 4px; }
  .shop { font-weight: 800; font-size: ${base + 5}px; }
  .big { font-weight: 800; font-size: ${w80 ? 40 : 32}px; line-height: 1.1; }
  .table { font-weight: 800; font-size: ${w80 ? 22 : 18}px; margin: 2px 0 6px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .rule, .items { border-top: 1.5px dashed #000; margin: 6px 0; }
  .items { padding-top: 4px; border-bottom: 1.5px dashed #000; padding-bottom: 4px; }
  .item { margin: 4px 0; break-inside: avoid; }
  .k-line { display: flex; gap: 6px; font-weight: 800; font-size: ${base + 3}px; }
  .qty { min-width: 2.2em; }
  .r-line { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
  .sub { font-size: ${base - 1}px; padding-left: 1.2em; }
  .note { font-weight: 800; padding-left: 1.2em; }
  .note.block { padding: 4px 0; }
  .total { font-weight: 800; font-size: ${base + 4}px; margin-top: 2px; }
  .pay { font-weight: 700; margin-top: 6px; }
</style></head><body>
${head}
<div class="items">
${lines}
</div>
${foot}
<div class="center sub" style="margin-top:6px">Printed ${esc(when(new Date().toISOString(), opts.timezone))}</div>
</body></html>`;
}

/* ------------------------------------------------------------------ print */

/** Print HTML through a hidden iframe (no pop-up windows, the admin page stays as it is). */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      window.setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    // give web fonts a moment, then print
    window.setTimeout(() => {
      try {
        frame.contentWindow!.focus();
        frame.contentWindow!.addEventListener('afterprint', done, { once: true });
        frame.contentWindow!.print();
      } catch {
        /* printing blocked */
      }
      window.setTimeout(done, 60_000); // safety net if afterprint never fires
    }, 250);
  });
}

let queue: Promise<void> = Promise.resolve();

export function printOrder(
  order: AdminOrder,
  kind: TicketKind,
  opts: { paper: PaperWidth; restaurant?: string; timezone?: string; reprint?: boolean }
): Promise<void> {
  // one at a time: three orders arriving together print one after another, not three dialogs at once
  queue = queue.then(() => printHtml(buildTicketHtml(order, { kind, ...opts })));
  return queue;
}
