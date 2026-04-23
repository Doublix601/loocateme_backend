import { User } from '../models/User.js';

/**
 * RevenueCat Webhook Controller
 * Handles subscription updates and consumable purchases (Boosts)
 */
export const handleWebhook = async (req, res) => {
  try {
    const { event } = req.body;
    if (!event) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const { type, app_user_id, product_id, entitlement_ids } = event;

    console.log(`[RevenueCat Webhook] Event Type: ${type}, User: ${app_user_id}`);

    const user = await User.findById(app_user_id);
    if (!user) {
      console.warn(`[RevenueCat Webhook] User not found: ${app_user_id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'CANCELLATION':
      case 'EXPIRATION':
      case 'BILLING_ISSUE':
        // Handle Premium Entitlement
        const hasPremium = entitlement_ids && entitlement_ids.includes('premium');
        user.isPremium = hasPremium;
        await user.save();
        console.log(`[RevenueCat Webhook] User ${user.username} premium status updated to: ${hasPremium}`);
        break;

      case 'NON_RENEWING_PURCHASE':
        // Handle Boosts (Consumables)
        // Check product_id to determine how many boosts to add
        if (product_id === 'boost') {
          user.boostBalance = (user.boostBalance || 0) + 1;

          // Optionally auto-activate if not already boosted
          const now = new Date();
          if (!user.boostUntil || user.boostUntil < now) {
            user.boostBalance -= 1;
            user.boostUntil = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes boost
          }

          await user.save();
          console.log(`[RevenueCat Webhook] User ${user.username} boost processed. Balance: ${user.boostBalance}, BoostUntil: ${user.boostUntil}`);
        }
        break;

      default:
        console.log(`[RevenueCat Webhook] Unhandled event type: ${type}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[RevenueCat Webhook] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
