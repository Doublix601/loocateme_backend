import mongoose from 'mongoose';

/**
 * Stores the state of executed migrations.
 * Each document represents a migration that has been successfully run.
 */
const MigrationStateSchema = new mongoose.Schema(
  {
    // Migration filename (e.g., "001_set-arnaud-admin.js")
    name: { type: String, required: true, unique: true, index: true },
    // Timestamp when the migration was executed
    executedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const MigrationState = mongoose.model('MigrationState', MigrationStateSchema);
