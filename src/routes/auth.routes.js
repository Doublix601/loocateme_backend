import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validate, validators } from '../middlewares/validators.js';
import { requireAuth } from '../middlewares/auth.js';
import { loginLimiter, signupLimiter, forgotPasswordLimiter } from '../middlewares/rateLimit.js';

const router = Router();

router.post('/signup', signupLimiter, validate(validators.signup), AuthController.signup);
router.post('/login', loginLimiter, validate(validators.login), AuthController.login);
router.post('/refresh', AuthController.refresh);
router.post('/logout', requireAuth, AuthController.logout);
router.post('/forgot-password', forgotPasswordLimiter, validate(validators.forgot), AuthController.forgotPassword);
// Comptes professionnels (site Web uniquement)
router.post('/business/login', loginLimiter, validate(validators.login), AuthController.businessLogin);
router.get('/business/activate', AuthController.businessActivateGet);
router.post('/business/activate', AuthController.businessActivatePost);
// Email verification
router.get('/verify-email', AuthController.verifyEmailGet);
router.post('/verify-email', AuthController.verifyEmailPost);
// Password reset via link with HTML form
router.get('/reset-password', AuthController.resetPasswordGet);
router.post('/reset-password', AuthController.resetPasswordPost);

export default router;
