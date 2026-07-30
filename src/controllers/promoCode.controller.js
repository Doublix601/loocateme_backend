import { PromoCode } from '../models/PromoCode.js';
import { stripe } from '../services/stripe.service.js';

export const PromoCodeController = {
  list: async (req, res, next) => {
    try {
      const promoCodes = await PromoCode.find().sort({ createdAt: -1 });
      return res.json({ promoCodes });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      const { code, discountPercent, trialDays } = req.body || {};
      const normalizedCode = String(code || '').trim().toUpperCase();
      if (!normalizedCode) {
        return res.status(400).json({ code: 'INVALID_CODE', message: 'Code requis' });
      }
      const hasDiscount = discountPercent !== undefined && discountPercent !== null && discountPercent !== '';
      const hasTrial = trialDays !== undefined && trialDays !== null && trialDays !== '';
      if (!hasDiscount && !hasTrial) {
        return res.status(400).json({ code: 'MISSING_ADVANTAGE', message: 'Indiquez une remise et/ou des jours d\'essai' });
      }
      const parsedDiscount = hasDiscount ? Number(discountPercent) : undefined;
      const parsedTrial = hasTrial ? Number(trialDays) : undefined;
      if (hasDiscount && (!Number.isFinite(parsedDiscount) || parsedDiscount < 1 || parsedDiscount > 100)) {
        return res.status(400).json({ code: 'INVALID_DISCOUNT', message: 'Remise invalide (1-100)' });
      }
      if (hasTrial && (!Number.isFinite(parsedTrial) || parsedTrial < 1)) {
        return res.status(400).json({ code: 'INVALID_TRIAL', message: "Jours d'essai invalides" });
      }

      const existing = await PromoCode.findOne({ code: normalizedCode });
      if (existing) {
        return res.status(409).json({ code: 'CODE_ALREADY_EXISTS', message: 'Ce code existe déjà' });
      }

      let stripeCouponId;
      if (parsedDiscount) {
        const coupon = await stripe.coupons.create({ percent_off: parsedDiscount, duration: 'once' });
        stripeCouponId = coupon.id;
      }

      const promoCode = await PromoCode.create({
        code: normalizedCode,
        discountPercent: parsedDiscount,
        trialDays: parsedTrial,
        stripeCouponId,
        createdBy: req.user.id,
      });
      return res.status(201).json({ promoCode });
    } catch (err) {
      next(err);
    }
  },

  remove: async (req, res, next) => {
    try {
      const { id } = req.params;
      const promoCode = await PromoCode.findById(id);
      if (!promoCode) {
        return res.status(404).json({ code: 'PROMO_CODE_NOT_FOUND', message: 'Code promo introuvable' });
      }
      if (promoCode.stripeCouponId) {
        try {
          await stripe.coupons.del(promoCode.stripeCouponId);
        } catch (err) {
          console.error('[promoCode] stripe.coupons.del failed', promoCode.stripeCouponId, err?.message);
        }
      }
      await promoCode.deleteOne();
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
};

// Résout un code promo saisi par le pro au checkout : recherche insensible à la
// casse, doit être actif. Retourne null si absent/inactif plutôt que de lever,
// pour laisser l'appelant décider du code d'erreur HTTP.
export async function resolvePromoCode(rawCode) {
  const normalizedCode = String(rawCode || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  const promoCode = await PromoCode.findOne({ code: normalizedCode, active: true });
  return promoCode || null;
}
