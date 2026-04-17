import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema(
  {
    osmId: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true },
    city: { type: String },
    type: { type: String, enum: ['Bar 🍺', 'Boîte de nuit 💃', 'Salle de sport 🏋️', 'Restaurant 🍴', 'Parc 🌳', 'Plage 🏖️', 'Parc d\'attractions 🎢', 'Café ☕', 'Bibliothèque 📚', 'Centre sportif 🏟️', 'Bowling 🎳', 'Éducation 🎓', 'Espace restauration 🍱', 'Cinéma 🎬', 'Glacier 🍦', 'Lieu 📍', 'TEST 🤖'], required: true },
    radius: { type: Number, default: 100 }, // Rayon de détection en mètres
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lon, lat]
    },
    popularity: { type: Number, default: 0 },
    stars: { type: Number, default: 0 }, // 0, 1, 2 ou 3 (recalculé par cron)
    lastOsmSyncAt: { type: Date }, // Date de la dernière sync OSM
    shouldDelete: { type: Boolean, default: false }, // Indique si le lieu doit être supprimé lors de la prochaine synchronisation
  },
  { timestamps: true }
);

LocationSchema.index({ location: '2dsphere' });

export const Location = mongoose.model('Location', LocationSchema);
