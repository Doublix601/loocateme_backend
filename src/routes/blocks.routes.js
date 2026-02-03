import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { BlocksController } from '../controllers/blocks.controller.js';

const router = Router();

router.get('/', requireAuth, BlocksController.list);
router.post('/', requireAuth, validate(validators.blockUser), BlocksController.add);
router.delete('/:id', requireAuth, validate(validators.blockRemove), BlocksController.remove);

export default router;
