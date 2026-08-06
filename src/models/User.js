import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const SocialSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin', 'youtube'],
      required: true,
    },
    handle: { type: String, required: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    password: { type: String, required: true, select: false },
    // Legacy single-name field kept for backward compatibility
    name: { type: String, default: '' },
    // New username field replacing legacy name for unique handle/display
    username: { type: String, default: '', index: true },
    // New display-related fields
    firstName: { type: String, default: '', index: true },
    lastName: { type: String, default: '', index: true },
    customName: { type: String, default: '', index: true },
    bio: { type: String, default: '' },
    profileImageUrl: { type: String, default: '' },
    profileViews: { type: Number, default: 0, index: true },
    // Rate-limit name changes
    lastUsernameChangeAt: { type: Date },
    // Split first/last name cooldowns: each field is independent
    lastFirstNameChangeAt: { type: Date },
    lastLastNameChangeAt: { type: Date },
    // Status field: 'green' | 'orange' | 'red'
    status: { type: String, enum: ['green', 'orange', 'red'], default: 'green', index: true },
    // Current location check-in: based on proximity
    currentLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    // Persistence threshold support
    pendingLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    pendingLocationSince: { type: Date, default: null },
    // Timestamp when user entered their current location (for 5-min minimum stay rule)
    currentLocationSince: { type: Date, default: null },
    // GDPR consent and privacy preferences
    consent: {
      accepted: { type: Boolean, default: false },
      version: { type: String, default: '' },
      consentAt: { type: Date },
    },
    // Privacy policy versioning (major.minor): last version explicitly
    // accepted by the user (required after a MAJOR bump) and last version
    // the user has seen the update banner for (used to dismiss MINOR bumps).
    policyVersionAccepted: { type: String, default: '' },
    policyVersionAcceptedAt: { type: Date },
    policyVersionSeen: { type: String, default: '' },
    policyVersionSeenAt: { type: Date },
    privacyPreferences: {
      analytics: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
      doNotSell: { type: Boolean, default: false },
      // Opt-in distinct du consentement de localisation GPS (finalité RGPD
      // différente : détection de proximité Bluetooth entre appareils, y
      // compris hors connexion réseau). Défaut false — activation explicite
      // requise via un écran de consentement dédié.
      bluetoothProximity: { type: Boolean, default: false },
    },
    // User role: 'user' (default), 'moderator', 'admin'
    role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user', index: true },
    // Account type: 'individual' (default, mobile app) vs 'business' (web-only, pro dashboard)
    accountType: { type: String, enum: ['individual', 'business'], default: 'individual', index: true },
    // Activation link for business accounts (set password + verify email in one step)
    businessActivationTokenHash: { type: String, index: true, select: false },
    businessActivationExpiresAt: { type: Date, select: false },
    // Optional demographics, opt-in via privacyPreferences.analytics, used for business location stats
    birthdate: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say'] },
    // Moderation & safety
    moderation: {
      warningsCount: { type: Number, default: 0 },
      lastWarningAt: { type: Date },
      lastWarningReason: { type: String, default: '' },
      lastWarningType: { type: String, default: '' },
      warningsHistory: {
        type: [
          {
            at: { type: Date, required: true },
            type: { type: String, default: '' },
            reason: { type: String, default: '' },
          },
        ],
        default: [],
      },
      bannedUntil: { type: Date },
      bannedAt: { type: Date },
      bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      bannedPermanent: { type: Boolean, default: false },
      banReason: { type: String, default: '' },
    },
    // Premium & Monetization
    isPremium: { type: Boolean, default: false, index: true },
    boostBalance: { type: Number, default: 0 },
    superlikeBalance: { type: Number, default: 0 },
    boostUntil: { type: Date, index: true },
    premiumTrialStart: { type: Date },
    premiumTrialEnd: { type: Date },
    // Source et expiration du premium "de base" (hors trial/boost, qui ont déjà leurs dates
    // dédiées ci-dessus) : nécessaire pour que le mois offert par le parrainage expire tout
    // seul sans toucher au flux Stripe (Stripe gère isPremium via ses propres webhooks et
    // laisse premiumExpiresAt à null).
    premiumSource: { type: String, enum: ['paid', 'trial', 'referral_reward', 'promo', null], default: null },
    premiumExpiresAt: { type: Date, default: null, index: true },
    // Récompense de parrainage gagnée pendant qu'un abonnement payant est déjà actif : mise en
    // attente, appliquée par le webhook Stripe d'annulation (payment.controller.js) au lieu
    // d'être perdue silencieusement.
    pendingReferralReward: { type: Boolean, default: false },
    lastAllowanceAt: { type: Date },
    expoPushToken: { type: String, index: true },
    // "Cote" : score de présence façon flammes Snapchat, utilisé pour trier
    // les utilisateurs d'un lieu (cf. cote.service.js)
    cotePercent: { type: Number, enum: [0, 25, 50, 75, 100], default: 100, index: true },
    lastLoginAt: { type: Date, default: Date.now },
    coteWarningSentAt: { type: Date, default: null },
    // Relance "X profils t'ont vu récemment" envoyée après 4h d'inactivité
    // (cf. engagement.service.js) : évite les envois répétés.
    profileViewsNudgeSentAt: { type: Date, default: null },
    // Séquence d'onboarding proactive J1/J3/J7 (cf. onboarding.service.js) :
    // jours déjà envoyés, pour ne jamais renvoyer le même palier.
    onboardingPushDaysSent: { type: [Number], default: [] },
    // Statut des permissions rapporté par l'app (cf. permissions.routes.js) :
    // sert à détecter les comptes "à risque" de désinstallation (ex: permission
    // localisation refusée sur une app dont l'usage dépend de la localisation).
    locationPermissionStatus: { type: String, enum: ['granted', 'denied', 'undetermined'], default: 'undetermined' },
    notificationsPermissionStatus: { type: String, enum: ['granted', 'denied', 'undetermined'], default: 'undetermined' },
    permissionStatusUpdatedAt: { type: Date, default: null },
    // Relance "at-risk" (permission refusée + inactivité) : évite les envois répétés.
    atRiskNudgeSentAt: { type: Date, default: null },
    // Détection best-effort d'une désinstallation (cf. push.service.js : ticket Expo
    // "DeviceNotRegistered"), avec le type de la dernière notification envoyée avant
    // coupure — sert à corréler un type de push à un pic de désinstallation.
    uninstalledAt: { type: Date, default: null },
    lastNotificationKindBeforeUninstall: { type: String, default: null },
    // Sondage de désabonnement, capté au moment où l'utilisateur désactive les
    // notifications ou révoque la localisation dans l'app (cf. churn.routes.js),
    // plutôt qu'après une désinstallation où il n'est plus joignable.
    churnSurveyReason: { type: String, default: null },
    churnSurveyContext: { type: String, default: null },
    churnSurveyAt: { type: Date, default: null },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lon, lat]
      updatedAt: { type: Date, default: Date.now },
    },
    socialNetworks: [SocialSchema],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Email verification and password reset
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerifyTokenHash: { type: String, index: true, select: false },
    emailVerifyExpiresAt: { type: Date, select: false },
    pwdResetTokenHash: { type: String, index: true, select: false },
    pwdResetExpiresAt: { type: Date, select: false },
    // Parrainage
    referralCode: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralStats: {
      currentMonthKey: { type: String, default: null }, // 'YYYY-MM' (UTC)
      currentMonthValidatedCount: { type: Number, default: 0 },
      totalValidatedCount: { type: Number, default: 0 },
      // Garde-fou "1 mois premium offert max à la fois" : bloque un nouvel octroi tant que
      // ce mois-ci a déjà déclenché une récompense, même si le compteur redépasse 5.
      lastRewardGrantedMonthKey: { type: String, default: null },
    },
  },
  { timestamps: true }
);

UserSchema.index({ location: '2dsphere' });
// Useful compound index for text-like searches on names/username
UserSchema.index({ username: 1, firstName: 1, lastName: 1, customName: 1, name: 1 });

UserSchema.methods.comparePassword = async function (candidate) {
  const hash = this.password;
  return bcrypt.compare(candidate, hash);
};

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

export const User = mongoose.model('User', UserSchema);
