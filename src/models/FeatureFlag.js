import mongoose from 'mongoose';

const FeatureFlagSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

export const FeatureFlag = mongoose.model('FeatureFlag', FeatureFlagSchema);

// Default flags to ensure they exist
export const DEFAULT_FLAGS = {
  premiumEnabled: { enabled: false, description: 'Active ou désactive les fonctionnalités premium pour tous les utilisateurs' },
  statisticsEnabled: { enabled: false, description: 'Active ou désactive les statistiques UI pour tous les utilisateurs' },
};

// Ensure default flags exist in DB
export async function ensureDefaultFlags() {
  for (const [key, { enabled, description }] of Object.entries(DEFAULT_FLAGS)) {
    try {
      const existing = await FeatureFlag.findOne({ key });
      if (!existing) {
        await FeatureFlag.create({ key, enabled, description });
        console.log(`[FeatureFlag] Created default flag: ${key} = ${enabled}`);
      }
    } catch (e) {
      console.warn(`[FeatureFlag] Failed to ensure flag ${key}:`, e?.message || e);
    }
  }
}
