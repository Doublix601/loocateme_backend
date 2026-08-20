import crypto from 'crypto';
import { User } from '../models/User.js';

// Intégration Didit (vérification d'âge tierce, cf. décision produit du
// 2026-08-11 : estimation faciale généralisée à 100% des inscriptions,
// KYC pièce d'identité en fallback uniquement pour les cas ambigus).
// Contrat vérifié le 2026-08-11 contre https://docs.didit.me (Create Session
// + Webhooks) : API v3, signature X-Signature (HMAC-SHA256 sur le raw body).

const DIDIT_API_BASE = process.env.DIDIT_API_BASE || 'https://verification.didit.me/v3';

function assertConfigured() {
  if (!process.env.DIDIT_API_KEY) {
    throw Object.assign(new Error('DIDIT_API_KEY is not configured'), { status: 500, code: 'DIDIT_NOT_CONFIGURED' });
  }
  if (!process.env.DIDIT_WORKFLOW_ID) {
    throw Object.assign(new Error('DIDIT_WORKFLOW_ID is not configured'), { status: 500, code: 'DIDIT_NOT_CONFIGURED' });
  }
}

// Crée une session de vérification d'âge pour un utilisateur donné et
// renvoie l'URL à ouvrir côté client (WebView mobile).
export async function createAgeVerificationSession(user) {
  assertConfigured();

  const baseUrl = process.env.API_PUBLIC_URL || process.env.BASE_URL || 'http://api.loocate.me';
  const callbackUrl = `${baseUrl}/api/age-verification/callback`;

  const res = await fetch(`${DIDIT_API_BASE}/session/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.DIDIT_API_KEY,
    },
    body: JSON.stringify({
      workflow_id: process.env.DIDIT_WORKFLOW_ID,
      vendor_data: String(user._id),
      callback: callbackUrl,
      callback_method: 'both',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[Didit] session creation failed:', res.status, text);
    throw Object.assign(new Error('Impossible de créer la session de vérification'), {
      status: 502,
      code: 'DIDIT_SESSION_FAILED',
    });
  }

  const data = await res.json();
  const sessionId = data.session_id;
  const verificationUrl = data.url;
  if (!sessionId || !verificationUrl) {
    console.error('[Didit] unexpected session response shape:', data);
    throw Object.assign(new Error('Réponse Didit inattendue'), { status: 502, code: 'DIDIT_SESSION_FAILED' });
  }

  user.ageVerification = {
    ...(user.ageVerification?.toObject ? user.ageVerification.toObject() : user.ageVerification),
    status: 'pending',
    provider: 'didit',
    sessionId,
    updatedAt: new Date(),
  };
  await user.save();

  return { sessionId, verificationUrl };
}

// Vérifie la signature HMAC-SHA256 d'un webhook Didit (protège contre les
// appels forgés sur un endpoint public non authentifié). Utilise la variante
// X-Signature (raw body) : notre route est montée avec express.raw() avant
// express.json() (cf. server.js), donc le body reçu est déjà le buffer exact
// transmis par Didit — pas besoin de la variante V2 (canonicalisation JSON),
// prévue pour les middlewares qui ré-encodent le body.
export function verifyWebhookSignature({ rawBody, signatureHeader, timestampHeader }) {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Didit] DIDIT_WEBHOOK_SECRET is not set — rejecting webhook');
    return false;
  }
  if (!signatureHeader || !timestampHeader) return false;
  // Fenêtre anti-rejeu recommandée par Didit : 5 minutes.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestampHeader, 10)) > 300) {
    console.warn('[Didit] webhook timestamp outside the 5-minute freshness window');
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signatureHeader, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Traite le payload d'un webhook Didit (event status.updated) et met à jour
// l'utilisateur associé. `vendor_data` porte l'id utilisateur passé à la
// création de session ; `status` est directement Approved/Declined/In
// Review/... (cf. enum Didit) ; `decision.features` liste les étapes qui ont
// tourné, ce qui permet de savoir si l'utilisateur a été approuvé sur la
// seule estimation faciale ou via le fallback KYC complet.
export async function handleWebhookPayload(payload) {
  const sessionId = payload.session_id;
  const userId = payload.vendor_data;
  const status = payload.status;

  if (!userId) {
    console.error('[Didit] webhook payload missing vendor_data:', payload);
    return;
  }

  const user = await User.findById(userId);
  if (!user) {
    console.error('[Didit] webhook references unknown user:', userId);
    return;
  }
  // Ignore les webhooks qui ne correspondent pas à la session en cours (rejeu, session obsolète)
  if (user.ageVerification?.sessionId && sessionId && user.ageVerification.sessionId !== sessionId) {
    console.warn('[Didit] webhook session_id mismatch, ignoring', { userId, sessionId, expected: user.ageVerification.sessionId });
    return;
  }

  let newStatus = 'pending';
  if (status === 'Approved') newStatus = 'approved';
  else if (status === 'Declined' || status === 'Abandoned' || status === 'Kyc Expired' || status === 'Expired') newStatus = 'declined';

  const features = payload.decision?.features || [];
  const method = features.includes('ID_VERIFICATION') ? 'id_document' : 'age_estimation';

  user.ageVerification = {
    ...(user.ageVerification?.toObject ? user.ageVerification.toObject() : user.ageVerification),
    status: newStatus,
    method: newStatus === 'approved' ? method : user.ageVerification?.method || null,
    verifiedAt: newStatus === 'approved' ? new Date() : user.ageVerification?.verifiedAt || null,
    updatedAt: new Date(),
  };
  await user.save();

  if (newStatus === 'declined') {
    console.warn(`[Didit] age verification declined for user ${userId} (session ${sessionId})`);
  }
}
