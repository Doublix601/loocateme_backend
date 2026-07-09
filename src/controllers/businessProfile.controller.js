import { Location } from '../models/Location.js';
import { businessMediaPublicUrl } from '../services/storage.service.js';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

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
      req.location.bannerUrl = businessMediaPublicUrl(req, req.file.filename);
      await req.location.save();
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  updateLogo: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED', message: 'Fichier requis' });
      req.location.logoUrl = businessMediaPublicUrl(req, req.file.filename);
      await req.location.save();
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

  addStory: async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED', message: 'Fichier requis' });
      req.location.stories.push({
        url: businessMediaPublicUrl(req, req.file.filename),
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
      req.location.stories = req.location.stories.filter((s) => String(s._id) !== req.params.storyId);
      await req.location.save();
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
      req.location.media.push({
        type: 'PDF',
        url: businessMediaPublicUrl(req, req.file.filename),
        title,
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
