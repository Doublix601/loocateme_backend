import { User } from '../models/User.js';
import { createAgeVerificationSession, verifyWebhookSignature, handleWebhookPayload } from '../services/didit.service.js';

function isEnabled() {
  return process.env.DIDIT_AGE_VERIFICATION_ENABLED === 'true';
}

export const AgeVerificationController = {
  // Démarre (ou relance) une session de vérification d'âge pour l'utilisateur connecté.
  startSession: async (req, res, next) => {
    try {
      // Défense en profondeur : protège même si un client mobile obsolète (feature
      // flag pas encore rafraîchi côté app) tente quand même l'appel.
      if (!isEnabled()) {
        return res.status(403).json({ code: 'AGE_VERIFICATION_DISABLED', message: 'La vérification d\'âge est désactivée' });
      }
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      if (user.ageVerification?.status === 'approved') {
        return res.json({ status: 'approved' });
      }
      const { sessionId, verificationUrl } = await createAgeVerificationSession(user);
      return res.json({ status: 'pending', sessionId, verificationUrl });
    } catch (err) {
      next(err);
    }
  },

  // Statut courant, pour que l'app puisse poller après fermeture de la WebView.
  getStatus: async (req, res, next) => {
    try {
      if (!isEnabled()) {
        return res.status(403).json({ code: 'AGE_VERIFICATION_DISABLED', message: 'La vérification d\'âge est désactivée' });
      }
      const user = await User.findById(req.user.id).select('ageVerification').lean();
      if (!user) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
      return res.json({ ageVerification: user.ageVerification || { status: 'not_started' } });
    } catch (err) {
      next(err);
    }
  },

  // Webhook Didit — non authentifié par JWT, sécurisé par signature HMAC.
  // Monté avec express.raw() (cf. server.js) pour que req.body soit le Buffer brut
  // nécessaire au calcul de la signature, à l'instar du webhook Stripe existant.
  webhook: async (req, res, next) => {
    try {
      const signature = req.headers['x-signature'];
      const timestamp = req.headers['x-timestamp'];
      const rawBody = req.body;
      const ok = verifyWebhookSignature({ rawBody, signatureHeader: signature, timestampHeader: timestamp });
      if (!ok) {
        return res.status(401).json({ message: 'Invalid webhook signature' });
      }
      const payload = JSON.parse(rawBody.toString('utf8'));
      await handleWebhookPayload(payload);
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[Didit] webhook processing error:', err);
      // On répond 200 pour éviter des retries en boucle sur une erreur non transitoire,
      // l'erreur est déjà loguée pour investigation.
      return res.status(200).json({ received: true });
    }
  },

  // Page de callback affichée dans la WebView après redirection Didit (fin de flow côté navigateur).
  callback: async (req, res) => {
    res.send(`<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:40px;">
      <h2>Vérification en cours de traitement</h2>
      <p>Vous pouvez fermer cette fenêtre et retourner sur l'application.</p>
    </body></html>`);
  },
};
