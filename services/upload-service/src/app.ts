import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import formidable from 'formidable';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

type UploadResponse = {
  ok: boolean;
  key: string;
  hash: string;
  mime: string;
  size: number;
  cdn: {
    original: string;
    thumbnail: string;
    medium: string;
    large: string;
  };
};

// Minimal shape we use from formidable's File
type FormFile = { filepath: string; originalFilename?: string | null };

const app: import('express').Express = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true
  })
);

app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
  })
);

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
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

const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || '';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const EXT_MAP = new Map([
  ['jpeg', 'jpg'],
  ['jpg', 'jpg'],
  ['png', 'png'],
  ['webp', 'webp'],
  ['avif', 'avif']
]);

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!UPLOAD_TOKEN) return res.status(500).json({ error: 'Server misconfigured' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== UPLOAD_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/uploads/images', auth, async (req, res) => {
  try {
    const form = formidable({
      multiples: false,
      maxFileSize: 20 * 1024 * 1024,
      allowEmptyFiles: false
    });

    const [, files] = (await form.parse(req)) as [unknown, Record<string, FormFile | FormFile[]>];

    // Get the uploaded file (prefer field name "file", else take first)
    let file: FormFile | undefined;
    const byName = files?.file;
    if (byName) file = Array.isArray(byName) ? byName[0] : byName;
    if (!file) {
      const first = Object.values(files || {})[0];
      file = Array.isArray(first) ? first?.[0] : first;
    }
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

    const hash = createHash('sha256').update(processed).digest('hex');
    const ext = EXT_MAP.get(ft.ext) || 'bin';
    const key = PREFIX ? `${PREFIX}/${hash}.${ext}` : `${hash}.${ext}`;

    // Skip upload if already exists
    let exists = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      exists = true;
    } catch {
      // not found -> continue
    }

    if (!exists) {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: processed,
          ContentType: ft.mime
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
        original: `${base}${T_ORIG ? `?tr=${T_ORIG}` : ''}`,
        thumbnail: `${base}?tr=${T_THUMB}`,
        medium: `${base}?tr=${T_MD}`,
        large: `${base}?tr=${T_LG}`
      }
    };

    return res.json(payload);
  } catch (err: any) {
    if (err?.code === 'ETOOBIG') return res.status(413).json({ error: 'File too large (max 20MB)' });
    return res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/i/*', (req, res) => {
  const key = (req.params as any)[0] as string;
  if (!key) return res.status(400).json({ error: 'Missing key' });

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