import mongoose from 'mongoose';

// Un doc par triplet (userId, otherUserId, locationId) : "userId a croisé
// otherUserId à locationId". Écrit symétriquement (A→B et B→A) pour que la
// lecture de la liste d'un utilisateur soit un simple scan indexé sur userId.
const CrossedPathSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    otherUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    lastSeenAt: { type: Date, required: true },
    crossCount: { type: Number, default: 1 },
  },
  { timestamps: true }
);

CrossedPathSchema.index({ userId: 1, locationId: 1, otherUserId: 1 }, { unique: true });
CrossedPathSchema.index({ userId: 1, lastSeenAt: -1 });

export const CrossedPath = mongoose.model('CrossedPath', CrossedPathSchema);
