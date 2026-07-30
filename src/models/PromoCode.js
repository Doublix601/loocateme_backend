import mongoose from 'mongoose';

const PromoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    discountPercent: { type: Number, min: 1, max: 100 },
    trialDays: { type: Number, min: 1 },
    active: { type: Boolean, default: true },
    // Coupon Stripe créé uniquement si discountPercent est défini (le trial seul
    // n'a pas besoin de coupon, il passe par subscription_data.trial_period_days).
    stripeCouponId: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timesRedeemed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);
