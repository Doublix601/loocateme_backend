import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema(
  {
    osmId: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true },
    city: { type: String },
    type: { type: String, enum: [
      // ── Mode ☀️ Jour ──────────────────────────────────────────
      'Café ☕', 'Coworking 🧑‍💻', 'Salle de sport 🏋️', 'Centre sportif 🏟️',
      'Parc 🌳', 'Plage 🏖️', "Parc d'attractions 🎢", 'Bibliothèque 📚',
      'Éducation 🎓', 'Glacier 🍦',
      'Marché 🛒', 'Musée 🏛️', 'Brunch 🥞',
      // ── Mode 🌙 Nuit ──────────────────────────────────────────
      'Bar 🍺', 'Boîte de nuit 💃', 'Restaurant 🍴', 'Cinéma 🎬',
      'Bowling 🎳', 'Fast food 🍔',
      'Rooftop 🌆', 'Karaoké 🎤', 'Club de jeux 🎮',
      // ── Interne ───────────────────────────────────────────────
      'TEST 🤖',
    ], required: true },
    radius: { type: Number, default: 50 }, // Rayon de détection en mètres
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
    // Palier d'abonnement business ('none' = pas d'abonnement payant actif)
    businessTier: { type: String, enum: ['none', 'pro1', 'pro2', 'pro3'], default: 'none', index: true },
    subscription: {
      stripeCustomerId: { type: String },
      stripeSubscriptionId: { type: String, index: true },
      stripePriceId: { type: String },
      status: { type: String, enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete', ''], default: '' },
      currentPeriodEnd: { type: Date },
    },
    // Crédits consommables réservés au palier Pro3, recrédités à chaque cycle Stripe.
    // lastGrantedPeriodEnd (fin de période Stripe, timestamp unix) rend le crédit
    // idempotent : une seule attribution par période de facturation, que le lieu
    // l'atteigne via un abonnement initial, une facture de changement de palier
    // (proration) ou le renouvellement mensuel normal.
    proOffers: {
      ultraBoostBalance: { type: Number, default: 0 },
      proBoostBalance: { type: Number, default: 0 },
      lastGrantedPeriodEnd: { type: Number },
    },
    // Sponsorisation "Pro Boost" : un seul lieu actif à la fois (cf. SponsorshipSlot)
    sponsorship: {
      active: { type: Boolean, default: false, index: true },
      until: { type: Date },
      activatedAt: { type: Date },
    },
    analytics: {
      peakHours: [Number], // [12, 19, 20]
      ageGroups: {
        '18-24': { type: Number, default: 0 },
        '25-34': { type: Number, default: 0 },
        '35-44': { type: Number, default: 0 },
        '45+': { type: Number, default: 0 }
      },
      // Fréquentation par jour de semaine, index 0 = lundi ... 6 = dimanche
      visitsByWeekday: { type: [Number], default: [0, 0, 0, 0, 0, 0, 0] },
      genderSplit: {
        male: { type: Number, default: 0 },
        female: { type: Number, default: 0 },
        other: { type: Number, default: 0 },
      },
      avgAgeVisitors: { type: Number, default: null },
      lastComputedAt: { type: Date },
    }
  },
  { timestamps: true }
);

LocationSchema.index({ location: '2dsphere' });

export const Location = mongoose.model('Location', LocationSchema);
