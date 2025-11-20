import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validate, validators } from '../middlewares/validators.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.post('/signup', validate(validators.signup), AuthController.signup);
router.post('/login', validate(validators.login), AuthController.login);
router.post('/refresh', AuthController.refresh);
router.post('/logout', requireAuth, AuthController.logout);
router.post('/forgot-password', validate(validators.forgot), AuthController.forgotPassword);
// Email verification
router.get('/verify-email', AuthController.verifyEmailGet);
router.post('/verify-email', AuthController.verifyEmailPost);
// Password reset via link with HTML form
router.get('/reset-password', AuthController.resetPasswordGet);
router.post('/reset-password', AuthController.resetPasswordPost);

export default router;
