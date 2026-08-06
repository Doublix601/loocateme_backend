import mongoose from 'mongoose';

// Une "sighting" = un utilisateur (userId) a détecté un autre utilisateur
// (peerUserId) à proximité immédiate via Bluetooth Low Energy (RSSI). Sert
// uniquement à départager deux lieux voisins ambigus lors du check-in GPS
// (cf. ble.service.js) — jamais affiché tel quel à l'utilisateur.
//
// Minimisation des données (RGPD art. 5.1.c) : expire automatiquement après
// 30 minutes via l'index TTL ci-dessous, largement suffisant pour la
// disambiguation de check-in (fenêtre de fraîcheur utilisée : 5 min).
const BleSightingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    peerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rssi: { type: Number, required: true },
    seenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

BleSightingSchema.index({ userId: 1, peerUserId: 1 }, { unique: true });
BleSightingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const BleSighting = mongoose.model('BleSighting', BleSightingSchema);
