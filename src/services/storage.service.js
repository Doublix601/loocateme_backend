import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseUploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
const profileDir = baseUploadDir;
const chatDir = path.join(baseUploadDir, 'chat');
// Médias pro publics (logo, cover, stories, PDF) : servis via /uploads comme bannerUrl/logoUrl
const businessMediaDir = path.join(baseUploadDir, 'business-media');
// Documents de candidature pro (KBIS, pièce d'identité...) : JAMAIS servis publiquement,
// uniquement via une route authentifiée réservée aux modérateurs (cf. businessClaim.routes.js)
const businessDocsDir = path.join(__dirname, '..', '..', process.env.BUSINESS_DOCS_DIR || 'data/business-docs');
if (!fs.existsSync(profileDir)) {
  fs.mkdirSync(profileDir, { recursive: true });
}
if (!fs.existsSync(chatDir)) {
  fs.mkdirSync(chatDir, { recursive: true });
}
if (!fs.existsSync(businessMediaDir)) {
  fs.mkdirSync(businessMediaDir, { recursive: true });
}
if (!fs.existsSync(businessDocsDir)) {
  fs.mkdirSync(businessDocsDir, { recursive: true });
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

// --- Comptes pro : documents de candidature (privés) ---
const businessDocsStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, businessDocsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '';
    const docType = String(req.body?.documentType || file.fieldname || 'doc').replace(/[^A-Za-z0-9_-]/g, '');
    const name = `claim_${docType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    cb(null, name);
  },
});

const businessDocsFileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type'));
};

export const uploadBusinessDocs = multer({
  storage: businessDocsStorage,
  fileFilter: businessDocsFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function businessDocAbsolutePath(filename) {
  return path.join(businessDocsDir, path.basename(String(filename || '')));
}

// --- Comptes pro : médias publics (logo, cover, stories, PDF menu/flyer) ---
const businessMediaStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, businessMediaDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.pdf'].includes(ext) ? ext : '';
    const kind = file.fieldname || 'media';
    const locationId = req.params?.locationId || 'loc';
    const name = `business_${locationId}_${kind}_${Date.now()}${safeExt}`;
    cb(null, name);
  },
});

const businessMediaFileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type'));
};

export const uploadBusinessMedia = multer({
  storage: businessMediaStorage,
  fileFilter: businessMediaFileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Construit l'URL publique absolue d'un média pro, alignée sur le pattern
// utilisé pour les photos de profil (profile.controller.js:uploadPhoto).
export function businessMediaPublicUrl(req, filename) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/business-media/${path.basename(String(filename || ''))}`;
}
