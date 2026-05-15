import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema(
  {
    osmId: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true },
    city: { type: String },
    type: { type: String, enum: ['Bar 🍺', 'Boîte de nuit 💃', 'Salle de sport 🏋️', 'Restaurant 🍴', 'Parc 🌳', 'Plage 🏖️', 'Parc d\'attractions 🎢', 'Café ☕', 'Bibliothèque 📚', 'Centre sportif 🏟️', 'Bowling 🎳', 'Éducation 🎓', 'Fast food 🍔', 'Cinéma 🎬', 'Glacier 🍦', 'TEST 🤖'], required: true },
    radius: { type: Number, default: 40 }, // Rayon de détection en mètres (réduit de 100 à 40 pour éviter les faux positifs)
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lon, lat]
    },
    popularity: { type: Number, default: 0 },
    stars: { type: Number, default: 0 }, // 0, 1, 2 ou 3 (recalculé par cron)
    lastOsmSyncAt: { type: Date }, // Date de la dernière sync OSM
    shouldDelete: { type: Boolean, default: false }, // Indique si le lieu doit être supprimé lors de la prochaine synchronisation
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    isPro: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'verified' }, // Par défaut verified pour l'instant
    description: { type: String },
    bannerUrl: { type: String },
    logoUrl: { type: String },
    template: { type: String, default: 'default' },
    documents: [{
      type: { type: String }, // 'KBIS', 'ID'
      url: { type: String },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
    }],
    media: [{
      type: { type: String }, // 'PDF', 'FLYER', 'MENU'
      url: { type: String },
      title: { type: String }
    }],
    stories: [{
      url: { type: String },
      expiresAt: { type: Date },
      createdAt: { type: Date, default: Date.now }
    }],
    analytics: {
      peakHours: [Number], // [12, 19, 20]
      ageGroups: {
        '18-24': { type: Number, default: 0 },
        '25-34': { type: Number, default: 0 },
        '35-44': { type: Number, default: 0 },
        '45+': { type: Number, default: 0 }
      }
    }
  },
  { timestamps: true }
);

LocationSchema.index({ location: '2dsphere' });

export const Location = mongoose.model('Location', LocationSchema);
