import mongoose from 'mongoose';

const FcmTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

FcmTokenSchema.index({ user: 1, token: 1 }, { unique: true });

export const FcmToken = mongoose.model('FcmToken', FcmTokenSchema);
