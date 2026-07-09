import { Location } from '../models/Location.js';

const TIER_RANK = { none: 0, pro1: 1, pro2: 2, pro3: 3 };

// Charge le lieu ciblé par :locationId et vérifie que l'utilisateur connecté
// en est bien le propriétaire (relation 1:1 business user <-> Location.ownerId).
export async function requireLocationOwner(req, res, next) {
  try {
    const { locationId } = req.params;
    const location = await Location.findById(locationId);
    if (!location) return res.status(404).json({ code: 'LOCATION_NOT_FOUND', message: 'Lieu introuvable' });
    if (String(location.ownerId) !== String(req.user.id)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: "Vous ne gérez pas ce lieu" });
    }
    req.location = location;
    next();
  } catch (err) {
    next(err);
  }
}

// À utiliser après requireLocationOwner. Vérifie que le palier d'abonnement du
// lieu couvre au moins `minTier` ('pro1' | 'pro2' | 'pro3').
export function requireBusinessTier(minTier) {
  return (req, res, next) => {
    const current = TIER_RANK[req.location?.businessTier] ?? 0;
    const required = TIER_RANK[minTier] ?? 0;
    if (current < required) {
      return res.status(403).json({ code: 'TIER_REQUIRED', message: `Palier ${minTier} requis`, requiredTier: minTier });
    }
    next();
  };
}
