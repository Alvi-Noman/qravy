/**
 * AI menu import routes (PDF → reviewed draft → menu)
 */
import express from 'express';
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
import { uploadMenuFiles } from '../middleware/menuUpload.js';
import { menuImportCommitSchema, menuImportDraftSchema } from '../validation/schemas.js';

const router: express.Router = express.Router();

const canImport = authorize(['menuItems:create', 'categories:create']);

router.post('/menu-imports', authenticateJWT, applyScope, canImport, uploadMenuFiles, createMenuImport);

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
