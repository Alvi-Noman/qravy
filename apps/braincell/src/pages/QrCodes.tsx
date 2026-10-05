/**
 * QR Codes: every code a guest can scan, in one place.
 *   - Online storefront: {storefront} — the online shop (pickup / delivery, name / phone / address)
 *   - One per dine-in table: {storefront}/dine-in?table=<name>&k=<key> — the virtual waiter for that table; the order
 *     goes to it (apps/tastebud/src/utils/table.ts). The key is the table's secret (made when the table is saved): an
 *     order without it (a typed table number) reaches the staff marked "table not verified".
 * Table names are saved on the tenant; codes can be downloaded as PNG or printed as a sheet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  GlobeAltIcon,
  PlusIcon,
  PrinterIcon,
  QrCodeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../context/AuthContext';
import { useTenant } from '../hooks/useTenant';
import { updateTenant } from '../api/tenant';
import { onlineUrl, storefrontBase, tableUrl } from '../utils/storefront';
import { toastError, toastSuccess } from '../components/Toaster';

const MAX_TABLES = 500;
const VALID_TABLE = /^[A-Za-z0-9-]{1,12}$/;

export { storefrontBase, tableUrl, onlineUrl };

/** "12, 13-20, Patio-1" → ["12", "13", …, "20", "PATIO-1"]. Pure-number ranges expand; anything else is a name. */
export function parseTableInput(raw: string): { tables: string[]; invalid: string[] } {
  const tables: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[,\s]+/).map((p) => p.trim().replace(/^#/, '')).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      if (hi - lo >= MAX_TABLES) {
        invalid.push(part);
        continue;
      }
      for (let n = lo; n <= hi; n++) tables.push(String(n));
    } else if (VALID_TABLE.test(part)) {
      tables.push(part.toUpperCase());
    } else {
      invalid.push(part);
    }
  }
  return { tables, invalid };
}

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Render a QR <svg> plus captions to a PNG and download it. */
async function downloadQrPng(svg: SVGSVGElement, title: string, subtitle: string, filename: string) {
  const size = 1024;
  const pad = 64;
  const captionH = 180;
  const canvas = document.createElement('canvas');
  canvas.width = size + pad * 2;
  canvas.height = size + pad * 2 + captionH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, pad, pad, size, size);
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 72px Inter, system-ui, sans-serif';
  ctx.fillText(title, canvas.width / 2, size + pad + 100);
  ctx.fillStyle = '#64748b';
  ctx.font = '36px Inter, system-ui, sans-serif';
  ctx.fillText(subtitle, canvas.width / 2, size + pad + 160);

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}

