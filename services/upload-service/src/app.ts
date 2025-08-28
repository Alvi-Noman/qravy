/**
 * Upload Service
 *
 * Stores a single normalized original image in Cloudflare R2 and returns
 * ImageKit CDN URLs (using named transforms). Auth via shared Bearer token.
 *
 * Env:
 * - PORT
 * - CORS_ORIGIN (comma-separated)
 * - R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * - IMAGEKIT_URL_ENDPOINT
 * - UPLOAD_TOKEN
 * - R2_PREFIX (default "images")
 * - IK_T_THUMB, IK_T_MD, IK_T_LG, IK_T_ORIGINAL
 */
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import formidable, { Fields, Files } from 'formidable';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

type CdnUrls = { original: string; thumbnail: string; medium: string; large: string };
type UploadResponse = { ok: boolean; key: string; hash: string; mime: string; size: number; cdn: CdnUrls };

const app: express.Express = express();

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true
  })
);

const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
  }
});

const BUCKET = process.env.R2_BUCKET || '';
const IMAGEKIT = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
const PREFIX = (process.env.R2_PREFIX || 'images').replace(/^\/+|\/+$/g, '');
const T_THUMB = process.env.IK_T_THUMB || 'n-thumb';
const T_MD = process.env.IK_T_MD || 'n-md';
const T_LG = process.env.IK_T_LG || 'n-lg';
const T_ORIG = (process.env.IK_T_ORIGINAL || 'f-auto,q-90').trim();

/**
 * Auth middleware. Expects Authorization: Bearer <UPLOAD_TOKEN>.
 */
function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!process.env.UPLOAD_TOKEN) return res.status(500).json({ error: 'Server misconfigured' });
  if (token !== process.env.UPLOAD_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const EXT_MAP = new Map([
  ['jpeg', 'jpg'],
  ['jpg', 'jpg'],
  ['png', 'png'],
  ['webp', 'webp'],
  ['avif', 'avif']
]);

/**
 * Produce ASCII-only metadata value for HTTP headers.
 * - ascii: best-effort readable filename for x-amz-meta-filename
 * - b64: lossless UTF-8 base64 if you need to recover original name later
 */
function toSafeFilenameMeta(original: string) {
  const ascii = original.normalize('NFKD').replace(/[^\x20-\x7E]+/g, '').slice(0, 180) || 'file';
  const b64 = Buffer.from(original, 'utf8').toString('base64').slice(0, 1024);
  return { ascii, b64 };
}

/**
 * Health probe.
 */
app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /api/uploads/images
 * Body: multipart/form-data with "file"
 * Returns: UploadResponse with ImageKit CDN URLs.
 */
app.post('/api/uploads/images', auth, async (req, res) => {
  try {
    const form = formidable({
      multiples: false,
      maxFileSize: 20 * 1024 * 1024,
      allowEmptyFiles: false
    });

    const [, files]: [Fields, Files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: 'No file' });

    const source = await readFile(file.filepath);
    const ft = await fileTypeFromBuffer(source);
    if (!ft || !ALLOWED_MIME.has(ft.mime)) return res.status(415).json({ error: 'Unsupported file type' });

    let processed: Buffer;
    try {
      processed = await sharp(source).rotate().toBuffer();
    } catch {
      return res.status(422).json({ error: 'Corrupted or unreadable image' });
    }

    const hash = crypto.createHash('sha256').update(processed).digest('hex');
    const ext = EXT_MAP.get(ft.ext) || 'bin';
    const key = PREFIX ? `${PREFIX}/${hash}.${ext}` : `${hash}.${ext}`;

    let exists = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      exists = true;
    } catch {}

    if (!exists) {
      const origName = String(file.originalFilename || '');
      const { ascii: metaName, b64: metaNameB64 } = toSafeFilenameMeta(origName);

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: processed,
            ContentType: ft.mime,
            Metadata: {
              sha256: hash,
              filename: metaName,
              filename_b64: metaNameB64
            }
          })
        );
      } catch (err) {
        const msg = String((err as any)?.message || '');
        if (/invalid character in header content/i.test(msg)) {
          return res.status(400).json({ error: 'Invalid filename metadata' });
        }
        throw err;
      }
    }

    const base = `${IMAGEKIT}/${key}`;
    const payload: UploadResponse = {
      ok: true,
      key,
      hash,
      mime: ft.mime,
      size: processed.length,
      cdn: {
        original: `${base}${T_ORIG ? `?tr=${T_ORIG}` : ''}`,
        thumbnail: `${base}?tr=${T_THUMB}`,
        medium: `${base}?tr=${T_MD}`,
        large: `${base}?tr=${T_LG}`
      }
    };

    return res.json(payload);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ETOOBIG') return res.status(413).json({ error: 'File too large (max 20MB)' });
    return res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * GET /i/:key(*) — redirect to ImageKit with URL-driven transforms.
 * Query: w,h,q,format=auto|webp|avif,lossless=true,dpr,blur
 */
app.get('/i/:key(*)', (req, res) => {
  const { key } = req.params as { key: string };
  const { w, h, q, format, lossless, dpr, blur } = req.query;
  const tr: string[] = [];
  if (w) tr.push(`w-${Number(w)}`);
  if (h) tr.push(`h-${Number(h)}`);
  if (q) tr.push(`q-${Number(q)}`);
  if (dpr) tr.push(`dpr-${Number(dpr)}`);
  if (blur) tr.push(`bl-${Number(blur)}`);
  if (String(format) === 'auto') tr.push('f-auto');
  if (String(format) === 'webp') tr.push('f-webp');
  if (String(format) === 'avif') tr.push('f-avif');
  if (String(lossless) === 'true') tr.push('lossless-true');
  tr.push('fo-auto');
  const url = `${IMAGEKIT}/${key}${tr.length ? `?tr=${tr.join(',')}` : ''}`;
  return res.redirect(302, url);
});

export default app;