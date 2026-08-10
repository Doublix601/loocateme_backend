import mongoose from 'mongoose';

const NotificationDedupSchema = new mongoose.Schema(
  {
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    viewerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: { type: String, required: true, index: true }, // e.g., 'social_click', 'profile_view'
    // Date d'expiration explicite fixée à la création (ex: now + 45min pour
    // 'profile_view', now + 24h pour 'social_click') — permet à chaque
    // eventType d'avoir sa propre fenêtre de dedup sur une même collection,
    // plutôt qu'une seule durée fixe partagée par tous les types.
    expireAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

NotificationDedupSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
NotificationDedupSchema.index({ targetUser: 1, viewerUser: 1, eventType: 1 }, { unique: true });

export const NotificationDedup = mongoose.model('NotificationDedup', NotificationDedupSchema);
