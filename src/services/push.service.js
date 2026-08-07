import { Expo } from 'expo-server-sdk';
import { FcmToken } from '../models/FcmToken.js';
import { sendUnifiedNotification as sendFcmUnified } from './fcm.service.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { User } from '../models/User.js';

const EXPO_PROJECT_ID = 'da2f75d4-ab23-4073-8db9-1ab186cc22d6';

let expoOptions = { useFcmV1: true };
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    expoOptions.googleServiceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  } catch (e) {
    console.warn('[push] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON for Expo:', e.message);
  }
}
const expo = new Expo(expoOptions);

function splitTokens(tokens = []) {
  const t = Array.isArray(tokens) ? tokens : [];
  const expoTokens = [];
  const fcmTokens = [];
  for (const tok of t) {
    if (typeof tok === 'string' && (tok.startsWith('ExponentPushToken[') || tok.startsWith('ExpoPushToken['))) expoTokens.push(tok);
    else if (tok) fcmTokens.push(tok);
  }
  return { expoTokens, fcmTokens };
}

export async function resolveUserTokens(userIds = [], extraTokens = []) {
  let tokens = Array.isArray(extraTokens) ? extraTokens.filter(Boolean) : [];
  if (Array.isArray(userIds) && userIds.length > 0) {
    try {
      const dbTokens = await FcmToken.find({ user: { $in: userIds } }).distinct('token');
      tokens = [...new Set([...tokens, ...dbTokens])];
    } catch (_) {}
  } else {
    tokens = [...new Set(tokens)];
  }
  return tokens;
}

// À réception d'un ticket Expo "DeviceNotRegistered" (app désinstallée ou push
// révoqué), retire le token mort et pose un signal best-effort de désinstallation
// sur l'utilisateur, avec le type de notification qui a précédé la coupure — sert
// à corréler un type de push à un pic de désinstallation (cf. churnRisk.service.js).
async function _handleDeadToken(token, kind) {
  try {
    const doc = await FcmToken.findOneAndDelete({ token }).select('user').lean();
    if (doc?.user) {
      await User.updateOne(
        { _id: doc.user },
        { $set: { uninstalledAt: new Date(), lastNotificationKindBeforeUninstall: kind || null } }
      );
    }
  } catch (e) {
    console.error('[push] Dead token handling error:', e);
  }
}

// Filtre les userIds ayant explicitement désactivé ce type ("kind") de
// notification via PATCH /users/me/notification-preferences. L'absence de
// préférence enregistrée pour ce kind laisse la notification passer par défaut.
async function _filterOptedOutUsers(userIds, kind) {
  if (!kind || !Array.isArray(userIds) || !userIds.length) return userIds;
  try {
    const users = await User.find({ _id: { $in: userIds } }).select('notificationPreferences').lean();
    const optedOut = new Set(
      users
        .filter((u) => u.notificationPreferences && u.notificationPreferences[kind] === false)
        .map((u) => String(u._id))
    );
    if (!optedOut.size) return userIds;
    return userIds.filter((id) => !optedOut.has(String(id)));
  } catch (e) {
    console.error('[push] notificationPreferences filter error:', e);
    return userIds;
  }
}

export async function sendPushUnified({ userIds = [], tokens = [], title, body, data = {}, sound = 'default', androidChannelId, badge, collapseKey }) {
  const filteredUserIds = await _filterOptedOutUsers(userIds, data?.kind);
  if (Array.isArray(userIds) && userIds.length && !filteredUserIds.length && !(Array.isArray(tokens) && tokens.length)) {
    return { ok: false, skipped: true, reason: 'OPTED_OUT' };
  }
  const resolved = await resolveUserTokens(filteredUserIds, tokens);
  if (!resolved.length) return { ok: false, skipped: true, reason: 'NO_TOKENS' };
  const { expoTokens, fcmTokens } = splitTokens(resolved);
  const channelId = androidChannelId || 'default';
  const kind = data?.kind;

  const results = { expo: null, fcm: null };

  // Send via Expo
  if (expoTokens.length) {
    const messages = expoTokens.map((to) => ({
      to,
      sound,
      title,
      body,
      data,
      ...(channelId ? { channelId } : {}),
      ...(typeof badge === 'number' ? { badge: Number(badge) } : {}),
      ...(collapseKey ? { collapseId: String(collapseKey) } : {}),
      // Required for EAS/Production builds
      ...(EXPO_PROJECT_ID ? { projectId: EXPO_PROJECT_ID } : {}),
    }));
    const chunks = expo.chunkPushNotifications(messages);
    const receipts = [];
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        receipts.push(ticketChunk);
        // Log details about tickets (success or errors)
        console.log('[push] Expo tickets result:', JSON.stringify(ticketChunk));
        ticketChunk.forEach((ticket, i) => {
          if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
            const deadToken = chunk[i]?.to;
            if (deadToken) _handleDeadToken(deadToken, kind);
          }
        });
      } catch (e) {
        console.error('[push] Expo send error:', e);
        receipts.push({ error: e?.message || String(e) });
      }
    }
    results.expo = receipts;
  }

  // Send via FCM for any remaining tokens
  if (fcmTokens.length) {
    results.fcm = await sendFcmUnified({ tokens: fcmTokens, title, body, data, androidChannelId: channelId, badge, collapseKey });
  }

  // Journal léger pour le rapport de corrélation notification -> désinstallation
  // (cf. churnRisk.service.js). Fire-and-forget : ne doit jamais bloquer l'envoi.
  if (kind && Array.isArray(userIds) && userIds.length) {
    NotificationLog.insertMany(userIds.map((user) => ({ user, kind })), { ordered: false }).catch((e) => {
      console.error('[push] NotificationLog insert error:', e);
    });
  }

  return { ok: true, results, counts: { expo: expoTokens.length, fcm: fcmTokens.length } };
}
