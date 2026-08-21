import crypto from 'crypto';
import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { getLocationStats } from './businessStats.service.js';
import { sendMail } from './email.service.js';

const WEEKDAY_LABELS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// Lazy check pattern (like email.service.js SMTP_PASS) — read secret fresh each time
// so tests can set process.env.DIGEST_UNSUBSCRIBE_SECRET and have it take effect.
function getUnsubscribeSecret() {
  return process.env.DIGEST_UNSUBSCRIBE_SECRET || '';
}

// Identité légale reprise de POLICY_PRIVACY.md §1 — exigée par CAN-SPAM (adresse
// postale de l'expéditeur) pour tout email envoyé à des destinataires US.
const COMPANY_FOOTER =
  "LoocateMe est édité par Arnaud THERET, entrepreneur individuel (micro-entreprise), domicilié 53 rue de Paris, 60200 Compiègne, France.";

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// index 0 = lundi ... 6 = dimanche (cf. Location.analytics.visitsByWeekday). Retourne
// null si aucune visite sur la fenêtre (pas de jour "meilleur" à afficher).
function bestWeekdayLabel(visitsByWeekday) {
  if (!Array.isArray(visitsByWeekday) || visitsByWeekday.every((v) => !v)) return null;
  let bestIndex = 0;
  for (let i = 1; i < visitsByWeekday.length; i += 1) {
    if (visitsByWeekday[i] > visitsByWeekday[bestIndex]) bestIndex = i;
  }
  return WEEKDAY_LABELS_FR[bestIndex];
}

export function buildDigestEmail({ location, stats, unsubscribeUrl }) {
  const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';
  const statsUrl = `${siteUrl}/dashboard/stats`;
  const { current, deltaPct } = stats.views['7d'];
  const best = bestWeekdayLabel(stats.visitsByWeekday);

  const trendSuffix = deltaPct !== null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct}% vs semaine précédente)` : '';
  const viewsLine = current > 0
    ? `Votre fiche a été vue ${current} fois cette semaine${trendSuffix}.`
    : 'Aucune vue sur votre fiche cette semaine, pensez à booster votre visibilité.';
  const bestLine = best ? `Votre meilleur jour a été ${best}.` : '';

  const subject = `Votre semaine sur LoocateMe Pro — ${location.name}`;
  const text = [
    viewsLine,
    bestLine,
    '',
    `Voir toutes vos statistiques : ${statsUrl}`,
    '',
    COMPANY_FOOTER,
    `Se désabonner de ce résumé hebdomadaire : ${unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <p>${escapeHtml(viewsLine)}</p>
    ${bestLine ? `<p>${escapeHtml(bestLine)}</p>` : ''}
    <p><a href="${statsUrl}">Voir toutes vos statistiques</a></p>
    <p style="color:#888;font-size:12px;">${escapeHtml(COMPANY_FOOTER)}<br/><a href="${unsubscribeUrl}">Se désabonner de ce résumé hebdomadaire</a></p>
  `;

  return { subject, text, html };
}

export function signUnsubscribeToken(locationId) {
  const secret = getUnsubscribeSecret();
  if (!secret) {
    const msg = 'DIGEST_UNSUBSCRIBE_SECRET manquant: définissez la variable d\'environnement DIGEST_UNSUBSCRIBE_SECRET.';
    console.error('[businessDigest] ' + msg);
    throw new Error(msg);
  }
  const id = String(locationId);
  const signature = crypto.createHmac('sha256', secret).update(id).digest('hex');
  return `${id}.${signature}`;
}

// Retourne le locationId si le token est valide, sinon null. Comparaison en temps
// constant pour ne pas laisser fuiter d'information sur la signature attendue.
export function verifyUnsubscribeToken(token) {
  const secret = getUnsubscribeSecret();
  if (!secret) return null;
  if (!token || typeof token !== 'string') return null;
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const id = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', secret).update(id).digest('hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;
  return id;
}

// Boucle sur les lieux Pro2/Pro3 n'ayant pas désactivé le digest et envoie un email
// récapitulatif hebdomadaire à leur propriétaire. sendMailFn/getStatsFn sont
// injectables pour les tests (ce sont des exports de fonction ESM, non mockables
// depuis l'extérieur du module) ; en production, sendBusinessWeeklyDigest() est
// appelé sans argument par cron.service.js. Retourne le nombre d'emails envoyés.
export async function sendBusinessWeeklyDigest({ sendMailFn = sendMail, getStatsFn = getLocationStats } = {}) {
  const locations = await Location.find({
    businessTier: { $in: ['pro2', 'pro3'] },
    'notificationPreferences.weeklyDigestEmail': { $ne: false },
  })
    .select('_id name ownerId')
    .lean();

  const apiBaseUrl = process.env.API_PUBLIC_URL || process.env.BASE_URL || 'https://api.loocate.me';

  let sentCount = 0;
  for (const location of locations) {
    try {
      const owner = await User.findById(location.ownerId).select('email').lean();
      if (!owner?.email) continue;

      const stats = await getStatsFn(location._id);
      const unsubscribeUrl = `${apiBaseUrl}/api/business/digest/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(location._id))}`;
      const { subject, text, html } = buildDigestEmail({ location, stats, unsubscribeUrl });

      await sendMailFn({ to: owner.email, subject, text, html });
      sentCount += 1;
    } catch (e) {
      console.error(`[businessDigest] Failed to send weekly digest for location ${location._id}:`, e?.message || e);
    }
  }
  return sentCount;
}
