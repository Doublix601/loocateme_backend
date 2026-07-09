import { User } from '../models/User.js';
import { PolicyEmailJob } from '../models/PolicyEmailJob.js';
import { sendMail } from './email.service.js';

const POLICY_URL = process.env.PRIVACY_POLICY_URL || `${process.env.APP_PUBLIC_URL || 'https://loocate.me'}/privacy`;

// Single template used for both major and minor updates — only the "action
// required" line differs.
function buildPolicyUpdateEmail({ version, changelog, publishedAt, requiresConsent }) {
  const dateStr = new Date(publishedAt).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  const actionLine = requiresConsent
    ? "Cette mise à jour majeure nécessite votre accord : une action vous sera demandée lors de votre prochaine connexion à l'application."
    : "Cette mise à jour est informative, aucune action n'est requise de votre part.";

  const subject = `Notre politique de confidentialité a été mise à jour (v${version})`;
  const text = [
    `Notre politique de confidentialité a été mise à jour (version ${version}), en vigueur depuis le ${dateStr}.`,
    '',
    'Résumé des changements :',
    changelog || '(non précisé)',
    '',
    actionLine,
    '',
    `Consulter le texte complet : ${POLICY_URL}`,
  ].join('\n');

  const html = `
    <p>Notre politique de confidentialité a été mise à jour (version <strong>${version}</strong>), en vigueur depuis le ${dateStr}.</p>
    <p><strong>Résumé des changements :</strong><br/>${escapeHtml(changelog || '(non précisé)').replace(/\n/g, '<br/>')}</p>
    <p>${actionLine}</p>
    <p><a href="${POLICY_URL}">Consulter le texte complet de la politique de confidentialité</a></p>
  `;

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Called right after a new policy version is published: creates a job that
// CronService will drain in small batches.
export async function enqueuePolicyEmailJob(policyDoc) {
  const totalUsers = await User.estimatedDocumentCount();
  return PolicyEmailJob.create({
    policyVersion: policyDoc.version,
    totalUsers,
    status: 'pending',
  });
}

// Processes one batch of one pending/processing job. Meant to be called
// periodically (cron tick) so email volume is spread out instead of firing
// all at once.
export async function processPolicyEmailJobs() {
  const job = await PolicyEmailJob.findOne({ status: { $in: ['pending', 'processing'] } }).sort({ createdAt: 1 });
  if (!job) return;

  const { PrivacyPolicy } = await import('../models/PrivacyPolicy.js');
  const policy = await PrivacyPolicy.findOne({ version: job.policyVersion }).lean();
  if (!policy) {
    job.status = 'failed';
    job.lastError = 'Policy version not found';
    await job.save();
    return;
  }

  const emailContent = buildPolicyUpdateEmail({
    version: policy.version,
    changelog: policy.changelog,
    publishedAt: policy.publishedAt,
    requiresConsent: policy.requiresConsent,
  });

  const query = { email: { $exists: true, $ne: '' } };
  if (job.cursor) query._id = { $gt: job.cursor };

  const users = await User.find(query, { email: 1 }).sort({ _id: 1 }).limit(job.batchSize).lean();

  if (users.length === 0) {
    job.status = 'done';
    await job.save();
    return;
  }

  job.status = 'processing';
  for (const user of users) {
    try {
      await sendMail({ to: user.email, subject: emailContent.subject, text: emailContent.text, html: emailContent.html });
      job.sentCount += 1;
    } catch (e) {
      job.failedCount += 1;
      job.lastError = e?.message || String(e);
      console.warn(`[policyNotification] Failed to email user ${user._id}:`, job.lastError);
    }
    job.cursor = user._id;
  }
  await job.save();
}
