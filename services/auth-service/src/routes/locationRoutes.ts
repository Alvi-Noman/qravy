import { Router, type RequestHandler } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} from '../controllers/locationsController.js';

const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const router: import('express').Router = Router();

router.use(authenticateJWT);

router.get('/', asyncHandler(listLocations));
router.post('/', asyncHandler(createLocation));
router.patch('/:id', asyncHandler(updateLocation));
router.delete('/:id', asyncHandler(deleteLocation));

export default router;