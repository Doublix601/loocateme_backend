import mongoose from 'mongoose';

// type: 'profile_view' | 'social_click' | 'user_search'
const EventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: ['profile_view', 'social_click', 'user_search'] },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    // For social_click events
    socialNetwork: { type: String, enum: ['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin', 'youtube'], index: true },
    // Free-form query for user_search (optional)
    query: { type: String },
    meta: { type: Object, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

EventSchema.index({ type: 1, createdAt: -1 });
EventSchema.index({ targetUser: 1, createdAt: -1 });
EventSchema.index({ actor: 1, createdAt: -1 });

export const Event = mongoose.model('Event', EventSchema);
