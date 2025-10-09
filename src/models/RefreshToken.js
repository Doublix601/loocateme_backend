import mongoose from 'mongoose';

const RefreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const RefreshToken = mongoose.model('RefreshToken', RefreshTokenSchema);
