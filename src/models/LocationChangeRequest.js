import mongoose from 'mongoose';

// Changement détecté sur OpenStreetMap pour un lieu déjà revendiqué par un
// pro (Location.isPro === true). Plutôt que d'écraser directement les champs
// du lieu (cf. scripts/syncLocations.js), on met le changement en attente ici
// et on notifie le gérant (email + bannière dashboard) pour qu'il valide ou
// rejette — évite qu'une modification malveillante sur OSM ne modifie
// silencieusement la fiche d'un lieu revendiqué.
const LocationChangeRequestSchema = new mongoose.Schema(
  {
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    // Valeurs proposées par la sync OSM, uniquement les champs qui diffèrent.
    proposedChanges: {
      name: { type: String },
      city: { type: String },
      location: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number] },
      },
    },
    // Valeurs actuelles au moment de la détection, pour affichage du diff.
    previousValues: {
      name: { type: String },
      city: { type: String },
      location: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number] },
      },
    },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

LocationChangeRequestSchema.index({ locationId: 1, status: 1 });

export const LocationChangeRequest = mongoose.model('LocationChangeRequest', LocationChangeRequestSchema);
