import { User } from '../models/User.js';

export const PaymentController = {
  revenueCatWebhook: async (req, res, next) => {
    try {
      // Sécurité optionnelle : vérifier le secret RevenueCat si configuré
      const authHeader = req.headers.authorization;
      const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
      if (secret && authHeader !== `Bearer ${secret}`) {
        return res.status(401).json({ message: 'Unauthorized webhook' });
      }

      const { event } = req.body;
      if (!event) return res.status(400).json({ message: 'No event' });

      const { type, app_user_id, subscriber_attributes } = event;

      console.log(`[Payment] RevenueCat Webhook received: ${type} for user ${app_user_id}`);

      // L'app_user_id correspond à l'ID de l'utilisateur dans notre base
      const user = await User.findById(app_user_id);
      if (!user) {
        console.warn(`[Payment] User ${app_user_id} not found for RevenueCat event`);
        return res.status(404).json({ message: 'User not found' });
      }

      const now = new Date();

      switch (type) {
        case 'INITIAL_PURCHASE':
        case 'RENEWAL':
        case 'UNCANCELLATION':
        case 'SUBSCRIPTION_EXTENDED':
          user.isPremium = true;
          // On peut aussi enregistrer la date d'expiration si fournie dans l'event
          if (event.expiration_at_ms) {
            user.premiumTrialEnd = new Date(event.expiration_at_ms);
          }
          break;

        case 'CANCELLATION':
        case 'EXPIRATION':
        case 'BILLING_ISSUE':
          // Pour une annulation (CANCELLATION), RevenueCat notifie souvent quand l'utilisateur désactive le renouvellement auto.
          // Pour l'EXPIRATION, c'est là qu'on retire vraiment les droits.
          if (type === 'EXPIRATION' || type === 'BILLING_ISSUE') {
            user.isPremium = false;
          }
          break;

        case 'TRANSFER':
          // Gérer le transfert d'achats entre comptes si nécessaire
          break;

        default:
          console.log(`[Payment] Unhandled RevenueCat event type: ${type}`);
      }

      await user.save();
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[Payment] RevenueCat Webhook error:', err);
      next(err);
    }
  }
};
