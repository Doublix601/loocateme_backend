import { BusinessClaimRequest } from '../models/BusinessClaimRequest.js';
import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { sendMail } from './email.service.js';
import { requestBusinessActivationEmail } from './auth.service.js';

export async function createClaimRequest({ locationId, applicantEmail, applicantName, applicantPhone, documents }) {
  const location = await Location.findById(locationId).select('_id name isPro').lean();
  if (!location) {
    throw Object.assign(new Error('Lieu introuvable'), { status: 404, code: 'LOCATION_NOT_FOUND' });
  }
  if (location.isPro) {
    throw Object.assign(new Error('Ce lieu a déjà un compte professionnel associé'), { status: 409, code: 'LOCATION_ALREADY_PRO' });
  }
  const existingPending = await BusinessClaimRequest.findOne({ locationId, status: 'pending' }).select('_id').lean();
  if (existingPending) {
    throw Object.assign(new Error('Une candidature est déjà en attente pour ce lieu'), { status: 409, code: 'CLAIM_ALREADY_PENDING' });
  }

  const claim = await BusinessClaimRequest.create({
    locationId,
    applicantEmail: String(applicantEmail || '').toLowerCase().trim(),
    applicantName,
    applicantPhone: applicantPhone || '',
    documents: documents || [],
  });

  try {
    await sendMail({
      to: claim.applicantEmail,
      subject: 'Votre candidature LoocateMe Pro a bien été reçue',
      text: `Bonjour ${applicantName},
Nous avons bien reçu votre candidature pour gérer "${location.name}" sur LoocateMe.
Notre équipe va examiner vos documents et vous recontactera par email sous peu.`,
      html: `<p>Bonjour ${applicantName},</p><p>Nous avons bien reçu votre candidature pour gérer <strong>${location.name}</strong> sur LoocateMe.</p><p>Notre équipe va examiner vos documents et vous recontactera par email sous peu.</p>`,
    });
  } catch (e) {
    console.warn('[businessClaim] Failed to send acknowledgement email:', e?.message || e);
  }

  return claim;
}

export async function actOnClaimRequest(claimId, { action, rejectionReason, moderatorId }) {
  const claim = await BusinessClaimRequest.findById(claimId);
  if (!claim) {
    throw Object.assign(new Error('Candidature introuvable'), { status: 404, code: 'CLAIM_NOT_FOUND' });
  }
  if (claim.status !== 'pending') {
    throw Object.assign(new Error('Candidature déjà traitée'), { status: 409, code: 'CLAIM_ALREADY_RESOLVED' });
  }

  if (action === 'reject') {
    claim.status = 'rejected';
    claim.reviewedBy = moderatorId;
    claim.reviewedAt = new Date();
    claim.rejectionReason = rejectionReason ? String(rejectionReason) : '';
    await claim.save();
    try {
      await sendMail({
        to: claim.applicantEmail,
        subject: 'Votre candidature LoocateMe Pro',
        text: `Bonjour ${claim.applicantName},
Après examen, nous ne pouvons pas valider votre candidature pour le moment.${claim.rejectionReason ? `\nMotif : ${claim.rejectionReason}` : ''}`,
        html: `<p>Bonjour ${claim.applicantName},</p><p>Après examen, nous ne pouvons pas valider votre candidature pour le moment.</p>${claim.rejectionReason ? `<p>Motif : ${claim.rejectionReason}</p>` : ''}`,
      });
    } catch (e) {
      console.warn('[businessClaim] Failed to send rejection email:', e?.message || e);
    }
    return claim;
  }

  if (action !== 'approve') {
    throw Object.assign(new Error('Action invalide'), { status: 400, code: 'ACTION_INVALID' });
  }

  const existingUser = await User.findOne({ email: claim.applicantEmail }).select('_id').lean();
  if (existingUser) {
    throw Object.assign(new Error('Un compte existe déjà avec cet email'), { status: 409, code: 'EMAIL_TAKEN' });
  }

  const randomPassword = [...Array(32)].map(() => Math.random().toString(36)[2] || '0').join('');
  const user = new User({
    email: claim.applicantEmail,
    password: randomPassword, // hashed by pre-save hook; jamais transmis, remplacé via activation
    name: claim.applicantName,
    username: `pro_${String(claim.locationId).slice(-8)}`,
    firstName: claim.applicantName,
    accountType: 'business',
    role: 'user',
    emailVerified: false,
  });
  await user.save();

  await Location.findByIdAndUpdate(claim.locationId, {
    ownerId: user._id,
    isPro: true,
    status: 'verified',
    businessTier: 'none',
  });

  claim.status = 'approved';
  claim.reviewedBy = moderatorId;
  claim.reviewedAt = new Date();
  claim.createdUserId = user._id;
  await claim.save();

  await requestBusinessActivationEmail(user);

  return claim;
}
