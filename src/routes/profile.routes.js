import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { ProfileController } from '../controllers/profile.controller.js';
import { upload } from '../services/storage.service.js';

const router = Router();

router.put('/', requireAuth, validate(validators.profileUpdate), ProfileController.update);
router.post('/photo', requireAuth, upload.single('photo'), ProfileController.uploadPhoto);
router.delete('/photo', requireAuth, ProfileController.deletePhoto);

export default router;
