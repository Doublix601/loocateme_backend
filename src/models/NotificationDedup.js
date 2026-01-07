import mongoose from 'mongoose';

const NotificationDedupSchema = new mongoose.Schema(
  {
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    viewerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: { type: String, required: true, index: true }, // e.g., 'social_click'
    // createdAt used for TTL
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// 24h TTL for dedup entries
NotificationDedupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
NotificationDedupSchema.index({ targetUser: 1, viewerUser: 1, eventType: 1 }, { unique: true });

export const NotificationDedup = mongoose.model('NotificationDedup', NotificationDedupSchema);
