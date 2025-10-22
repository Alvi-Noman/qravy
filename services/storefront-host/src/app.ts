// services/storefront-host/src/app.ts
import express, { type Application, type Request } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';

const PORT = Number(process.env.PORT || 8090);

// IMPORTANT:
// - No localhost fallback here. In dev, set TASTEBUD_DEV_URL explicitly
//   to http://host.docker.internal:<vite-port> so the container can reach Vite.
const TASTEBUD_DEV_URL = process.env.TASTEBUD_DEV_URL;

// Prefer Docker service name for container-to-container in dev.
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://api-gateway:8080';

// ---- CORS allow-list
const RAW_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

type OriginAllow = boolean | string | RegExp | Array<string | RegExp>;
type OriginCallback = (err: Error | null, allow?: OriginAllow) => void;
type CustomOrigin = (origin: string | undefined, cb: OriginCallback) => void;

const corsOrigin: CustomOrigin = (origin, cb) => {
  if (!origin) return cb(null, true);
  if (RAW_ORIGINS.includes(origin)) return cb(null, true);
  try {
    const url = new URL(origin);
    if (
      url.protocol === 'https:' &&
      ['qravy.com', 'onqravy.com'].some(
        (root) => url.hostname === root || url.hostname.endsWith(`.${root}`)
      )
    ) {
      return cb(null, true);
    }
  } catch {
    /* ignore */
  }
  return cb(new Error('Not allowed by CORS'));
};

export function createApp(): Application {
  if (!TASTEBUD_DEV_URL) {
    // Fail fast with a helpful message instead of silently pointing at the wrong place.
    throw new Error(
      '[storefront-host] Missing TASTEBUD_DEV_URL. Set it to http://host.docker.internal:<vite-port> in services/storefront-host/.env'
    );
  }

  const app = express();

  app.set('trust proxy', 1);
  app.use(morgan('dev'));
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json());

  console.log(
    `[storefront-host] PORT=${PORT} GATEWAY_URL=${GATEWAY_URL} TASTEBUD_DEV_URL=${TASTEBUD_DEV_URL}`
  );

  // Health
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  /* ========================= API proxy -> Gateway =========================
   * Mount at /api. Express sets baseUrl="/api" and url="/v1/...".
   * We must forward baseUrl + url so the gateway receives "/api/v1/...".
   */
  const apiProxy = createProxyMiddleware({
    target: GATEWAY_URL,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    secure: false,
    proxyTimeout: 15000,
    timeout: 15000,

    pathRewrite: (_path, req) => {
      const base = (req as any).baseUrl || ''; // "/api"
      const url = req.url || '';               // "/v1/..."
      return `${base}${url}`;
    },

    on: {
      proxyReq(proxyReq: ClientRequest, req: IncomingMessage) {
        const eReq = req as unknown as Request & { body?: unknown };

        // Drop cookies/auth for public endpoints to avoid 431s
        const rawUrl = (eReq.originalUrl || eReq.url || '').toLowerCase();
        if (rawUrl.startsWith('/api/v1/public/')) {
          proxyReq.removeHeader('cookie');
          proxyReq.removeHeader('authorization');
        }

        if (!proxyReq.getHeader('accept')) {
          proxyReq.setHeader('accept', 'application/json');
        }

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
          if (proxyRes.headers) {
            delete proxyRes.headers.etag;
            delete proxyRes.headers['last-modified'];
            proxyRes.headers['cache-control'] = 'no-store';
          }
          res.removeHeader('ETag');
          res.setHeader('Cache-Control', 'no-store');
        } catch {
          /* noop */
        }
      },

      error(err, _req, res) {
        const sres = res as unknown as ServerResponse;
        if (typeof (sres as any)?.setHeader === 'function' && typeof (sres as any)?.end === 'function') {
          if (!(sres as any).headersSent) {
            sres.statusCode = 502;
            sres.setHeader('Content-Type', 'application/json');
            sres.end(
              JSON.stringify({
                message: 'Bad gateway (storefront-host could not reach API gateway)',
                code: (err as any).code || 'E_PROXY',
              })
            );
          }
        } else {
          try {
            (res as any)?.end?.();
          } catch {
            /* noop */
          }
        }
      },
    },
  });

  // Mount proxy at /api — upstream will receive /api/v1/... because of pathRewrite above.
  app.use('/api', apiProxy);

  /* ========================= Frontend proxy -> Tastebud dev ========================= */
  app.use(
    '/',
    createProxyMiddleware({
      target: TASTEBUD_DEV_URL,
      changeOrigin: true,
      ws: true,
      secure: false,
      selfHandleResponse: true,
      on: {
        proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
          // Detect HTML using proxy response headers (more reliable than res.getHeader here)
          const ctHeader =
            (proxyRes.headers?.['content-type'] as string | undefined) ||
            res.getHeader('content-type')?.toString() ||
            '';
          if (!ctHeader.includes('text/html')) return buffer;

          const raw = buffer.toString('utf8');
          const host =
            (req.headers['x-forwarded-host'] as string | undefined) ??
            (req.headers.host ?? 'localhost');
          const proto =
            (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
          const reqUrl = new URL((req.url || '/'), `${proto}://${host}`);
          const pathname = (reqUrl.pathname || '/').toLowerCase();
          const search = reqUrl.searchParams;

          const tenant = resolveTenantFromHost(host);
          const channel = parseChannel(pathname, search);
          const branch = search.get('branch');

          const html = injectRuntime(raw, {
            subdomain: tenant,
            channel,
            branch,
            apiBase: '/api/v1',
          });

          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return html;
        }),
      },
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
