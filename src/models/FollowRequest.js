import mongoose from 'mongoose';

const FollowRequestSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending', index: true },
    respondedAt: { type: Date },
  },
  { timestamps: true }
);

FollowRequestSchema.index({ requester: 1, target: 1 }, { unique: true });
FollowRequestSchema.index({ target: 1, status: 1, createdAt: -1 });

export const FollowRequest = mongoose.model('FollowRequest', FollowRequestSchema);