function QrCard({
  title,
  subtitle,
  url,
  filename,
  onRemove,
}: {
  title: string;
  subtitle: string;
  url: string;
  filename: string;
  onRemove?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Link copied');
    } catch {
      toastError('Could not copy link');
    }
  };

  const download = () => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) downloadQrPng(svg, title, subtitle, filename).catch(() => toastError('Could not create image'));
  };

  return (
    <div className="group relative flex flex-col items-center rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={`Remove ${title}`}
          aria-label={`Remove ${title}`}
          className="absolute right-2 top-2 rounded-md p-1 text-slate-400 opacity-0 hover:bg-slate-50 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
      <div ref={wrapRef} className="rounded-lg bg-white p-2">
        <QRCodeSVG value={url} size={148} level="M" marginSize={0} />
      </div>
      <div className="mt-3 text-center text-[14px] font-semibold text-slate-900">{title}</div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 max-w-full truncate text-[11px] text-slate-500 hover:text-slate-700 hover:underline"
        title={url}
      >
        {url.replace(/^https?:\/\//, '')}
      </a>
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <ClipboardDocumentIcon className="h-3.5 w-3.5" />
          Copy link
        </button>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
          PNG
        </button>
      </div>
    </div>
  );
}

/** Print-only sheet rendered outside the app shell; everything else is hidden while printing. */
function PrintSheet({ items, restaurant }: { items: { title: string; subtitle: string; url: string }[]; restaurant: string }) {
  return createPortal(
    <div id="qr-print-root" className="hidden">
      <style>{`
        @media print {
          body > *:not(#qr-print-root) { display: none !important; }
          #qr-print-root { display: block !important; }
          @page { margin: 12mm; }
        }
      `}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10mm' }}>
        {items.map((it) => (
          <div
            key={it.url}
            style={{
              breakInside: 'avoid',
              border: '1px dashed #cbd5e1',
              borderRadius: 8,
              padding: '6mm',
              textAlign: 'center',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            <div style={{ fontSize: 11, color: '#64748b' }}>{restaurant}</div>
            <div style={{ margin: '3mm auto', width: '42mm' }}>
              <QRCodeSVG value={it.url} size={320} level="M" marginSize={0} style={{ width: '100%', height: 'auto' }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{it.title}</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>{it.subtitle}</div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

export default function QrCodesPage(): JSX.Element {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: tenant, isLoading } = useTenant();

  const savedTables = useMemo(() => tenant?.tables ?? [], [tenant?.tables]);
  const [tables, setTables] = useState<string[]>(savedTables);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setTables(savedTables), [savedTables]);

  const dirty = tables.join('\n') !== savedTables.join('\n');
  const dineIn = !!tenant?.restaurantInfo?.dineInEnabled;
  const online = tenant?.restaurantInfo?.onlineSalesEnabled !== false;
  const base = tenant?.subdomain ? storefrontBase(tenant.subdomain) : '';
  const restaurant = tenant?.name ?? '';
  const keys = tenant?.tableKeys ?? {}; // each table's secret, part of its QR code (made when tables are saved)

  const addTables = () => {
    const { tables: parsed, invalid } = parseTableInput(input);
    if (invalid.length) {
      toastError(`Can't use: ${invalid.join(', ')} — letters, numbers and dashes only (max 12)`);
      return;
    }
    const next = [...new Set([...tables, ...parsed])];
    if (next.length > MAX_TABLES) {
      toastError(`Up to ${MAX_TABLES} tables`);
      return;
    }
    setTables(next.sort(naturalSort));
    setInput('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ tables }, token as string);
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Tables saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save tables');
    } finally {
      setSaving(false);
    }
  };

  const printItems = [
    ...(online && base ? [{ title: 'Order online', subtitle: 'Scan to order for pickup or delivery', url: onlineUrl(base) }] : []),
    ...(dineIn && base
      ? savedTables.map((t) => ({ title: `Table ${t}`, subtitle: 'Scan to order', url: tableUrl(base, t, keys[t]) }))
      : []),
  ];

  if (isLoading || !tenant) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[18px] font-semibold text-slate-900">
            <QrCodeIcon className="h-5 w-5 text-slate-600" />
            QR Codes
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Every code guests can scan. Table codes tell the kitchen where to bring the order.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={printItems.length === 0 || dirty}
          title={dirty ? 'Save your table changes first' : undefined}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          <PrinterIcon className="h-4 w-4" />
          Print all
        </button>
      </div>

      {online && (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
            <GlobeAltIcon className="h-4 w-4 text-slate-500" />
            Online storefront
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500">For flyers, social media, takeaway bags and your shop window.</p>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            <QrCard
              title="Order online"
              subtitle="Scan to order for pickup or delivery"
              url={onlineUrl(base)}
              filename={`${tenant.subdomain}-online-qr.png`}
            />
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-slate-900">
              Dine-in tables{dineIn && tables.length > 0 ? ` (${tables.length})` : ''}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              One code per table. Guests who scan it order straight to that table.
            </p>
          </div>
          {dineIn && dirty && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTables(savedTables)}
                className="text-xs text-slate-500 underline-offset-2 hover:underline"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save tables'}
              </button>
            </div>
          )}
        </div>

        {!dineIn ? (
          <div className="mt-3 rounded-xl border border-dashed border-[#e2e2e2] bg-white p-6 text-center text-[13px] text-slate-500">
            Dine-in is turned off for your restaurant, so there are no table codes.
          </div>
        ) : (
          <>
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTables();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Add tables — e.g. 1-20, Patio-1, A4"
                aria-label="Add tables"
                className="w-72 max-w-full rounded-md border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <PlusIcon className="h-4 w-4" />
                Add
              </button>
            </form>

            {tables.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[#e2e2e2] bg-white p-8 text-center">
                <QrCodeIcon className="mx-auto h-8 w-8 text-slate-300" />
                <div className="mt-2 text-[13px] text-slate-600">No tables yet</div>
                <div className="mt-1 text-[12px] text-slate-500">
                  Type a range like <span className="font-medium text-slate-700">1-12</span> above to create a code for
                  each table.
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                {tables.map((t) => (
                  <QrCard
                    key={t}
                    title={`Table ${t}`}
                    subtitle={keys[t] ? 'Scan to order' : 'Save to finish this code'}
                    url={tableUrl(base, t, keys[t])}
                    filename={`${tenant.subdomain}-table-${t}-qr.png`}
                    onRemove={() => setTables((prev) => prev.filter((x) => x !== t))}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <PrintSheet items={printItems} restaurant={restaurant} />
    </div>
  );
}
