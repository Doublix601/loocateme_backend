import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema(
  {
    reporterUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: {
      type: String,
      required: true,
      enum: ['harassment', 'spam', 'inappropriate', 'impersonation', 'scam', 'other'],
      index: true,
    },
    reason: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending', index: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    actionTaken: { type: String },
    actionTarget: { type: String, enum: ['reported', 'reporter'] },
    actionDurationHours: { type: Number },
    resolutionNote: { type: String },
  },
  { timestamps: true }
);

ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reportedUser: 1, status: 1, createdAt: -1 });
ReportSchema.index({ reporterUser: 1, createdAt: -1 });

export const Report = mongoose.model('Report', ReportSchema);
