import express, { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { deleteUser } from '../controllers/userController.js';

const router: Router = express.Router(); 

router.delete('/users/:id', authenticateJWT, deleteUser);

export default router;