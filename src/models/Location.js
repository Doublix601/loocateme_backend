import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema(
  {
    osmId: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['Bar 🍺', 'Boîte de nuit 💃', 'Salle de sport 🏋️', 'Restaurant 🍴', 'Parc 🌳', 'Plage 🏖️', 'Parc d\'attractions 🎢', 'Café ☕', 'Bibliothèque 📚', 'Centre sportif 🏟️', 'Bowling 🎳', 'Éducation 🎓', 'Espace restauration 🍱', 'Cinéma 🎬', 'Glacier 🍦'], required: true },
    radius: { type: Number, default: 100 }, // Rayon de détection en mètres
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lon, lat]
    },
    popularity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

LocationSchema.index({ location: '2dsphere' });

export const Location = mongoose.model('Location', LocationSchema);
