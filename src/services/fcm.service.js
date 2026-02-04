import admin from 'firebase-admin';
import { FcmToken } from '../models/FcmToken.js';

let initialized = false;

function init() {
  if (initialized) return;
  const keyJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!keyJson) {
    console.warn('[fcm] GOOGLE_APPLICATION_CREDENTIALS_JSON not set; push disabled');
    return;
  }
  try {
    const creds = JSON.parse(keyJson);
    admin.initializeApp({ credential: admin.credential.cert(creds) });
    initialized = true;
    console.log('[fcm] Initialized firebase-admin');
  } catch (e) {
    console.warn('[fcm] Failed to init firebase-admin:', e?.message || e);
  }
}

export async function sendPushToTokens(tokens, notification, data = {}) {
  init();
  if (!initialized || !tokens || tokens.length === 0) return { ok: false, skipped: true };
  try {
    const message = {
      tokens,
      notification,
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    };
    const res = await admin.messaging().sendEachForMulticast(message);
    return { ok: true, res };
  } catch (e) {
    console.warn('[fcm] send error:', e?.message || e);
    return { ok: false, error: e };
  }
}

/**
 * Envoi unifié d'une notification push iOS + Android en un seul appel.
 *
 * Paramètres pris en charge (tous optionnels sauf titre/corps selon vos besoins):
 * - userIds: string[] (résout automatiquement les tokens FCM de ces utilisateurs)
 * - tokens: string[] (tokens FCM directs à inclure en plus)
 * - title: string
 * - body: string
 * - data: Record<string, string | number | boolean>
 * - imageUrl: string (image pour la notif — Android: notification.imageUrl; iOS via fcm_options.image)
 * - sound: string (par défaut 'default')
 * - badge: number (iOS)
 * - androidChannelId: string (canal Android)
 * - priority: 'high' | 'normal' (Android)
 * - collapseKey: string (Android: collapseKey, iOS: apns-collapse-id)
 * - mutableContent: boolean (iOS)
 * - contentAvailable: boolean (iOS silent/background)
 */
export async function sendUnifiedNotification(options = {}) {
  init();
  if (!initialized) return { ok: false, skipped: true, reason: 'FCM_NOT_INITIALIZED' };

  const {
    userIds = [],
    tokens = [],
    title,
    body,
    data = {},
    imageUrl,
    sound = 'default',
    badge,
    androidChannelId,
    priority = 'high',
    collapseKey,
    mutableContent = false,
    contentAvailable = false,
  } = options || {};

  let resolvedTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  try {
    if (Array.isArray(userIds) && userIds.length > 0) {
      const userTokens = await FcmToken.find({ user: { $in: userIds } }).distinct('token');
      resolvedTokens = [...new Set([...
        resolvedTokens,
        ...userTokens
      ])];
    } else {
      // Déduplique si userIds absent
      resolvedTokens = [...new Set(resolvedTokens)];
    }
  } catch (e) {
    console.warn('[fcm] token resolution failed:', e?.message || e);
  }

  if (!resolvedTokens || resolvedTokens.length === 0) {
    return { ok: false, skipped: true, reason: 'NO_TOKENS' };
  }

  // Notification section (title/body/image)
  const notification = (title || body || imageUrl)
    ? {
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      }
    : undefined;

  const effectiveChannelId = androidChannelId || 'default';

  // Android options
  const android = {
    priority,
    ...(collapseKey ? { collapseKey } : {}),
    notification: {
      ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
      ...(sound ? { sound } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    },
  };

  // APNs (iOS) options
  const apnsHeaders = { 'apns-priority': '10', ...(collapseKey ? { 'apns-collapse-id': String(collapseKey) } : {}) };
  const apns = {
    headers: apnsHeaders,
    payload: {
      aps: {
        ...(typeof badge === 'number' ? { badge: Number(badge) } : {}),
        ...(sound ? { sound } : {}),
        ...(mutableContent ? { 'mutable-content': 1 } : {}),
        ...(contentAvailable ? { 'content-available': 1 } : {}),
      },
    },
    ...(imageUrl ? { fcm_options: { image: imageUrl } } : {}),
  };

  // Data en chaîne de caractères comme attendu par FCM
  const dataStr = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

  try {
    const message = {
      tokens: resolvedTokens,
      ...(notification ? { notification } : {}),
      data: dataStr,
      android,
      apns,
    };
    const res = await admin.messaging().sendEachForMulticast(message);
    return { ok: true, res, count: resolvedTokens.length };
  } catch (e) {
    console.warn('[fcm] unified send error:', e?.message || e);
    return { ok: false, error: e };
  }
}
