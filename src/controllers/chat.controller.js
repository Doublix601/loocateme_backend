import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { FollowRequest } from '../models/FollowRequest.js';
import { User } from '../models/User.js';
import { sendPushUnified } from '../services/push.service.js';
import { getBlockedIds } from '../services/user.service.js';

function buildPairKey(a, b) {
  const ids = [String(a), String(b)].sort();
  return `${ids[0]}:${ids[1]}`;
}

async function ensureAcceptedRelation(userId, targetUserId) {
  const rel = await FollowRequest.findOne({
    status: 'accepted',
    $or: [
      { requester: userId, target: targetUserId },
      { requester: targetUserId, target: userId },
    ],
  }).lean();
  return !!rel;
}

function getReadState(conversation, userId) {
  const states = Array.isArray(conversation?.readStates) ? conversation.readStates : [];
  return states.find((s) => String(s.user) === String(userId)) || null;
}

async function upsertReadState(conversationId, userId, { lastReadAt, lastReadMessageId }) {
  const convo = await Conversation.findById(conversationId);
  if (!convo) return null;
  const states = Array.isArray(convo.readStates) ? convo.readStates : [];
  const idx = states.findIndex((s) => String(s.user) === String(userId));
  if (idx >= 0) {
    if (lastReadAt) states[idx].lastReadAt = lastReadAt;
    if (lastReadMessageId) states[idx].lastReadMessageId = lastReadMessageId;
  } else {
    states.push({ user: userId, lastReadAt, lastReadMessageId });
  }
  convo.readStates = states;
  await convo.save();
  return convo;
}

