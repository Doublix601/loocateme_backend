import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { PrivacyPolicy, compareVersions, parseVersion } from '../models/PrivacyPolicy.js';
import { enqueuePolicyEmailJob } from '../services/policyNotification.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback used only if no version has ever been published in DB (fresh install).
function getFallbackPolicy() {
  const policyPath = path.join(__dirname, '..', '..', 'POLICY_PRIVACY.md');
  try {
    if (fs.existsSync(policyPath)) {
      return fs.readFileSync(policyPath, 'utf8');
    }
  } catch (_e) { /* ignore */ }
  return 'Politique de confidentialité: Nous collectons les données nécessaires au fonctionnement de l\'application (email, nom, localisation si activée, médias). Vous pouvez demander l\'export ou la suppression de vos données à tout moment.';
}

export const GdprController = {
  // GET /api/gdpr/policy (public) — full text of the latest published version.
  async getPolicy(req, res) {
    const latest = await PrivacyPolicy.getLatest().lean();
    if (latest) {
      return res.json({
        policy: latest.content,
        version: latest.version,
        changelog: latest.changelog,
        changeType: latest.changeType,
        requiresConsent: latest.requiresConsent,
        publishedAt: latest.publishedAt,
      });
    }
    return res.json({ policy: getFallbackPolicy(), version: '1.0', changelog: '', changeType: 'major', requiresConsent: true, publishedAt: null });
  },

  // GET /api/gdpr/policy-status (auth) — tells the app whether this user must
  // be blocked (MAJOR bump not yet accepted) and/or shown a dismissible
  // banner (newer version not yet seen).
  async getPolicyStatus(req, res) {
    const latest = await PrivacyPolicy.getLatest().lean();
    const user = await User.findById(req.user.id).select('policyVersionAccepted policyVersionAcceptedAt policyVersionSeen consent').lean();
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });

    if (!latest) {
      return res.json({ currentVersion: null, blocking: false, hasUnseenUpdate: false });
    }

    const userAccepted = user.policyVersionAccepted || '';
    const userSeen = user.policyVersionSeen || '';

    // Users who never completed the initial consent are handled by the
    // existing consent.accepted gate, not by this endpoint.
    const blocking = !!user.consent?.accepted && latest.major > parseVersion(userAccepted).major;
    const hasUnseenUpdate = !blocking
      && compareVersions(latest.version, userSeen) > 0
      && compareVersions(latest.version, userAccepted) > 0;

    return res.json({
      currentVersion: latest.version,
      currentMajor: latest.major,
      currentMinor: latest.minor,
      changelog: latest.changelog,
      publishedAt: latest.publishedAt,
      requiresConsent: latest.requiresConsent,
      userAcceptedVersion: userAccepted,
      userAcceptedAt: user.policyVersionAcceptedAt || null,
      blocking,
      hasUnseenUpdate,
    });
  },

  // PUT /api/gdpr/policy (admin only) — publish a new version.
  // Body: { content: string, changelog: string, changeType: 'major'|'minor', version?: string }
  // `changeType` is always an explicit choice — never inferred from the version string.
  async updatePolicy(req, res) {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const changelog = typeof req.body?.changelog === 'string' ? req.body.changelog.trim() : '';
    const changeType = req.body?.changeType;

    if (!content) {
      return res.status(400).json({ code: 'CONTENT_REQUIRED', message: 'Le contenu de la politique est requis' });
    }
    if (changeType !== 'major' && changeType !== 'minor') {
      return res.status(400).json({ code: 'CHANGE_TYPE_REQUIRED', message: "Le champ changeType doit être 'major' ou 'minor'" });
    }

    const latest = await PrivacyPolicy.getLatest();
    if (!latest && changeType !== 'major') {
      return res.status(400).json({ code: 'FIRST_VERSION_MUST_BE_MAJOR', message: 'La première version publiée doit être majeure' });
    }

    let version = typeof req.body?.version === 'string' && req.body.version.trim() ? req.body.version.trim() : null;
    let major;
    let minor;
    if (version) {
      if (!/^\d+\.\d+$/.test(version)) {
        return res.status(400).json({ code: 'VERSION_INVALID', message: 'Format attendu: majeur.mineur (ex: 3.1)' });
      }
      ({ major, minor } = parseVersion(version));
    } else if (changeType === 'major') {
      major = (latest?.major || 0) + 1;
      minor = 0;
      version = `${major}.${minor}`;
    } else {
      major = latest.major;
      minor = latest.minor + 1;
      version = `${major}.${minor}`;
    }

    const existing = await PrivacyPolicy.findOne({ version });
    if (existing) {
      return res.status(409).json({ code: 'VERSION_EXISTS', message: `La version ${version} existe déjà` });
    }

    const doc = await PrivacyPolicy.create({
      version,
      major,
      minor,
      content,
      changelog,
      changeType,
      requiresConsent: changeType === 'major',
      publishedAt: new Date(),
      updatedBy: req.user.id,
    });

    try {
      await enqueuePolicyEmailJob(doc);
    } catch (e) {
      console.error('[gdpr] Failed to enqueue policy email job:', e?.message || e);
    }

    return res.status(201).json({ success: true, policy: doc });
  },

  // PUT /api/gdpr/policy/accept (auth) — explicitly accept the current latest
  // version. Used by the blocking modal after a MAJOR bump, and by the
  // initial consent screen for brand-new users.
  async acceptPolicyVersion(req, res) {
    const latest = await PrivacyPolicy.getLatest();
    if (!latest) {
      return res.status(404).json({ code: 'NO_POLICY', message: 'Aucune politique publiée' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });

    const now = new Date();
    user.consent = { accepted: true, version: latest.version, consentAt: now };
    user.policyVersionAccepted = latest.version;
    user.policyVersionAcceptedAt = now;
    user.policyVersionSeen = latest.version;
    user.policyVersionSeenAt = now;
    await user.save();

    return res.json({ success: true, user: sanitizeUser(user) });
  },

  // PUT /api/gdpr/policy/seen (auth) — dismiss the non-blocking banner shown
  // for a MINOR update. Never required for MAJOR updates (those go through accept).
  async markPolicyVersionSeen(req, res) {
    const latest = await PrivacyPolicy.getLatest();
    if (!latest) return res.json({ success: true });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });

    user.policyVersionSeen = latest.version;
    user.policyVersionSeenAt = new Date();
    await user.save();

    return res.json({ success: true });
  },

  // PUT /api/gdpr/consent (auth) — initial GDPR opt-in + privacy preferences.
  // Kept for the existing signup/settings flow; also stamps the version
  // fields so a first-time acceptance counts as accepting the latest policy.
  async updateConsent(req, res) {
    const userId = req.user.id;
    const { accepted, analytics = false, marketing = false, doNotSell = false } = req.body || {};
    const user = await User.findById(userId);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'User not found' });

    const latest = await PrivacyPolicy.getLatest();
    const now = new Date();
    user.consent = {
      accepted: !!accepted,
      version: accepted ? (latest?.version || 'v1') : (user.consent?.version || ''),
      consentAt: accepted ? now : user.consent?.consentAt,
    };
    if (accepted && latest) {
      user.policyVersionAccepted = latest.version;
      user.policyVersionAcceptedAt = now;
      user.policyVersionSeen = latest.version;
      user.policyVersionSeenAt = now;
    }
    user.privacyPreferences = { analytics: !!analytics, marketing: !!marketing, doNotSell: !!doNotSell };
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
