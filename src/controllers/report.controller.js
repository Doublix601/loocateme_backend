import mongoose from 'mongoose';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';

const MAX_PAGE_LIMIT = 100;

export const ReportController = {
  create: async (req, res, next) => {
    try {
      const reporterId = req.user?.id;
      const { reportedUserId, category, reason, description } = req.body || {};
      if (!reportedUserId) return res.status(400).json({ code: 'REPORTED_REQUIRED', message: 'reportedUserId requis' });
      if (String(reportedUserId) === String(reporterId)) {
        return res.status(400).json({ code: 'CANNOT_REPORT_SELF', message: 'Impossible de se signaler soi-même' });
      }

      const reported = await User.findById(reportedUserId).select('_id').lean();
      if (!reported) return res.status(404).json({ code: 'REPORTED_NOT_FOUND', message: 'Utilisateur signalé introuvable' });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existing = await Report.findOne({ reporterUser: reporterId, reportedUser: reportedUserId, status: 'pending', createdAt: { $gte: since } })
        .select('_id')
        .lean();
      if (existing) {
        return res.status(409).json({ code: 'REPORT_EXISTS', message: 'Un signalement est déjà en cours pour cet utilisateur' });
      }

      const report = await Report.create({
        reporterUser: reporterId,
        reportedUser: reportedUserId,
        category,
        reason,
        description,
      });

      return res.status(201).json({ success: true, reportId: report._id });
    } catch (err) {
      next(err);
    }
  },

  list: async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const skip = (page - 1) * limit;
      const status = String(req.query.status || 'pending');
      const query = status === 'all' ? {} : { status };

      const [items, total] = await Promise.all([
        Report.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('reporterUser', 'username firstName lastName customName profileImageUrl email moderation')
          .populate('reportedUser', 'username firstName lastName customName profileImageUrl email moderation')
          .lean(),
        Report.countDocuments(query),
      ]);

      const reportedIds = items
        .map((r) => r.reportedUser?._id)
        .filter(Boolean)
        .map((id) => id.toString());

      let pendingCounts = new Map();
      if (reportedIds.length > 0) {
        const agg = await Report.aggregate([
          { $match: { status: 'pending', reportedUser: { $in: reportedIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
          { $group: { _id: '$reportedUser', count: { $sum: 1 } } },
        ]);
        pendingCounts = new Map(agg.map((row) => [String(row._id), row.count]));
      }

      const mapped = items.map((r) => {
        const reportedId = r.reportedUser?._id ? String(r.reportedUser._id) : null;
        return {
          id: r._id,
          category: r.category,
          reason: r.reason,
          description: r.description,
          status: r.status,
          createdAt: r.createdAt,
          reporter: r.reporterUser ? {
            id: r.reporterUser._id,
            username: r.reporterUser.username,
            name: r.reporterUser.customName || r.reporterUser.firstName || r.reporterUser.username || 'Inconnu',
            profileImageUrl: r.reporterUser.profileImageUrl || '',
            warnings: r.reporterUser.moderation?.warningsCount || 0,
          } : null,
          reported: r.reportedUser ? {
            id: r.reportedUser._id,
            username: r.reportedUser.username,
            name: r.reportedUser.customName || r.reportedUser.firstName || r.reportedUser.username || 'Inconnu',
            profileImageUrl: r.reportedUser.profileImageUrl || '',
            warnings: r.reportedUser.moderation?.warningsCount || 0,
            bannedUntil: r.reportedUser.moderation?.bannedUntil || null,
            bannedPermanent: !!r.reportedUser.moderation?.bannedPermanent,
          } : null,
          pendingCountForReported: reportedId ? (pendingCounts.get(reportedId) || 0) : 0,
          resolvedAt: r.resolvedAt || null,
          resolvedBy: r.resolvedBy || null,
          actionTaken: r.actionTaken || null,
          actionTarget: r.actionTarget || null,
          actionDurationHours: r.actionDurationHours || null,
          resolutionNote: r.resolutionNote || '',
        };
      });

      return res.json({ page, limit, total, items: mapped });
    } catch (err) {
      next(err);
    }
  },

  action: async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ code: 'ID_REQUIRED', message: 'ID signalement requis' });
      const { action, target, durationHours, note } = req.body || {};

      const report = await Report.findById(id);
      if (!report) return res.status(404).json({ code: 'REPORT_NOT_FOUND', message: 'Signalement introuvable' });
      if (report.status !== 'pending') {
        return res.status(409).json({ code: 'REPORT_ALREADY_RESOLVED', message: 'Signalement déjà traité' });
      }

      const now = new Date();
      const moderatorId = req.user?.id;

      if (action === 'dismiss') {
        report.status = 'dismissed';
        report.resolvedBy = moderatorId;
        report.resolvedAt = now;
        report.actionTaken = 'dismiss';
        report.actionTarget = target || 'reported';
        report.resolutionNote = note ? String(note) : '';
        await report.save();
        return res.json({ success: true, reportId: report._id, status: report.status });
      }

      if (!target || (target !== 'reported' && target !== 'reporter')) {
        return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'Cible requise (reported|reporter)' });
      }

      const targetUserId = target === 'reported' ? report.reportedUser : report.reporterUser;
      const user = await User.findById(targetUserId);
      if (!user) return res.status(404).json({ code: 'TARGET_NOT_FOUND', message: 'Utilisateur cible introuvable' });

      if (action === 'warn') {
        user.moderation = user.moderation || {};
        user.moderation.warningsCount = (user.moderation.warningsCount || 0) + 1;
        user.moderation.lastWarningAt = now;
      } else if (action === 'ban_temp') {
        const hours = Math.max(1, Math.min(24 * 30, parseInt(durationHours, 10) || 24));
        user.moderation = user.moderation || {};
        user.moderation.bannedUntil = new Date(now.getTime() + hours * 60 * 60 * 1000);
        user.moderation.bannedAt = now;
        user.moderation.bannedBy = moderatorId;
        user.moderation.bannedPermanent = false;
        user.moderation.banReason = note ? String(note) : 'Ban temporaire';
        report.actionDurationHours = hours;
      } else if (action === 'ban_permanent') {
        user.moderation = user.moderation || {};
        user.moderation.bannedPermanent = true;
        user.moderation.bannedUntil = null;
        user.moderation.bannedAt = now;
        user.moderation.bannedBy = moderatorId;
        user.moderation.banReason = note ? String(note) : 'Ban définitif';
      } else {
        return res.status(400).json({ code: 'ACTION_INVALID', message: 'Action invalide' });
      }

      await user.save();

      report.status = 'resolved';
      report.resolvedBy = moderatorId;
      report.resolvedAt = now;
      report.actionTaken = action;
      report.actionTarget = target;
      report.resolutionNote = note ? String(note) : '';
      await report.save();

      return res.json({ success: true, reportId: report._id, status: report.status });
    } catch (err) {
      next(err);
    }
  },
};
