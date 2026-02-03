import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const SocialSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin', 'youtube'],
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
    // Legacy single-name field kept for backward compatibility
    name: { type: String, default: '' },
    // New username field replacing legacy name for unique handle/display
    username: { type: String, default: '', index: true },
    // New display-related fields
    firstName: { type: String, default: '', index: true },
    lastName: { type: String, default: '', index: true },
    customName: { type: String, default: '', index: true },
    bio: { type: String, default: '' },
    profileImageUrl: { type: String, default: '' },
    isVisible: { type: Boolean, default: true },
    profileViews: { type: Number, default: 0, index: true },
    // Rate-limit name changes
    lastUsernameChangeAt: { type: Date },
    // Split first/last name cooldowns: each field is independent
    lastFirstNameChangeAt: { type: Date },
    lastLastNameChangeAt: { type: Date },
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
    // User role: 'user' (default), 'moderator', 'admin'
    role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user', index: true },
    // Moderation & safety
    moderation: {
      warningsCount: { type: Number, default: 0 },
      lastWarningAt: { type: Date },
      bannedUntil: { type: Date },
      bannedAt: { type: Date },
      bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      bannedPermanent: { type: Boolean, default: false },
      banReason: { type: String, default: '' },
    },
    // Premium flags
    isPremium: { type: Boolean, default: false, index: true },
    premiumTrialStart: { type: Date },
    premiumTrialEnd: { type: Date },
    expoPushToken: { type: String, index: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lon, lat]
      updatedAt: { type: Date, default: Date.now },
    },
    socialNetworks: [SocialSchema],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Email verification and password reset
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerifyTokenHash: { type: String, index: true },
    emailVerifyExpiresAt: { type: Date },
    pwdResetTokenHash: { type: String, index: true },
    pwdResetExpiresAt: { type: Date },
  },
  { timestamps: true }
);

UserSchema.index({ location: '2dsphere' });
// Useful compound index for text-like searches on names/username
UserSchema.index({ username: 1, firstName: 1, lastName: 1, customName: 1, name: 1 });

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
