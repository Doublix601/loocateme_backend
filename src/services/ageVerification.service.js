import crypto from 'crypto';
import { User } from '../models/User.js';
import { invalidateAuthCache } from '../utils/authCache.js';

// Vérification d'âge renforcée via Didit (https://docs.didit.me).
//
// État : SCAFFOLD prêt mais INERTE tant que DIDIT_AGE_VERIFICATION_ENABLED !== 'true'.
// Rien n'est appelé, aucune route n'impose la vérification, tant que le flag est off.
//
// Pour passer en production, voir docs/AGE_VERIFICATION.md :
//   1. Forwarder DIDIT_* dans docker-compose.yml (déjà fait).
//   2. Renseigner le webhook « https://api.loocate.me/api/age-verification/webhook »
//      dans la console Didit, et le callback (deep link app) dans le workflow.
//   3. Tester une session en sandbox.
//   4. Appliquer requireAgeVerified sur les routes de contenu (1 ligne, cf. plus bas).
//   5. Basculer DIDIT_AGE_VERIFICATION_ENABLED=true.
//   6. Publier la nouvelle version de POLICY_PRIVACY.md décrivant la vérification comme active.

const DIDIT_BASE_URL = process.env.DIDIT_BASE_URL || 'https://verification.didit.me';

export function isAgeVerificationEnabled() {
  return process.env.DIDIT_AGE_VERIFICATION_ENABLED === 'true';
}

function requireConfig() {
  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  if (!apiKey || !workflowId) {
    const err = new Error('Age verification is not configured (DIDIT_API_KEY / DIDIT_WORKFLOW_ID missing).');
    err.status = 503;
    err.code = 'AGE_VERIFICATION_UNCONFIGURED';
    throw err;
  }
  return { apiKey, workflowId };
}

/**
 * Crée une session de vérification Didit pour un utilisateur.
 * `vendor_data` = userId : c'est ce qui permet au webhook de retrouver le compte.
 * Renvoie { url, sessionId } — l'app ouvre `url` (WebView / navigateur), Didit
 * redirige vers `callbackUrl` à la fin, et le résultat définitif arrive par webhook.
 */
export async function createAgeVerificationSession(userId, { callbackUrl } = {}) {
  const { apiKey, workflowId } = requireConfig();

  const res = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      vendor_data: String(userId),
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Didit session creation failed (${res.status})`);
    err.status = 502;
    err.code = 'AGE_VERIFICATION_PROVIDER_ERROR';
    err.details = json;
    throw err;
  }

  const sessionId = json.session_id || json.id;
  const url = json.verification_url || json.url;
  if (!sessionId || !url) {
    const err = new Error('Didit response missing session_id / url');
    err.status = 502;
    err.code = 'AGE_VERIFICATION_PROVIDER_ERROR';
    err.details = json;
    throw err;
  }

  await User.findByIdAndUpdate(userId, {
    $set: {
      'ageVerification.provider': 'didit',
      'ageVerification.sessionId': sessionId,
      'ageVerification.status': 'pending',
      'ageVerification.updatedAt': new Date(),
    },
  });

  return { url, sessionId };
}

// Statuts Didit -> statut interne. Voir docs.didit.me : Not Started / In Progress /
// Approved / Declined / In Review / Expired / Abandoned / KYC Expired.
function mapDiditStatus(diditStatus) {
  switch (String(diditStatus || '').toLowerCase().replace(/\s+/g, '_')) {
    case 'approved':
      return 'approved';
    case 'declined':
    case 'expired':
    case 'abandoned':
    case 'kyc_expired':
      return 'declined';
    case 'in_review':
    case 'in_progress':
    case 'not_started':
    default:
      return 'pending';
  }
}

/**
 * Vérifie la signature d'un webhook Didit.
 * Didit envoie plusieurs en-têtes ; on accepte X-Signature-Simple
 * (HMAC-SHA256 hex de `${session_id}|${status}|${created_at}`) ou
 * X-Signature (HMAC-SHA256 hex du corps brut). `rawBody` doit être le Buffer/string
 * exact reçu (monter la route avec express.raw, pas express.json).
 */
export function verifyWebhookSignature(rawBody, headers, parsed) {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) return false;

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const h = (name) => headers[name] || headers[name.toLowerCase()];

  const full = h('X-Signature') || h('X-Signature-V2');
  if (full) {
    const expected = crypto.createHmac('sha256', secret).update(bodyStr, 'utf8').digest('hex');
    if (safeEqual(full, expected)) return true;
  }

  const simple = h('X-Signature-Simple');
  if (simple && parsed) {
    const data = `${parsed.session_id}|${parsed.status}|${parsed.created_at}`;
    const expected = crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');
    if (safeEqual(simple, expected)) return true;
  }

  return false;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Applique la décision d'un webhook Didit au compte utilisateur.
 * Le compte est retrouvé via `vendor_data` (userId) ou, à défaut, via le sessionId
 * mémorisé lors de createAgeVerificationSession.
 */
export async function applyWebhookDecision(payload) {
  const sessionId = payload?.session_id || payload?.session?.session_id;
  const vendorData = payload?.vendor_data || payload?.session?.vendor_data;
  const diditStatus = payload?.status || payload?.decision?.status;
  if (!sessionId) return { ok: false, reason: 'no_session_id' };

  const status = mapDiditStatus(diditStatus);

  const query = vendorData
    ? { _id: vendorData }
    : { 'ageVerification.sessionId': sessionId };

  const update = {
    'ageVerification.provider': 'didit',
    'ageVerification.sessionId': sessionId,
    'ageVerification.status': status,
    'ageVerification.updatedAt': new Date(),
  };
  if (status === 'approved') update['ageVerification.verifiedAt'] = new Date();

  const user = await User.findOneAndUpdate(query, { $set: update }, { new: true });
  if (user?._id) {
    try { await invalidateAuthCache(String(user._id)); } catch (_) {}
  }
  return { ok: !!user, status, userId: user?._id };
}

/**
 * true si l'utilisateur peut accéder au contenu au regard de la vérification d'âge.
 * Si le système est désactivé, tout le monde passe (comportement historique).
 */
export function isUserAgeCleared(user) {
  if (!isAgeVerificationEnabled()) return true;
  return user?.ageVerification?.status === 'approved';
}
