import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

MessageSchema.index({ conversation: 1, createdAt: -1 });

export const Message = mongoose.model('Message', MessageSchema);
