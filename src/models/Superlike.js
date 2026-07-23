import mongoose from 'mongoose';

const SuperlikeSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending', index: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SuperlikeSchema.index({ target: 1, createdAt: -1 });
SuperlikeSchema.index({ sender: 1, createdAt: -1 });
SuperlikeSchema.index({ sender: 1, target: 1 }, { unique: true });
SuperlikeSchema.index({ target: 1, status: 1 });

export const Superlike = mongoose.model('Superlike', SuperlikeSchema);
