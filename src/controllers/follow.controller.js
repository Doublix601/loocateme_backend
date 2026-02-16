import { FollowRequest } from '../models/FollowRequest.js';
import { User } from '../models/User.js';
import { getBlockedIds } from '../services/user.service.js';

function buildStatusPayload({ status = 'none', direction = null, requestId = null } = {}) {
  return { status, direction, requestId };
}

async function getFollowStatus({ viewerId, targetId }) {
  if (!viewerId || !targetId) return buildStatusPayload();
  const req = await FollowRequest.findOne({
    $or: [
      { requester: viewerId, target: targetId },
      { requester: targetId, target: viewerId },
    ],
  }).lean();
  if (!req) return buildStatusPayload();
  if (req.status === 'accepted') return buildStatusPayload({ status: 'accepted', requestId: req._id });
  const direction = String(req.requester) === String(viewerId) ? 'outgoing' : 'incoming';
  return buildStatusPayload({ status: 'pending', direction, requestId: req._id });
}

export const FollowController = {
  status: async (req, res, next) => {
    try {
      const viewerId = req.user?.id;
      const targetId = String(req.params.id || '').trim();
      if (!targetId) return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'ID utilisateur requis' });
      const payload = await getFollowStatus({ viewerId, targetId });
      return res.json(payload);
    } catch (err) {
      next(err);
    }
  },

  request: async (req, res, next) => {
    try {
      const requesterId = req.user?.id;
      const { targetUserId } = req.body || {};
      if (!targetUserId) return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'targetUserId requis' });
      if (String(targetUserId) === String(requesterId)) {
        return res.status(400).json({ code: 'CANNOT_FOLLOW_SELF', message: 'Impossible de se suivre soi-même' });
      }
      const target = await User.findById(targetUserId).select('_id').lean();
      if (!target) return res.status(404).json({ code: 'TARGET_NOT_FOUND', message: 'Utilisateur introuvable' });

      const blockedIds = await getBlockedIds(requesterId);
      if (blockedIds.includes(String(targetUserId))) {
        return res.status(403).json({ code: 'BLOCKED', message: 'Action impossible' });
      }

      const existing = await FollowRequest.findOne({
        $or: [
          { requester: requesterId, target: targetUserId },
          { requester: targetUserId, target: requesterId },
        ],
      });
      if (existing) {
        if (existing.status === 'accepted') {
          return res.json({ success: true, status: 'accepted', requestId: existing._id });
        }
        if (String(existing.requester) !== String(requesterId) && String(existing.target) === String(requesterId)) {
          return res.status(409).json({ code: 'REQUEST_INCOMING', message: 'Une demande entrante existe déjà', requestId: existing._id });
        }
        return res.json({ success: true, status: 'pending', requestId: existing._id });
      }

      const created = await FollowRequest.create({ requester: requesterId, target: targetUserId, status: 'pending' });
      return res.status(201).json({ success: true, status: 'pending', requestId: created._id });
    } catch (err) {
      next(err);
    }
  },

  accept: async (req, res, next) => {
    try {
      const requestId = String(req.params.id || '').trim();
      if (!requestId) return res.status(400).json({ code: 'REQUEST_REQUIRED', message: 'ID demande requis' });
      const fr = await FollowRequest.findById(requestId);
      if (!fr) return res.status(404).json({ code: 'REQUEST_NOT_FOUND', message: 'Demande introuvable' });
      if (String(fr.target) !== String(req.user?.id)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Action non autorisée' });
      }
      fr.status = 'accepted';
      fr.respondedAt = new Date();
      await fr.save();
      return res.json({ success: true, status: 'accepted', requestId: fr._id });
    } catch (err) {
      next(err);
    }
  },

  decline: async (req, res, next) => {
    try {
      const requestId = String(req.params.id || '').trim();
      if (!requestId) return res.status(400).json({ code: 'REQUEST_REQUIRED', message: 'ID demande requis' });
      const fr = await FollowRequest.findById(requestId).lean();
      if (!fr) return res.status(404).json({ code: 'REQUEST_NOT_FOUND', message: 'Demande introuvable' });
      if (String(fr.target) !== String(req.user?.id) && String(fr.requester) !== String(req.user?.id)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Action non autorisée' });
      }
      await FollowRequest.deleteOne({ _id: requestId });
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  list: async (req, res, next) => {
    try {
      const me = req.user?.id;
      const type = String(req.query.type || 'incoming');
      const query = type === 'outgoing'
        ? { requester: me, status: 'pending' }
        : { target: me, status: 'pending' };
      const requests = await FollowRequest.find(query)
        .sort({ createdAt: -1 })
        .populate(type === 'outgoing' ? 'target' : 'requester', 'username firstName lastName customName profileImageUrl')
        .lean();
      const items = requests.map((r) => {
        const u = type === 'outgoing' ? r.target : r.requester;
        return {
          id: r._id,
          user: u ? {
            id: u._id,
            username: u.username,
            name: u.customName || u.firstName || u.username || 'Inconnu',
            profileImageUrl: u.profileImageUrl || '',
          } : null,
          createdAt: r.createdAt,
        };
      });
      return res.json({ items });
    } catch (err) {
      next(err);
    }
  },
};

export { getFollowStatus };
