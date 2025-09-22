import express from 'express';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoriesController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { categorySchema, categoryUpdateSchema } from '../validation/schemas.js';

const router: express.Router = express.Router();

router.get('/categories', authenticateJWT, applyScope, authorize('categories:read'), listCategories);

router.post(
  '/categories',
  authenticateJWT,
  applyScope,
  authorize('categories:create'),
  validateRequest(categorySchema),
  createCategory
);

router.post(
  '/categories/:id/update',
  authenticateJWT,
  applyScope,
  authorize('categories:update'),
  validateRequest(categoryUpdateSchema),
  updateCategory
);

router.post(
  '/categories/:id/delete',
  authenticateJWT,
  applyScope,
  authorize('categories:delete'),
  deleteCategory
);

export default router;