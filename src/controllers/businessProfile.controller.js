import fs from 'fs';
import path from 'path';
import { Location } from '../models/Location.js';
import { businessMediaPublicUrl } from '../services/storage.service.js';
import { processImage, processVideo, extractVideoThumbnail } from '../services/mediaProcessing.service.js';
import { localPathFromUrl } from '../utils/uploadPaths.js';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MEDIA_PDF = 3;
const MEDIA_ICONS = ['document', 'menu', 'drinks', 'events', 'pricing', 'info'];

export function deleteOldMediaFile(oldUrl) {
  if (!oldUrl) return;
  const p = localPathFromUrl(oldUrl);
  if (p && fs.existsSync(p)) fs.unlink(p, () => {});
}

export const BusinessProfileController = {
  // Résout le lieu géré par le compte pro connecté (relation 1:1 ownerId <-> business user).
  // Utilisé par le site juste après connexion pour décider paywall vs dashboard.
  getMyLocation: async (req, res, next) => {
    try {
      const location = await Location.findOne({ ownerId: req.user.id }).lean();
      if (!location) {
        return res.status(404).json({ code: 'NO_LOCATION_OWNED', message: "Aucun lieu associé à ce compte pro" });
      }
      return res.json({ location });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    // req.location déjà chargé par requireLocationOwner
    return res.json({ location: req.location });
  },

  updateCover: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED', message: 'Fichier requis' });
      const oldUrl = req.location.bannerUrl;
      const processedFilename = await processImage(req.file.path, { maxWidth: 1600, maxHeight: 1600 });
      req.location.bannerUrl = businessMediaPublicUrl(req, processedFilename);
      await req.location.save();
      deleteOldMediaFile(oldUrl);
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  updateLogo: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED', message: 'Fichier requis' });
      const oldUrl = req.location.logoUrl;
      const processedFilename = await processImage(req.file.path, { maxWidth: 800, maxHeight: 800 });
      req.location.logoUrl = businessMediaPublicUrl(req, processedFilename);
      await req.location.save();
      deleteOldMediaFile(oldUrl);
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  removeCover: async (req, res, next) => {
    try {
      const oldUrl = req.location.bannerUrl;
      req.location.bannerUrl = '';
      await req.location.save();
      deleteOldMediaFile(oldUrl);
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  removeLogo: async (req, res, next) => {
    try {
      const oldUrl = req.location.logoUrl;
      req.location.logoUrl = '';
      await req.location.save();
      deleteOldMediaFile(oldUrl);
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  addStory: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED', message: 'Fichier requis' });
      if (!req.location.logoUrl) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          code: 'LOGO_REQUIRED',
          message: 'Ajoutez une photo de profil avant de publier une story.',
        });
      }

      const isVideo = req.file.mimetype.startsWith('video/');
      let mediaType = 'image';
      let thumbnailUrl;
      let finalFilename;

      if (isVideo) {
        mediaType = 'video';
        finalFilename = await processVideo(req.file.path, { maxHeight: 1280 });
        const finalAbsPath = path.join(path.dirname(req.file.path), finalFilename);
        const thumbFilename = await extractVideoThumbnail(finalAbsPath);
        thumbnailUrl = businessMediaPublicUrl(req, thumbFilename);
      } else {
        finalFilename = await processImage(req.file.path, { maxWidth: 1080, maxHeight: 1920 });
      }

      req.location.stories.push({
        url: businessMediaPublicUrl(req, finalFilename),
        mediaType,
        thumbnailUrl,
        expiresAt: new Date(Date.now() + STORY_TTL_MS),
      });
      await req.location.save();
      return res.status(201).json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  removeStory: async (req, res, next) => {
    try {
      const story = req.location.stories.find((s) => String(s._id) === req.params.storyId);
      req.location.stories = req.location.stories.filter((s) => String(s._id) !== req.params.storyId);
      await req.location.save();
      if (story) {
        deleteOldMediaFile(story.url);
        deleteOldMediaFile(story.thumbnailUrl);
      }
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  addMedia: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED', message: 'Fichier requis' });
      const title = String(req.body?.title || '').trim();
      if (!title) return res.status(400).json({ code: 'TITLE_REQUIRED', message: 'Libellé requis' });
      const existingPdfCount = req.location.media.filter((m) => m.type === 'PDF').length;
      if (existingPdfCount >= MAX_MEDIA_PDF) {
        return res.status(400).json({ code: 'MEDIA_LIMIT_REACHED', message: `Maximum ${MAX_MEDIA_PDF} PDF par lieu` });
      }
      const icon = MEDIA_ICONS.includes(req.body?.icon) ? req.body.icon : 'document';
      req.location.media.push({
        type: 'PDF',
        url: businessMediaPublicUrl(req, req.file.filename),
        title,
        icon,
      });
      await req.location.save();
      return res.status(201).json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  removeMedia: async (req, res, next) => {
    try {
      req.location.media = req.location.media.filter((m) => String(m._id) !== req.params.mediaId);
      await req.location.save();
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },
};
