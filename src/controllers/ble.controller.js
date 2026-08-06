import { issueBleToken, reportBleSightings } from '../services/ble.service.js';
import { checkInViaBleOnly } from '../services/user.service.js';

export const BleController = {
  // Toggle indépendant du consentement de politique globale : l'utilisateur
  // peut activer/désactiver la proximité Bluetooth à tout moment depuis les
  // réglages, sans re-accepter la politique de confidentialité entière.
  updateConsent: async (req, res, next) => {
    try {
      const { enabled } = req.body;
      const { User } = await import('../models/User.js');
      const user = await User.findByIdAndUpdate(
        req.user.id,
        { $set: { 'privacyPreferences.bluetoothProximity': !!enabled } },
        { new: true }
      ).select('-password');
      return res.json({ user });
    } catch (err) {
      next(err);
    }
  },
  issueToken: async (req, res, next) => {
    try {
      const result = await issueBleToken(req.user.id);
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
  reportSightings: async (req, res, next) => {
    try {
      const { sightings } = req.body;
      const result = await reportBleSightings(req.user.id, sightings);
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
  // Réseau disponible mais pas de position GPS exploitable (ex : sous-sol
  // avec wifi). Check-in basé uniquement sur les pairs BLE déjà confirmés.
  checkInViaBle: async (req, res, next) => {
    try {
      const result = await checkInViaBleOnly(req.user.id);
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
