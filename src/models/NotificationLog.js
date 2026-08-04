import mongoose from 'mongoose';

// Journal léger des pushs envoyés, utilisé pour corréler un type de
// notification à une désinstallation (cf. push.service.js) ou à une
// désactivation ultérieure des notifications. Purgé automatiquement après
// 60 jours (fenêtre largement suffisante pour l'analyse de corrélation,
// cohérent avec le principe de minimisation des données déjà appliqué
// ailleurs, cf. cron.service.runPrivacyCleanup).
const NotificationLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, required: true, index: true }, // ex: 'cote_expiring', 'onboarding_day1', 'inactive_profile_views'
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

NotificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const NotificationLog = mongoose.model('NotificationLog', NotificationLogSchema);