export const ChatController = {
  listConversations: async (req, res, next) => {
    try {
      const me = req.user?.id;
      const conversations = await Conversation.find({ participants: me })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .lean();
      const items = [];
      for (const c of conversations) {
        const otherId = (c.participants || []).find((id) => String(id) !== String(me));
        const other = otherId ? await User.findById(otherId).select('username firstName lastName customName profileImageUrl').lean() : null;
        const readState = getReadState(c, me);
        const lastReadAt = readState?.lastReadAt || null;
        const unreadCount = await Message.countDocuments({
          conversation: c._id,
          sender: { $ne: me },
          ...(lastReadAt ? { createdAt: { $gt: lastReadAt } } : {}),
        });
        items.push({
          id: c._id,
          otherUser: other ? {
            id: other._id,
            username: other.username,
            name: other.customName || other.firstName || other.username || 'Inconnu',
            profileImageUrl: other.profileImageUrl || '',
          } : null,
          lastMessage: {
            at: c.lastMessageAt || c.updatedAt,
            text: c.lastMessageText || '',
            type: c.lastMessageType || 'text',
            senderId: c.lastMessageSender || null,
          },
          unreadCount,
        });
      }
      return res.json({ items });
    } catch (err) {
      next(err);
    }
  },

  getMessages: async (req, res, next) => {
    try {
      const me = req.user?.id;
      const conversationId = String(req.params.id || '').trim();
      const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));
      const beforeId = req.query.before ? String(req.query.before) : null;
      const convo = await Conversation.findById(conversationId).lean();
      if (!convo) return res.status(404).json({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation introuvable' });
      if (!convo.participants?.some((id) => String(id) === String(me))) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès refusé' });
      }

      let beforeDate = null;
      if (beforeId) {
        const beforeMsg = await Message.findById(beforeId).select('createdAt').lean();
        if (beforeMsg?.createdAt) beforeDate = beforeMsg.createdAt;
      }

      const query = {
        conversation: conversationId,
        ...(beforeDate ? { createdAt: { $lt: beforeDate } } : {}),
      };
      const messages = await Message.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const ordered = messages.reverse();
      const readState = getReadState(convo, me);
      return res.json({
        items: ordered.map((m) => ({
          id: m._id,
          conversationId: m.conversation,
          senderId: m.sender,
          type: m.type,
          text: m.text,
          mediaUrl: m.mediaUrl,
          thumbnailUrl: m.thumbnailUrl,
          createdAt: m.createdAt,
        })),
        hasMore: messages.length === limit,
        readState: {
          lastReadAt: readState?.lastReadAt || null,
          lastReadMessageId: readState?.lastReadMessageId || null,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  sendMessage: async (req, res, next) => {
    try {
      const me = req.user?.id;
      const { targetUserId, conversationId, type = 'text', text = '', mediaUrl = '', thumbnailUrl = '' } = req.body || {};
      if (!conversationId && !targetUserId) {
        return res.status(400).json({ code: 'TARGET_REQUIRED', message: 'conversationId ou targetUserId requis' });
      }
      if (!['text', 'image', 'video'].includes(type)) {
        return res.status(400).json({ code: 'TYPE_INVALID', message: 'Type de message invalide' });
      }
      if (type === 'text' && !String(text || '').trim()) {
        return res.status(400).json({ code: 'TEXT_REQUIRED', message: 'Texte requis' });
      }
      if ((type === 'image' || type === 'video') && !String(mediaUrl || '').trim()) {
        return res.status(400).json({ code: 'MEDIA_REQUIRED', message: 'Media requis' });
      }

      let convo = null;
      let targetId = targetUserId;
      if (conversationId) {
        convo = await Conversation.findById(conversationId);
        if (!convo) return res.status(404).json({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation introuvable' });
        if (!convo.participants?.some((id) => String(id) === String(me))) {
          return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès refusé' });
        }
        targetId = convo.participants.find((id) => String(id) !== String(me));
      } else {
        const blocked = await getBlockedIds(me);
        if (blocked.includes(String(targetUserId))) {
          return res.status(403).json({ code: 'BLOCKED', message: 'Action impossible' });
        }
        const allowed = await ensureAcceptedRelation(me, targetUserId);
        if (!allowed) {
          return res.status(403).json({ code: 'RELATION_REQUIRED', message: 'Demande de suivi non acceptée' });
        }
        const pairKey = buildPairKey(me, targetUserId);
        convo = await Conversation.findOne({ pairKey });
        if (!convo) {
          convo = await Conversation.create({
            participants: [me, targetUserId],
            pairKey,
            readStates: [
              { user: me, lastReadAt: new Date(), lastReadMessageId: null },
              { user: targetUserId, lastReadAt: null, lastReadMessageId: null },
            ],
          });
        }
      }

      const message = await Message.create({
        conversation: convo._id,
        sender: me,
        type,
        text: String(text || ''),
        mediaUrl: String(mediaUrl || ''),
        thumbnailUrl: String(thumbnailUrl || ''),
      });

      convo.lastMessageAt = message.createdAt;
      convo.lastMessageType = type;
      convo.lastMessageSender = me;
      convo.lastMessageText = type === 'text'
        ? String(text || '').slice(0, 300)
        : (type === 'image' ? '[Photo]' : '[Vidéo]');
      await convo.save();

      await upsertReadState(convo._id, me, { lastReadAt: message.createdAt, lastReadMessageId: message._id });

      try {
        const sender = await User.findById(me).select('username firstName lastName customName').lean();
        const senderName = sender?.customName || sender?.firstName || sender?.username || 'Quelqu’un';
        const notifBody = type === 'text'
          ? String(text || '').slice(0, 120)
          : (type === 'image' ? '[Photo]' : '[Vidéo]');
        await sendPushUnified({
          userIds: [targetId],
          title: senderName,
          body: notifBody,
          data: {
            kind: 'chat_message',
            conversationId: String(convo._id),
            messageId: String(message._id),
            senderId: String(me),
            url: `loocateme://chat/${encodeURIComponent(String(convo._id))}?messageId=${encodeURIComponent(String(message._id))}`,
          },
        });
      } catch (_) {}

      return res.status(201).json({
        message: {
          id: message._id,
          conversationId: message.conversation,
          senderId: message.sender,
          type: message.type,
          text: message.text,
          mediaUrl: message.mediaUrl,
          thumbnailUrl: message.thumbnailUrl,
          createdAt: message.createdAt,
        },
        conversationId: convo._id,
      });
    } catch (err) {
      next(err);
    }
  },

  markRead: async (req, res, next) => {
    try {
      const me = req.user?.id;
      const conversationId = String(req.params.id || '').trim();
      const { messageId } = req.body || {};
      const convo = await Conversation.findById(conversationId).lean();
      if (!convo) return res.status(404).json({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation introuvable' });
      if (!convo.participants?.some((id) => String(id) === String(me))) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Accès refusé' });
      }
      let lastReadAt = new Date();
      let lastReadMessageId = messageId || null;
      if (messageId) {
        const msg = await Message.findById(messageId).select('createdAt').lean();
        if (msg?.createdAt) lastReadAt = msg.createdAt;
      }
      await upsertReadState(conversationId, me, { lastReadAt, lastReadMessageId });
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
