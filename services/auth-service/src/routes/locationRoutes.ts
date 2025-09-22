import { Router, type RequestHandler } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  getDefaultLocation,
  setDefaultLocation,
  clearDefaultLocation,
} from '../controllers/locationsController.js';

const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const router: import('express').Router = Router();

router.use(authenticateJWT);

// Per-user default location — keep BEFORE param routes
router.get('/default', asyncHandler(getDefaultLocation));
router.put('/default', asyncHandler(setDefaultLocation));
router.delete('/default', asyncHandler(clearDefaultLocation));

// Locations CRUD
router.get('/', asyncHandler(listLocations));
router.post('/', asyncHandler(createLocation));

// Constrain :id to ObjectId to avoid matching "default"
router.patch('/:id([0-9a-fA-F]{24})', asyncHandler(updateLocation));
router.delete('/:id([0-9a-fA-F]{24})', asyncHandler(deleteLocation));

export default router;