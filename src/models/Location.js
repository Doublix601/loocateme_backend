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
    // Miniatures légères générées en même temps que bannerUrl/logoUrl (cf.
    // processImageWithThumb dans mediaProcessing.service.js), utilisées pour les
    // vignettes en liste (LocationListScreen côté app) afin d'éviter de télécharger
    // la pleine résolution. Absentes pour les lieux dont la photo n'a pas été
    // remise à jour depuis l'ajout de cette fonctionnalité : fallback côté client
    // vers bannerUrl/logoUrl dans ce cas.
    bannerThumbUrl: { type: String },
    logoUrl: { type: String },
    logoThumbUrl: { type: String },
    template: { type: String, default: 'default' },
    documents: [{
      type: { type: String }, // 'KBIS', 'ID'
      url: { type: String },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
    }],
    media: [{
      type: { type: String }, // 'PDF', 'FLYER', 'MENU'
      url: { type: String },
      title: { type: String },
      // Icône prédéfinie choisie par le pro sur le dashboard business pour ce PDF,
      // affichée dans l'app — cf. liste partagée loocateme-app/constants/pdfIcons.js
      // et loocateme_website src/lib/pdfIcons.ts.
      icon: {
        type: String,
        enum: ['document', 'menu', 'drinks', 'events', 'pricing', 'info'],
        default: 'document',
      },
    }],
    stories: [{
      url: { type: String },
      mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
      thumbnailUrl: { type: String }, // frame extraite pour les vidéos, absent pour les images
      expiresAt: { type: Date },
      createdAt: { type: Date, default: Date.now },
      // 'ready' pour les images (traitées en synchrone) ; les vidéos passent par
      // 'processing' le temps du transcodage ffmpeg en tâche de fond (cf. queue.js),
      // puis 'ready' ou 'failed' une fois le worker terminé.
      status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'ready' },
    }],
    // Palier d'abonnement business ('none' = pas d'abonnement payant actif)
    businessTier: { type: String, enum: ['none', 'pro1', 'pro2', 'pro3'], default: 'none', index: true },
    subscription: {
      stripeCustomerId: { type: String },
      stripeSubscriptionId: { type: String, index: true },
      stripePriceId: { type: String },
      status: { type: String, enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete', ''], default: '' },
      currentPeriodEnd: { type: Date },
      // true entre la résiliation demandée par le pro et la fin de la période payée :
      // l'abonnement (et donc businessTier) reste actif jusqu'à currentPeriodEnd, puis
      // Stripe termine l'abonnement sans le renouveler.
      cancelAtPeriodEnd: { type: Boolean, default: false },
    },
    // Date à laquelle les données premium (banner/logo/stories/media) doivent être
    // définitivement supprimées par le cron de purge (cf. cron.service.js), après un
    // délai de grâce de 7 jours suivant la perte de l'abonnement. undefined = aucune
    // purge programmée. Ce délai permet au pro de tout récupérer automatiquement s'il
    // se réabonne dans ce laps de temps (ex : incident de paiement).
    premiumDataPurgeAt: { type: Date, index: true },
    // Crédits consommables réservés au palier Pro3, recrédités à chaque cycle Stripe.
    // lastGrantedPeriodEnd (fin de période Stripe, timestamp unix) rend le crédit
    // idempotent : une seule attribution par période de facturation, que le lieu
    // l'atteigne via un abonnement initial, une facture de changement de palier
    // (proration) ou le renouvellement mensuel normal.
    proOffers: {
      ultraBoostBalance: { type: Number, default: 0 },
      proBoostBalance: { type: Number, default: 0 },
      // "Event Boost" : notification push géociblée pour annoncer un événement,
      // réservée au palier pro3. Cf. src/constants/boosts.js pour le plafond.
      eventBoostBalance: { type: Number, default: 0 },
      lastGrantedPeriodEnd: { type: Number },
    },
    // Sponsorisation "Pro Boost" : un seul lieu actif à la fois (cf. SponsorshipSlot)
    sponsorship: {
      active: { type: Boolean, default: false, index: true },
      until: { type: Date },
      activatedAt: { type: Date },
    },
    // Événements créés par le pro (palier pro2+), affichés sur la fiche du lieu
    // (LocationScreen côté app) tant que non expirés. Plusieurs événements
    // peuvent coexister. L'Event Boost (palier pro3+, cf. businessBoost.controller.js)
    // ne fait qu'envoyer une notification pour un événement de cette liste,
    // il ne crée pas de contenu.
    events: [{
      title: { type: String, required: true },
      body: { type: String },
      mediaUrl: { type: String },
      mediaType: { type: String, enum: ['image', 'video'] },
      thumbnailUrl: { type: String },
      eventDate: { type: Date },
      createdAt: { type: Date, default: Date.now },
      // Dernier envoi d'Event Boost pour cet événement, null si jamais boosté.
      boostedAt: { type: Date },
      // eventDate + 1 jour si eventDate fourni à la création, sinon null :
      // l'événement reste affiché jusqu'à suppression manuelle par le pro.
      expiresAt: { type: Date },
      // Cf. stories.status : 'ready' pour image/pas de média, 'processing' pendant
      // le transcodage vidéo en tâche de fond, 'failed' si le worker a échoué.
      status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'ready' },
    }],
    // Fenêtre d'offre "Ultra Boost" : période pendant laquelle la bannière "20min sur
    // place = boost de profil gratuit" doit s'afficher sur la fiche du lieu, en écho au
    // texte de la notification push envoyée par broadcastUltraBoost (ultraBoost.service.js).
    ultraBoost: {
      active: { type: Boolean, default: false },
      until: { type: Date },
      activatedAt: { type: Date },
      // Utilisateurs ayant déjà réclamé le boost de profil gratuit pour CETTE activation
      // (remis à zéro à chaque nouvelle activation, cf. businessBoost.controller.js).
      claimedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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
