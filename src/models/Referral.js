import mongoose from 'mongoose';

// Log dédié (plutôt que de simples compteurs sur User) pour garder l'historique
// parrain/filleul et permettre l'anti-fraude (unique index sur `referred`).
const ReferralSchema = new mongoose.Schema(
  {
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // unique: un utilisateur ne peut être parrainé qu'une seule fois, par un seul parrain —
    // c'est l'invariant anti-fraude principal.
    referred: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    code: { type: String, required: true },
    redeemedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'validated', 'void'], default: 'pending', index: true },
    validatedAt: { type: Date },
    validatedMonthKey: { type: String, index: true }, // 'YYYY-MM' (UTC)
    voidReason: { type: String },
  },
  { timestamps: true }
);

ReferralSchema.index({ referrer: 1, validatedMonthKey: 1, status: 1 });

export const Referral = mongoose.model('Referral', ReferralSchema);
