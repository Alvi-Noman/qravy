import { Router } from 'express';
import { login, signup } from '../controllers/authController.js';

const router: Router = Router();

router.post('/login', login);
router.post('/signup', signup);

export default router;