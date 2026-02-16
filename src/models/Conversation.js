import mongoose from 'mongoose';

const ReadStateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastReadAt: { type: Date },
    lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  },
  { _id: false }
);

const ConversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    pairKey: { type: String, required: true, unique: true, index: true },
    lastMessageAt: { type: Date },
    lastMessageText: { type: String, default: '' },
    lastMessageType: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
    lastMessageSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readStates: { type: [ReadStateSchema], default: [] },
  },
  { timestamps: true }
);

ConversationSchema.index({ participants: 1, updatedAt: -1 });

export const Conversation = mongoose.model('Conversation', ConversationSchema);
