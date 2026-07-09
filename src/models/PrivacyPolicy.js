import mongoose from 'mongoose';

// Each publish creates a new document (history), so past versions and their
// changelogs remain auditable. The text can be updated at runtime (via the
// admin API) without a backend deploy or an app store release.
const PrivacyPolicySchema = new mongoose.Schema(
  {
    version: { type: String, required: true, unique: true, index: true }, // "major.minor", e.g. "3.1"
    major: { type: Number, required: true },
    minor: { type: Number, required: true },
    content: { type: String, required: true },
    changelog: { type: String, default: '' }, // summary of what changed, used in the notification email
    // Explicit admin choice at publish time — never inferred from the version
    // string, to avoid mistakes (e.g. typing "3.0" for what is really a minor tweak).
    changeType: { type: String, enum: ['major', 'minor'], required: true },
    // Derived from changeType, stored for audit/display purposes.
    requiresConsent: { type: Boolean, required: true },
    publishedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

PrivacyPolicySchema.statics.getLatest = function getLatest() {
  return this.findOne().sort({ publishedAt: -1 });
};

export const PrivacyPolicy = mongoose.model('PrivacyPolicy', PrivacyPolicySchema);

export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!m) return { major: 0, minor: 0 };
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

// >0 if a > b, <0 if a < b, 0 if equal
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  return va.minor - vb.minor;
}
