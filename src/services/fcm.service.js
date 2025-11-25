import admin from 'firebase-admin';

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
