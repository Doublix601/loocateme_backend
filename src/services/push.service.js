import { Expo } from 'expo-server-sdk';
import { FcmToken } from '../models/FcmToken.js';
import { sendUnifiedNotification as sendFcmUnified } from './fcm.service.js';

const expo = new Expo({ useFcmV1: false });

function splitTokens(tokens = []) {
  const t = Array.isArray(tokens) ? tokens : [];
  const expoTokens = [];
  const fcmTokens = [];
  for (const tok of t) {
    if (typeof tok === 'string' && tok.startsWith('ExponentPushToken[')) expoTokens.push(tok);
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

export async function sendPushUnified({ userIds = [], tokens = [], title, body, data = {}, sound = 'default', androidChannelId, badge, collapseKey }) {
  const resolved = await resolveUserTokens(userIds, tokens);
  if (!resolved.length) return { ok: false, skipped: true, reason: 'NO_TOKENS' };
  const { expoTokens, fcmTokens } = splitTokens(resolved);

  const results = { expo: null, fcm: null };

  // Send via Expo
  if (expoTokens.length) {
    const chunks = expo.chunkPushNotifications(expoTokens.map((to) => ({
      to,
      sound,
      title,
      body,
      data,
      ...(androidChannelId ? { channelId: androidChannelId } : {}),
      ...(typeof badge === 'number' ? { badge: Number(badge) } : {}),
      ...(collapseKey ? { collapseId: String(collapseKey) } : {}),
    })));
    const receipts = [];
    for (const chunk of chunks) {
      try { receipts.push(await expo.sendPushNotificationsAsync(chunk)); } catch (e) { receipts.push({ error: e?.message || String(e) }); }
    }
    results.expo = receipts;
  }

  // Send via FCM for any remaining tokens
  if (fcmTokens.length) {
    results.fcm = await sendFcmUnified({ tokens: fcmTokens, title, body, data, androidChannelId, badge, collapseKey });
  }

  return { ok: true, results, counts: { expo: expoTokens.length, fcm: fcmTokens.length } };
}
