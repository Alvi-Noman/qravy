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
import {
  categorySchema,
  categoryUpdateSchema,
  listCategoriesQuerySchema, // ⬅️ add
} from '../validation/schemas.js';

const router: express.Router = express.Router();

// Inline query validator since validateRequest expects one (body) schema
const validateListQuery: express.RequestHandler = (req, res, next) => {
  const parsed = listCategoriesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || 'Invalid query params';
    return res.fail(400, msg);
  }
  next();
};

router.get(
  '/categories',
  authenticateJWT,
  applyScope,
  authorize('categories:read'),
  validateListQuery,
  listCategories
);

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