import crypto from 'crypto';
import { User } from '../models/User.js';
import { Referral } from '../models/Referral.js';
import { sendPushUnified } from './push.service.js';

const TARGET_COUNT = 5;
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000; // flat 30 jours, évite les cas Fév/31 jours
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I ambigus
const APP_BASE_URL = process.env.REFERRAL_SHARE_BASE_URL || 'https://api.loocate.me';

// Toutes les dates de parrainage/premium sont comparées en UTC, convention
// unique réutilisée par le cron d'expiration et l'affichage mobile.
export function monthKeyOf(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// Génération paresseuse : évite un script de migration pour les utilisateurs
// existants, le code est créé au premier appel de GET /referrals/me.
export async function getOrCreateReferralCode(userId) {
  const user = await User.findById(userId).select('referralCode');
  if (!user) throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND', status: 404 });
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      await User.updateOne({ _id: userId, referralCode: null }, { $set: { referralCode: code } });
      const refreshed = await User.findById(userId).select('referralCode');
      if (refreshed.referralCode) return refreshed.referralCode;
    } catch (err) {
      if (err?.code !== 11000) throw err; // collision sur l'unique index, on retente
    }
  }
  throw Object.assign(new Error('Could not generate referral code'), { code: 'CODE_GENERATION_FAILED', status: 500 });
}

export async function getReferralProgress(userId) {
  const user = await User.findById(userId).select('referralCode referralStats isPremium premiumSource premiumExpiresAt');
  const stats = user.referralStats || {};
  const monthKey = monthKeyOf();
  const currentMonthValidatedCount = stats.currentMonthKey === monthKey ? (stats.currentMonthValidatedCount || 0) : 0;
  const rewardActive = user.premiumSource === 'referral_reward' && user.premiumExpiresAt && user.premiumExpiresAt > new Date();
  return {
    referralCode: user.referralCode,
    shareUrl: user.referralCode ? `${APP_BASE_URL}/invite/${user.referralCode}` : null,
    currentMonthKey: monthKey,
    currentMonthValidatedCount,
    targetCount: TARGET_COUNT,
    totalValidatedCount: stats.totalValidatedCount || 0,
    rewardActive,
    rewardExpiresAt: rewardActive ? user.premiumExpiresAt : null,
  };
}

