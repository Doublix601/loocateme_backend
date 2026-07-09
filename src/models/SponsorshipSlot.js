import mongoose from 'mongoose';

// Singleton verrouillant le "Pro Boost" actif (un seul lieu sponsorisé à la
// fois, globalement). Un unique document _id:'GLOBAL' permet un
// compare-and-swap atomique via findOneAndUpdate (cf. businessBoost.controller.js).
const SponsorshipSlotSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'GLOBAL' },
    activeLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
    until: { type: Date, default: null },
  },
  { timestamps: true }
);

export const SponsorshipSlot = mongoose.model('SponsorshipSlot', SponsorshipSlotSchema);
