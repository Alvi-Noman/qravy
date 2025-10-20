import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';

const PORT = Number(process.env.PORT || 8090);
const TASTEBUD_DEV_URL = process.env.TASTEBUD_DEV_URL || 'http://localhost:5174';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

// ---- CORS allow-list
const RAW_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Define a local type for the origin callback. This avoids relying on cors's named types.
type OriginAllow =
  | boolean
  | string
  | RegExp
  | Array<string | RegExp>;
type OriginCallback = (err: Error | null, allow?: OriginAllow) => void;
type CustomOrigin = (origin: string | undefined, cb: OriginCallback) => void;

const corsOrigin: CustomOrigin = (origin, cb) => {
  if (!origin) return cb(null, true); // SSR/tools/no Origin -> allow
  if (RAW_ORIGINS.includes(origin)) return cb(null, true);

  try {
    const url = new URL(origin);
    if (
      url.protocol === 'https:' &&
      ['qravy.com', 'onqravy.com'].some(
        root => url.hostname === root || url.hostname.endsWith(`.${root}`)
      )
    ) {
      return cb(null, true);
    }
  } catch {
    // ignore parse errors
  }
  return cb(new Error('Not allowed by CORS'));
};

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);
  app.use(morgan('dev'));
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json());

  /* ========================= API proxy -> Gateway ========================= */
  const apiProxy = createProxyMiddleware({
    target: GATEWAY_URL,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    on: {
      proxyReq(proxyReq: ClientRequest, req: IncomingMessage, _res: ServerResponse) {
        // Cast to Express req only when needed
        const eReq = req as unknown as Request & { body?: unknown };

        const method = (eReq.method || 'GET').toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

        const hasBody = eReq.body && Object.keys(eReq.body as object).length > 0;
        if (!hasBody) return;

        const ct = (proxyReq.getHeader('content-type') as string | undefined) || '';
        if (!ct.includes('application/json')) return;

        const body = JSON.stringify(eReq.body);
        proxyReq.setHeader('content-length', Buffer.byteLength(body));
        proxyReq.write(body);
      },
      proxyRes(proxyRes: IncomingMessage, _req: IncomingMessage, res: ServerResponse) {
        try {
          if ((proxyRes as any).headers) {
            const h = (proxyRes as any).headers as Record<string, string | string[] | undefined>;
            delete h.etag;
            delete h['last-modified'];
            h['cache-control'] = 'no-store';
          }
          res.removeHeader('ETag');
          res.setHeader('Cache-Control', 'no-store');
        } catch {
          /* noop */
        }
      }
    }
  });
  app.use('/api/v1', apiProxy);

  /* ========================= Frontend proxy -> Tastebud dev ========================= */
  app.use(
    '/',
    createProxyMiddleware({
      target: TASTEBUD_DEV_URL,
      changeOrigin: true,
      ws: true,
      selfHandleResponse: true, // we will possibly rewrite HTML
      on: {
        proxyRes: async (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
          const headers = (proxyRes as any).headers as Record<string, string | string[] | undefined>;
          const contentType = (headers?.['content-type'] || '').toString();
          const isHtml = contentType.includes('text/html');

          if (!isHtml) {
            // passthrough for assets
            res.writeHead((proxyRes as any).statusCode || 200, headers as any);
            (proxyRes as any).pipe(res);
            return;
          }

          // collect HTML
          const chunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          proxyRes.on('end', async () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            // Build a URL from the incoming request to parse path/query safely
            const host = (req.headers['x-forwarded-host'] as string | undefined) ?? (req.headers.host ?? 'localhost');
            const reqUrl = new URL(req.url || '/', `http://${host}`);
            const pathname = reqUrl.pathname.toLowerCase();
            const search = reqUrl.searchParams;

            const tenant = resolveTenantFromHost(host);
            const channel = parseChannel(pathname, search);
            const branch = search.get('branch');

            const html = injectRuntime(raw, {
              subdomain: tenant,
              channel,
              branch,
              apiBase: '/api/v1'
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          });
        }
      }
    })
  );

  return app;
}

/* ========================= helpers ========================= */

function resolveTenantFromHost(hostHeader: string | undefined): string | null {
  const host = hostHeader || '';
  const hostname = (host.split(':')[0] ?? '').toLowerCase();

  const roots = ['onqravy.com', 'qravy.com'];
  for (const root of roots) {
    if (hostname === root) return null;
    if (hostname.endsWith(`.${root}`)) {
      const sub = hostname.slice(0, -(root.length + 1));
      return sub || null;
    }
  }
  return null;
}

function parseChannel(
  pathname: string,
  search: URLSearchParams
): 'dine-in' | 'online' | null {
  if (pathname.startsWith('/dine-in')) return 'dine-in';
  if (pathname.startsWith('/online')) return 'online';
  const q = (search.get('channel') || '').toLowerCase();
  if (q === 'dine-in' || q === 'online') return q as 'dine-in' | 'online';
  return null;
}

function injectRuntime(html: string, payload: {
  subdomain: string | null;
  channel: 'dine-in' | 'online' | null;
  branch: string | null;
  apiBase: string;
}): string {
  const snippet = `<script>window.__STORE__=${JSON.stringify(payload)};</script>`;

  if (html.includes('</head>')) return html.replace('</head>', `${snippet}\n</head>`);
  if (html.includes('</body>')) return html.replace('</body>', `${snippet}\n</body>`);
  return `${snippet}\n${html}`;
}
