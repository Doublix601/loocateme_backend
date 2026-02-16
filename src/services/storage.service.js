import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseUploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
const profileDir = baseUploadDir;
const chatDir = path.join(baseUploadDir, 'chat');
if (!fs.existsSync(profileDir)) {
  fs.mkdirSync(profileDir, { recursive: true });
}
if (!fs.existsSync(chatDir)) {
  fs.mkdirSync(chatDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, profileDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '';
    const name = `profile_${req.user?.id || 'anon'}_${Date.now()}${safeExt}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type'));
};

const chatStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, chatDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.m4v', '.webm'].includes(ext) ? ext : '';
    const name = `chat_${req.user?.id || 'anon'}_${Date.now()}${safeExt}`;
    cb(null, name);
  },
});

const chatFileFilter = (_req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm',
  ];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type'));
};

export const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
export const uploadChatMedia = multer({ storage: chatStorage, fileFilter: chatFileFilter, limits: { fileSize: 25 * 1024 * 1024 } });
