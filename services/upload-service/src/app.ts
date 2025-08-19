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

app.get('/health', (_req, res) => res.json({ ok: true }));

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
    const key = `images/${hash}.${ext}`;

    let exists = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      exists = true;
    } catch {}

    if (!exists) {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: processed,
          ContentType: ft.mime,
          Metadata: {
            sha256: hash,
            filename: String(file.originalFilename || '').slice(0, 200)
          }
        })
      );
    }

    const base = `${IMAGEKIT}/${key}`;
    const payload: UploadResponse = {
      ok: true,
      key,
      hash,
      mime: ft.mime,
      size: processed.length,
      cdn: {
        original: `${base}?tr=f-auto,q-90`,
        thumbnail: `${base}?tr=w-200,h-200,fo-auto,f-auto,q-80`,
        medium: `${base}?tr=w-800,h-800,fo-auto,f-auto,q-85`,
        large: `${base}?tr=w-1600,h-1600,fo-auto,f-auto,q-85`
      }
    };

    return res.json(payload);
  } catch (err: unknown) {
    // Safely check error type without using `any`
    const e = err as { code?: string };
    if (e.code === 'ETOOBIG') return res.status(413).json({ error: 'File too large (max 20MB)' });
    return res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/i/:key(*)', (req, res) => {
  const { key } = req.params as { key: string };
  const { w, h, q, format, lossless } = req.query;
  const tr: string[] = [];
  if (w) tr.push(`w-${Number(w)}`);
  if (h) tr.push(`h-${Number(h)}`);
  if (q) tr.push(`q-${Number(q)}`);
  if (String(format) === 'auto') tr.push('f-auto');
  if (String(format) === 'webp') tr.push('f-webp');
  if (String(format) === 'avif') tr.push('f-avif');
  if (String(lossless) === 'true') tr.push('lossless-true');
  tr.push('fo-auto');
  const url = `${IMAGEKIT}/${key}${tr.length ? `?tr=${tr.join(',')}` : ''}`;
  return res.redirect(302, url);
});

export default app;
