import mongoose from 'mongoose';

// Batch/queue job used to email all users about a privacy policy update
// without overloading the SMTP provider. Processed a chunk at a time by
// CronService (see processPolicyEmailJobs), resumable via `cursor`.
const PolicyEmailJobSchema = new mongoose.Schema(
  {
    policyVersion: { type: String, required: true },
    status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending', index: true },
    cursor: { type: mongoose.Schema.Types.ObjectId, default: null }, // last processed user _id
    batchSize: { type: Number, default: 40 },
    totalUsers: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

export const PolicyEmailJob = mongoose.model('PolicyEmailJob', PolicyEmailJobSchema);
