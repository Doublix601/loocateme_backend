import mongoose from 'mongoose';

// Candidature de revendication d'un lieu par un professionnel, avant création
// de tout compte utilisateur. Le compte User(accountType:'business') n'est
// créé qu'à l'approbation par la modération (cf. businessClaim.service.js).
const BusinessClaimRequestSchema = new mongoose.Schema(
  {
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    applicantEmail: { type: String, required: true, lowercase: true, index: true },
    applicantName: { type: String, required: true },
    applicantPhone: { type: String, default: '' },
    documents: [{
      type: { type: String, enum: ['KBIS', 'ID', 'LEASE_PROOF'], required: true },
      url: { type: String, required: true },
    }],
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    createdUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

BusinessClaimRequestSchema.index({ status: 1, createdAt: -1 });

export const BusinessClaimRequest = mongoose.model('BusinessClaimRequest', BusinessClaimRequestSchema);
