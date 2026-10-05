/**
 * Multipart upload for AI menu import: one PDF, or up to 10 menu photos ("file" and/or "files").
 * Shared by the dashboard import and the public quick demo.
 */
import type express from 'express';
import multer from 'multer';

// Print-ready menus with photos are often 30–50 MB; heavy pages are rendered down before the AI call.
const MAX_PDF_MB = Number(process.env.MENU_IMPORT_MAX_MB ?? 50);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_MB * 1024 * 1024, files: 11 },
});

// multer errors → friendly 4xx instead of a 500
export const uploadMenuFiles: express.RequestHandler = (req, res, next) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 10 },
  ])(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.fail(413, `File is too large (max ${MAX_PDF_MB} MB).`);
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.fail(400, 'Upload one PDF, or up to 10 photos.');
      }
      return res.fail(400, err.message);
    }
    next(err);
  });
};
