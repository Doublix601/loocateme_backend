import mongoose from 'mongoose';

const WaitlistSignupSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Trace de consentement minimale (l'endpoint est public et sans double
    // opt-in : n'importe qui peut soumettre l'email de quelqu'un d'autre).
    // Ni requis ni exposé à l'utilisateur, juste conservé pour pouvoir
    // répondre à une demande de suppression/RGPD.
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

export const WaitlistSignup = mongoose.model('WaitlistSignup', WaitlistSignupSchema);
