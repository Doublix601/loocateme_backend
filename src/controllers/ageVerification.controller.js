import {
  isAgeVerificationEnabled,
  createAgeVerificationSession,
  verifyWebhookSignature,
  applyWebhookDecision,
} from '../services/ageVerification.service.js';

// Deep link de retour dans l'app apres le parcours Didit.
const CALLBACK_URL = process.env.DIDIT_CALLBACK_URL || 'loocateme://age-verification/complete';

export const AgeVerificationController = {
  // GET /api/age-verification/status
  status: async (req, res) => {
    const enabled = isAgeVerificationEnabled();
    const status = req.user?.ageVerification?.status || 'unverified';
    return res.json({ enabled, status, cleared: !enabled || status === 'approved' });
  },

  // POST /api/age-verification/session
  session: async (req, res, next) => {
    try {
      if (!isAgeVerificationEnabled()) {
        return res.status(409).json({ code: 'AGE_VERIFICATION_DISABLED', message: 'Age verification is not enabled.' });
      }
      const { url, sessionId } = await createAgeVerificationSession(req.user.id, { callbackUrl: CALLBACK_URL });
      return res.json({ url, sessionId });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/age-verification/webhook
  // Monte en top-level AVANT express.json() (cf. server.js) : le corps brut est
  // requis pour verifier la signature Didit.
  webhook: async (req, res) => {
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '{}'));
      } catch (_) {
        return res.status(400).json({ code: 'BAD_PAYLOAD' });
      }
      if (!verifyWebhookSignature(req.body, req.headers, parsed)) {
        return res.status(401).json({ code: 'BAD_SIGNATURE' });
      }
      await applyWebhookDecision(parsed);
      return res.json({ received: true });
    } catch (err) {
      console.error('[age-verification/webhook] error:', err?.message || err);
      // 200 apres signature valide : Didit re-essaie sinon.
      return res.status(200).json({ received: true });
    }
  },
};