export async function getReferralHistory(userId, { page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const referrals = await Referral.find({ referrer: userId })
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .populate('referred', 'username profileImageUrl')
    .lean();
  return referrals.map((r) => ({
    referredUser: r.referred ? { username: r.referred.username, profileImageUrl: r.referred.profileImageUrl } : null,
    status: r.status,
    redeemedAt: r.redeemedAt,
    validatedAt: r.validatedAt,
  }));
}

function err(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

// Saisie d'un code de parrainage par le filleul. Le parrainage ne "compte"
// que lorsque le filleul effectue son premier check-in vérifié (cf.
// validateReferralIfAny, appelé depuis user.service.js/updateLocation) —
// jamais à la simple inscription, pour éviter de récompenser des comptes
// créés mais jamais réellement actifs sur le terrain.
export async function redeemCode(userId, rawCode) {
  const normalizedCode = String(rawCode || '').trim().toUpperCase();
  if (!normalizedCode) throw err('INVALID_CODE', 'Code requis', 400);

  const referrer = await User.findOne({ referralCode: normalizedCode }).select('_id moderation');
  if (!referrer) throw err('INVALID_CODE', 'Code de parrainage invalide', 404);
  if (String(referrer._id) === String(userId)) throw err('SELF_REFERRAL', 'Vous ne pouvez pas utiliser votre propre code', 400);

  const referredUser = await User.findById(userId).select('referredBy');
  if (!referredUser) throw err('USER_NOT_FOUND', 'Utilisateur introuvable', 404);
  if (referredUser.referredBy) throw err('ALREADY_REFERRED', 'Vous avez déjà utilisé un code de parrainage', 409);

  let referralDoc;
  try {
    referralDoc = await Referral.create({ referrer: referrer._id, referred: userId, code: normalizedCode });
  } catch (dbErr) {
    if (dbErr?.code === 11000) throw err('ALREADY_REFERRED', 'Vous avez déjà utilisé un code de parrainage', 409);
    throw dbErr;
  }

  await User.updateOne({ _id: userId, referredBy: null }, { $set: { referredBy: referrer._id } });

  // Pas de validation immédiate ici, même si le filleul a déjà un historique de
  // présence : on attend son PROCHAIN check-in vérifié (cf. updateLocation) pour
  // rester cohérent avec le cas nominal (code saisi avant toute sortie).
  return { ok: true, pending: true };
}

// Point d'entrée unique, appelé depuis user.service.js/updateLocation au
// moment où le premier "location_visit" (check-in vérifié, présence >= 5 min
// sur un lieu) du filleul est enregistré. Idempotent : le filtre
// `status: 'pending'` empêche une double validation si appelé plusieurs fois.
export async function validateReferralIfAny(referredUser) {
  try {
    const now = new Date();
    const monthKey = monthKeyOf(now);

    // Atomique et idempotent : le filtre `status: 'pending'` garantit qu'un seul des
    // deux appelants possibles (hook email-verify vs. redeem tardif) gagne la course,
    // sans avoir besoin d'un statut de verrou intermédiaire.
    const referralDoc = await Referral.findOneAndUpdate(
      { referred: referredUser._id, status: 'pending' },
      { $set: { status: 'validated', validatedAt: now, validatedMonthKey: monthKey } },
      { new: true }
    );
    if (!referralDoc) return null; // pas de parrainage en attente, ou déjà traité

    const referrer = await User.findById(referralDoc.referrer).select('moderation referralStats');
    if (!referrer || referrer.moderation?.bannedPermanent) {
      await Referral.updateOne(
        { _id: referralDoc._id },
        { $set: { status: 'void', voidReason: referrer ? 'referrer_banned' : 'referrer_missing' } }
      );
      return null;
    }

    await bumpReferrerCounters(referrer, monthKey);
    return { status: 'validated' };
  } catch (e) {
    // Ne jamais laisser une erreur de parrainage remonter (l'appelant, ex. la
    // vérification d'email, ne doit jamais échouer à cause de ce module).
    console.error('[referral] validateReferralIfAny error:', e?.message || e);
    return null;
  }
}

async function bumpReferrerCounters(referrer, monthKey) {
  const stats = referrer.referralStats || {};
  const sameMonth = stats.currentMonthKey === monthKey;
  const nextCount = (sameMonth ? stats.currentMonthValidatedCount || 0 : 0) + 1;
  const totalCount = (stats.totalValidatedCount || 0) + 1;

  await User.updateOne(
    { _id: referrer._id },
    {
      $set: {
        'referralStats.currentMonthKey': monthKey,
        'referralStats.currentMonthValidatedCount': nextCount,
        'referralStats.totalValidatedCount': totalCount,
      },
    }
  );

  sendPushUnified({
    userIds: [referrer._id],
    title: '🎉 Parrainage validé',
    body:
      nextCount >= TARGET_COUNT
        ? 'Un ami a rejoint LoocateMe grâce à toi !'
        : `Un ami a rejoint LoocateMe grâce à toi ! Plus que ${TARGET_COUNT - nextCount} pour ton mois Premium offert.`,
    data: { kind: 'referral_validated' },
  }).catch((e) => console.error('[referral] push referral_validated failed:', e?.message || e));

  if (nextCount >= TARGET_COUNT && stats.lastRewardGrantedMonthKey !== monthKey) {
    await User.updateOne({ _id: referrer._id }, { $set: { 'referralStats.lastRewardGrantedMonthKey': monthKey } });
    await grantReferralReward(referrer._id);
  }
}

async function grantReferralReward(userId) {
  const now = new Date();
  const user = await User.findById(userId).select('isPremium premiumSource premiumExpiresAt');

  if (user.premiumSource === 'referral_reward' && user.premiumExpiresAt && user.premiumExpiresAt > now) {
    // Un mois offert est déjà actif : pas de stacking (requirement "no cumul"), on
    // n'allonge pas la durée. L'utilisateur a quand même gagné son palier de 5, on
    // le notifie sans laisser penser qu'un 2e mois a été ajouté.
    await sendPushUnified({
      userIds: [userId],
      title: '💎 Encore 5 parrainages !',
      body: 'Ton mois Premium offert est déjà actif, il ne peut pas être prolongé ce mois-ci.',
      data: { kind: 'referral_reward_granted', stacked: false },
    }).catch((e) => console.error('[referral] push reward (already active) failed:', e?.message || e));
    return;
  }

  if (user.isPremium && user.premiumSource === 'paid') {
    // Déjà abonné payant : on met la récompense en attente plutôt que de la
    // perdre silencieusement. Elle sera appliquée par le webhook Stripe
    // d'annulation (payment.controller.js) quand isPremium repassera à false.
    await User.updateOne({ _id: userId }, { $set: { pendingReferralReward: true } });
    await sendPushUnified({
      userIds: [userId],
      title: '💎 Mois Premium offert gagné !',
      body: "Tu es déjà abonné Premium : ton mois offert s'activera automatiquement à la fin de ton abonnement actuel.",
      data: { kind: 'referral_reward_granted', banked: true },
    }).catch((e) => console.error('[referral] push reward (banked) failed:', e?.message || e));
    return;
  }

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        isPremium: true,
        premiumSource: 'referral_reward',
        premiumExpiresAt: new Date(now.getTime() + ONE_MONTH_MS),
      },
    }
  );
  await sendPushUnified({
    userIds: [userId],
    title: '💎 Mois Premium offert !',
    body: "Merci d'avoir parrainé 5 amis ce mois-ci : ton mois Premium est actif.",
    data: { kind: 'referral_reward_granted', banked: false },
  }).catch((e) => console.error('[referral] push reward granted failed:', e?.message || e));
}

// Appelé par le cron quotidien (cron.service.js) : expire le premium offert
// par parrainage, et applique les récompenses "banquées" pour les comptes qui
// ne sont plus premium (ex. abonnement payant résilié via webhook Stripe).
export async function expireReferralRewardsAndApplyBanked() {
  const now = new Date();
  await User.updateMany(
    { premiumSource: 'referral_reward', premiumExpiresAt: { $lte: now } },
    { $set: { isPremium: false, premiumSource: null, premiumExpiresAt: null } }
  );

  const candidates = await User.find({ pendingReferralReward: true, isPremium: { $ne: true } }).select('_id');
  for (const candidate of candidates) {
    await User.updateOne(
      { _id: candidate._id },
      {
        $set: {
          isPremium: true,
          premiumSource: 'referral_reward',
          premiumExpiresAt: new Date(now.getTime() + ONE_MONTH_MS),
          pendingReferralReward: false,
        },
      }
    );
    sendPushUnified({
      userIds: [candidate._id],
      title: '💎 Mois Premium offert activé !',
      body: 'Ton mois Premium gagné par parrainage est maintenant actif.',
      data: { kind: 'referral_reward_granted', banked: false },
    }).catch((e) => console.error('[referral] push banked reward applied failed:', e?.message || e));
  }
}
