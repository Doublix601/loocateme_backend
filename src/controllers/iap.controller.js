import { User } from '../models/User.js';

const CONSUMABLE_GRANTS = {
  loocateme_boost_pack_1: { field: 'boostBalance', amount: 1 },
  loocateme_boost_pack_5: { field: 'boostBalance', amount: 5 },
  loocateme_superlike_pack_3: { field: 'superlikeBalance', amount: 3 },
  loocateme_superlike_pack_10: { field: 'superlikeBalance', amount: 10 },
};

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
      case 'BILLING_ISSUE': {
        const hasPremium = entitlement_ids && entitlement_ids.includes('premium');
        user.isPremium = hasPremium;
        await user.save();
        console.log(`[RevenueCat Webhook] User ${user.username} premium status updated to: ${hasPremium}`);
        break;
      }

      case 'NON_RENEWING_PURCHASE': {
        const grant = CONSUMABLE_GRANTS[product_id];
        if (grant) {
          user[grant.field] = (user[grant.field] || 0) + grant.amount;
          await user.save();
          console.log(`[RevenueCat Webhook] User ${user.username} ${grant.field} +${grant.amount} → ${user[grant.field]}`);
        } else {
          console.warn(`[RevenueCat Webhook] Unknown consumable product_id: ${product_id}`);
        }
        break;
      }

      default:
        console.log(`[RevenueCat Webhook] Unhandled event type: ${type}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[RevenueCat Webhook] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
