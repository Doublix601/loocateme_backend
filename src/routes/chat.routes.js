import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { ChatController } from '../controllers/chat.controller.js';
import { uploadChatMedia } from '../services/storage.service.js';

const router = Router();

router.get('/conversations', requireAuth, ChatController.listConversations);
router.get('/conversations/:id/messages', requireAuth, ChatController.getMessages);
router.post('/messages', requireAuth, ChatController.sendMessage);
router.post('/conversations/:id/read', requireAuth, ChatController.markRead);

router.post('/media', requireAuth, uploadChatMedia.fields([
  { name: 'media', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const mediaFile = req.files?.media?.[0];
  if (!mediaFile) return res.status(400).json({ code: 'MEDIA_REQUIRED', message: 'Media requis' });
  const thumbnailFile = req.files?.thumbnail?.[0];
  const mediaUrl = `${baseUrl}/uploads/chat/${mediaFile.filename}`;
  const thumbnailUrl = thumbnailFile ? `${baseUrl}/uploads/chat/${thumbnailFile.filename}` : '';
  return res.json({ mediaUrl, thumbnailUrl, mimeType: mediaFile.mimetype });
});

export default router;
