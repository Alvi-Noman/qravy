/**
 * AI menu import routes (PDF → reviewed draft → menu)
 */
import express from 'express';
import multer from 'multer';
import {
  createMenuImport,
  listMenuImports,
  getMenuImport,
  saveMenuImportDraft,
  commitMenuImport,
} from '../controllers/menuImportsController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { menuImportCommitSchema, menuImportDraftSchema } from '../validation/schemas.js';

const router: express.Router = express.Router();

// Print-ready menus with photos are often 30–50 MB; heavy pages are rendered down before the AI call.
const MAX_PDF_MB = Number(process.env.MENU_IMPORT_MAX_MB ?? 50);

// One PDF, or up to 10 menu photos ("file" and/or "files")
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_MB * 1024 * 1024, files: 11 },
});

// multer errors → friendly 4xx instead of a 500
const uploadPdf: express.RequestHandler = (req, res, next) => {
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

const canImport = authorize(['menuItems:create', 'categories:create']);

router.post('/menu-imports', authenticateJWT, applyScope, canImport, uploadPdf, createMenuImport);

router.get('/menu-imports', authenticateJWT, applyScope, authorize('menuItems:read'), listMenuImports);

router.get('/menu-imports/:id', authenticateJWT, applyScope, authorize('menuItems:read'), getMenuImport);

router.patch(
  '/menu-imports/:id/draft',
  authenticateJWT,
  applyScope,
  canImport,
  validateRequest(menuImportDraftSchema),
  saveMenuImportDraft
);

router.post(
  '/menu-imports/:id/commit',
  authenticateJWT,
  applyScope,
  canImport,
  validateRequest(menuImportCommitSchema),
  commitMenuImport
);

export default router;
