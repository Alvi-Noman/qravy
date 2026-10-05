/**
 * Quick demo — public, no account (the braincell page /quick-demo)
 *   POST /public/quick-demo              multipart menu photos (or one PDF) → starts a demo, returns its key
 *   GET  /public/quick-demo/:key         status; once ready, the subdomain + table key for the storefront link
 *   POST /public/quick-demo/:key/name    { name } — the restaurant's name
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
import { HttpError } from '../utils/httpError.js';
import { uploadMenuFiles } from '../middleware/menuUpload.js';
import { readMenuUploads } from '../controllers/menuImportsController.js';
import { isMenuImportConfigured } from '../services/menuImport/extractor.js';
import { createDemo, getDemo, nameDemo } from '../services/quickDemo.js';

const router: express.Router = express.Router();

// Every demo costs AI calls — cap how many one visitor can start
const createLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: Number(process.env.QUICK_DEMO_MAX_PER_HOUR ?? 15),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV !== 'production',
  message: { message: 'Too many demos from this device. Please try again in an hour.' },
});

function fail(res: Response, next: NextFunction, err: unknown, label: string) {
  if (err instanceof HttpError) return res.fail(err.status, err.message);
  logger.error(`${label} error: ${(err as Error).message}`);
  next(err);
}

router.post('/public/quick-demo', createLimiter, uploadMenuFiles, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isMenuImportConfigured()) {
      return res.fail(503, 'AI menu import is not configured on this server (missing OPENAI_API_KEY).');
    }
    const parsed = await readMenuUploads(req);
    if (!parsed.ok) return res.fail(parsed.status, parsed.message);
    const demo = await createDemo(parsed.source, parsed.pageCount, parsed.fileName);
    return res.ok({ demo }, 202);
  } catch (err) {
    fail(res, next, err, 'createDemo');
  }
});

router.get('/public/quick-demo/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const demo = await getDemo(String(req.params.key));
    if (!demo) return res.fail(404, 'This demo has expired or does not exist.');
    return res.ok({ demo });
  } catch (err) {
    fail(res, next, err, 'getDemo');
  }
});

router.post('/public/quick-demo/:key/name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const demo = await nameDemo(String(req.params.key), name);
    if (!demo) return res.fail(404, 'This demo has expired or does not exist.');
    return res.ok({ demo });
  } catch (err) {
    fail(res, next, err, 'nameDemo');
  }
});

export default router;
