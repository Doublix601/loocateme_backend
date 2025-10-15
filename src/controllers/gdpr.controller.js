import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPolicyText() {
  // Minimal policy placeholder; in production, serve from static file or CMS
  const policyPath = path.join(__dirname, '..', '..', 'POLICY_PRIVACY.md');
  try {
    if (fs.existsSync(policyPath)) {
      return fs.readFileSync(policyPath, 'utf8');
    }
  } catch (_e) { /* ignore */ }
  return 'Politique de confidentialité: Nous collectons les données nécessaires au fonctionnement de l\'application (email, nom, localisation si activée, médias). Vous pouvez demander l\'export ou la suppression de vos données à tout moment.';
}

export const GdprController = {
  async getPolicy(req, res) {
    const text = getPolicyText();
    return res.json({ policy: text, version: 'v1' });
  },

  async updateConsent(req, res) {
    const userId = req.user.id;
    const { accepted, version, analytics = false, marketing = false } = req.body || {};
    const user = await User.findById(userId);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
    user.consent = {
      accepted: !!accepted,
      version: String(version || 'v1'),
      consentAt: accepted ? new Date() : user.consent?.consentAt,
    };
    user.privacyPreferences = { analytics: !!analytics, marketing: !!marketing };
    await user.save();
    return res.json({ success: true, user: sanitizeUser(user) });
  },

  async exportData(req, res) {
    const userId = req.user.id;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });

    // Build export bundle
    const exportObj = {
      meta: {
        exportedAt: new Date().toISOString(),
        version: '1.0',
      },
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        bio: user.bio,
        profileImageUrl: user.profileImageUrl,
        isVisible: user.isVisible,
        consent: user.consent || {},
        privacyPreferences: user.privacyPreferences || {},
        location: user.location || {},
        socialNetworks: user.socialNetworks || [],
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="loocateme-data-export.json"');
    return res.status(200).send(JSON.stringify(exportObj, null, 2));
  },

  async deleteAccount(req, res) {
    const userId = req.user.id;
    const { password } = req.body || {};

    const user = await User.findById(userId).select('+password');
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });

    // Verify password for safety before deletion
    const ok = await bcrypt.compare(String(password || ''), user.password);
    if (!ok) return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Mot de passe invalide' });

    // Remove refresh tokens
    await RefreshToken.deleteMany({ user: user._id });

    // Attempt to delete uploaded files owned by user (profileImageUrl)
    if (user.profileImageUrl) {
      try {
        const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
        // profileImageUrl may be absolute URL; try to map to uploads folder
        const url = user.profileImageUrl;
        const idx = url.indexOf('/uploads/');
        if (idx >= 0) {
          const rel = url.substring(idx + '/uploads/'.length);
          const p = path.join(uploadsDir, rel);
          fs.unlink(p, () => {});
        }
      } catch (_e) { /* ignore */ }
    }

    await User.deleteOne({ _id: user._id });

    return res.json({ success: true });
  },
};

function sanitizeUser(user) {
  const u = user.toJSON ? user.toJSON() : user;
  delete u.password;
  return u;
}
