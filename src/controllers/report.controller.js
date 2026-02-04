import mongoose from 'mongoose';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { sendPushUnified } from '../services/push.service.js';

const MAX_PAGE_LIMIT = 100;
const WARNING_EXPIRY_MONTHS = 3;

function buildDiacriticRegex(input) {
  const map = {
    a: '[aàáâäåæAÀÁÂÄÅÆ]',
    c: '[cçCÇ]',
    e: '[eèéêëEÈÉÊË]',
    i: '[iìíîïIÌÍÎÏ]',
    o: '[oòóôöøœOÒÓÔÖØŒ]',
    u: '[uùúûüUÙÚÛÜ]',
    y: '[yÿYŸ]',
    n: '[nñNÑ]',
  };
  const escaped = String(input || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (const ch of escaped) {
    const lower = ch.toLowerCase();
    if (map[lower]) pattern += map[lower];
    else pattern += ch;
  }
  return new RegExp(pattern, 'i');
}

const normalizeWarnings = (moderation = {}) => {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - WARNING_EXPIRY_MONTHS);

  const rawHistory = Array.isArray(moderation.warningsHistory) ? moderation.warningsHistory : [];
  const history = rawHistory
    .map((entry) => ({
      at: entry?.at ? new Date(entry.at) : null,
      type: entry?.type ? String(entry.type) : '',
      reason: entry?.reason ? String(entry.reason) : '',
    }))
    .filter((entry) => entry.at && !isNaN(entry.at.getTime()) && entry.at.getTime() >= cutoff.getTime());

  if (history.length > 0) {
    return { warningsCount: history.length, expired: false, history };
  }

  const lastWarningAt = moderation.lastWarningAt ? new Date(moderation.lastWarningAt) : null;
  if (!lastWarningAt || isNaN(lastWarningAt.getTime())) {
    return { warningsCount: moderation.warningsCount || 0, expired: false, history: [] };
  }
  const expired = lastWarningAt.getTime() < cutoff.getTime();
  return { warningsCount: expired ? 0 : (moderation.warningsCount || 0), expired, history: [] };
};

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

      try {
        await sendPushUnified({
          userIds: [reportedUserId],
          title: 'Signalement reçu',
          body: 'Votre compte a reçu un signalement. Notre équipe va examiner la situation.',
          data: {
            kind: 'report_created',
            reportId: String(report._id),
            category: category ? String(category) : undefined,
          },
        });
      } catch (e) {
        console.warn('[reports] report notification failed', e?.message || e);
      }

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
            warnings: normalizeWarnings(r.reporterUser.moderation).warningsCount,
          } : null,
          reported: r.reportedUser ? {
            id: r.reportedUser._id,
            username: r.reportedUser.username,
            name: r.reportedUser.customName || r.reportedUser.firstName || r.reportedUser.username || 'Inconnu',
            profileImageUrl: r.reportedUser.profileImageUrl || '',
            warnings: normalizeWarnings(r.reportedUser.moderation).warningsCount,
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
      const { action, target, durationHours, note, warningType } = req.body || {};

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
        const warningState = normalizeWarnings(user.moderation);
        const baseCount = warningState.warningsCount || 0;
        const reason = (note && String(note).trim())
          || (report.reason && String(report.reason).trim())
          || 'Avertissement';
        const type = (warningType && String(warningType).trim())
          || (report.category && String(report.category).trim())
          || 'Avertissement';
        const history = warningState.history && warningState.history.length > 0
          ? warningState.history
          : [];
        history.push({ at: now, type, reason });
        user.moderation.warningsHistory = history;
        user.moderation.warningsCount = Math.max(baseCount + 1, history.length);
        user.moderation.lastWarningAt = now;
        user.moderation.lastWarningReason = reason;
        user.moderation.lastWarningType = type;
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

      if (action === 'ban_temp' || action === 'ban_permanent') {
        try {
          const isTemp = action === 'ban_temp';
          const until = isTemp ? user.moderation?.bannedUntil : null;
          await sendPushUnified({
            userIds: [String(targetUserId)],
            title: isTemp ? 'Ban temporaire' : 'Ban définitif',
            body: isTemp
              ? `Votre compte est banni temporairement${until ? ` jusqu’au ${new Date(until).toLocaleString('fr-FR')}` : ''}.`
              : 'Votre compte a été banni définitivement.',
            data: {
              kind: 'ban',
              banType: isTemp ? 'temporary' : 'permanent',
              until: until ? new Date(until).toISOString() : undefined,
              reportId: String(report._id),
            },
          });
        } catch (e) {
          console.warn('[reports] ban notification failed', e?.message || e);
        }
      }

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
  searchUsers: async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q || q.length < 2) return res.json({ users: [] });
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const re = buildDiacriticRegex(q);
      const users = await User.find({
        $or: [
          { username: re },
          { firstName: re },
          { lastName: re },
          { customName: re },
          { name: re },
          { email: { $regex: re } },
        ],
      })
        .limit(limit)
        .select('username firstName lastName customName email profileImageUrl moderation role isVisible')
        .lean();
      const mapped = users.map((u) => ({
        id: u._id,
        username: u.username || '',
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        customName: u.customName || '',
        email: u.email || '',
        profileImageUrl: u.profileImageUrl || '',
        role: u.role || 'user',
        isVisible: u.isVisible !== false,
        moderation: u.moderation || {},
      }));
      return res.json({ users: mapped });
    } catch (err) {
      next(err);
    }
  },
  moderateUser: async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ code: 'ID_REQUIRED', message: 'ID utilisateur requis' });
      const action = String(req.body?.action || '').trim();
      const durationHours = req.body?.durationHours;
      const note = req.body?.note;

      const user = await User.findById(id);
      if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable' });
      user.moderation = user.moderation || {};

      if (action === 'unban') {
        user.moderation.bannedUntil = null;
        user.moderation.bannedPermanent = false;
        user.moderation.bannedAt = null;
        user.moderation.bannedBy = null;
        user.moderation.banReason = '';
      } else if (action === 'ban_temp') {
        const hours = Math.max(1, Math.min(24 * 30, parseInt(durationHours, 10) || 24));
        user.moderation.bannedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
        user.moderation.bannedAt = new Date();
        user.moderation.bannedBy = req.user?.id || null;
        user.moderation.bannedPermanent = false;
        user.moderation.banReason = note ? String(note) : 'Ban temporaire';
      } else if (action === 'ban_permanent') {
        user.moderation.bannedPermanent = true;
        user.moderation.bannedUntil = null;
        user.moderation.bannedAt = new Date();
        user.moderation.bannedBy = req.user?.id || null;
        user.moderation.banReason = note ? String(note) : 'Ban définitif';
      } else if (action === 'clear_warnings') {
        const warningState = normalizeWarnings(user.moderation);
        let history = warningState.history || [];
        if (history.length === 0 && !warningState.expired && user.moderation.warningsCount > 0) {
          const lastAt = user.moderation.lastWarningAt ? new Date(user.moderation.lastWarningAt) : null;
          if (lastAt && !isNaN(lastAt.getTime())) {
            history = [{
              at: lastAt,
              type: user.moderation.lastWarningType || 'Avertissement',
              reason: user.moderation.lastWarningReason || 'Avertissement',
            }];
          }
        }
        history = [];
        user.moderation.warningsHistory = history;
        user.moderation.warningsCount = history.length;
        const last = history.length > 0 ? history[history.length - 1] : null;
        user.moderation.lastWarningAt = last ? last.at : null;
        user.moderation.lastWarningReason = last ? last.reason || '' : '';
        user.moderation.lastWarningType = last ? last.type || '' : '';
      } else {
        return res.status(400).json({ code: 'ACTION_INVALID', message: 'Action invalide' });
      }

      await user.save();

      if (action === 'ban_temp' || action === 'ban_permanent') {
        try {
          const isTemp = action === 'ban_temp';
          const until = isTemp ? user.moderation?.bannedUntil : null;
          await sendPushUnified({
            userIds: [String(user._id)],
            title: isTemp ? 'Ban temporaire' : 'Ban définitif',
            body: isTemp
              ? `Votre compte est banni temporairement${until ? ` jusqu’au ${new Date(until).toLocaleString('fr-FR')}` : ''}.`
              : 'Votre compte a été banni définitivement.',
            data: {
              kind: 'ban',
              banType: isTemp ? 'temporary' : 'permanent',
              until: until ? new Date(until).toISOString() : undefined,
            },
          });
        } catch (e) {
          console.warn('[reports] moderation ban notification failed', e?.message || e);
        }
      }
      const safe = user.toObject();
      delete safe.password;
      return res.json({ success: true, user: safe });
    } catch (err) {
      next(err);
    }
  },
};
