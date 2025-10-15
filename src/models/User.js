import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const SocialSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin'],
      required: true,
    },
    handle: { type: String, required: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    password: { type: String, required: true, select: false },
    name: { type: String, default: '' },
    bio: { type: String, default: '' },
    profileImageUrl: { type: String, default: '' },
    isVisible: { type: Boolean, default: true },
    // GDPR consent and privacy preferences
    consent: {
      accepted: { type: Boolean, default: false },
      version: { type: String, default: '' },
      consentAt: { type: Date },
    },
    privacyPreferences: {
      analytics: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lon, lat]
      updatedAt: { type: Date, default: Date.now },
    },
    socialNetworks: [SocialSchema],
  },
  { timestamps: true }
);

UserSchema.index({ location: '2dsphere' });

UserSchema.methods.comparePassword = async function (candidate) {
  const hash = this.password;
  return bcrypt.compare(candidate, hash);
};

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

export const User = mongoose.model('User', UserSchema);
