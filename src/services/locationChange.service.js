import { LocationChangeRequest } from '../models/LocationChangeRequest.js';
import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { sendMail } from './email.service.js';
import { invalidateLocationDetailCache } from '../controllers/location.controller.js';

const WEBSITE_BASE_URL = process.env.PUBLIC_WEBSITE_URL || 'https://pro.loocate.me';

// location.name vient d'OSM (non fiable) : à échapper avant toute
// interpolation HTML, et les retours ligne à retirer du sujet (en-tête mail).
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHeaderValue(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ');
}

// Compare les champs OSM synchronisables aux valeurs actuelles d'un lieu déjà
// revendiqué (isPro). Si différence, crée (ou met à jour) une demande de
// changement en attente et prévient le gérant, au lieu d'écraser directement
// le lieu — cf. scripts/syncLocations.js.
export async function proposeOsmChange(location, incoming) {
  const changes = {};
  const previous = {};

  if (incoming.name && incoming.name !== location.name) {
    changes.name = incoming.name;
    previous.name = location.name;
  }
  if (incoming.city !== undefined && incoming.city !== location.city) {
    changes.city = incoming.city;
    previous.city = location.city;
  }
  const [lon, lat] = incoming.location?.coordinates || [];
  const [curLon, curLat] = location.location?.coordinates || [];
  if (lon !== undefined && lat !== undefined && (lon !== curLon || lat !== curLat)) {
    changes.location = { type: 'Point', coordinates: [lon, lat] };
    previous.location = { type: 'Point', coordinates: [curLon, curLat] };
  }

  if (Object.keys(changes).length === 0) {
    return null; // rien à valider
  }

  const existingPending = await LocationChangeRequest.findOne({
    locationId: location._id,
    status: 'pending',
  });
  if (existingPending) {
    existingPending.proposedChanges = changes;
    existingPending.previousValues = previous;
    await existingPending.save();
    return existingPending;
  }

  const changeRequest = await LocationChangeRequest.create({
    locationId: location._id,
    proposedChanges: changes,
    previousValues: previous,
  });

  await notifyOwner(location, changeRequest);

  return changeRequest;
}

async function notifyOwner(location, changeRequest) {
  if (!location.ownerId) return;
  try {
    const owner = await User.findById(location.ownerId).select('email').lean();
    if (!owner?.email) return;
    const dashboardUrl = `${WEBSITE_BASE_URL}/dashboard`;
    const safeName = escapeHtml(location.name);
    const subjectName = sanitizeHeaderValue(location.name);
    await sendMail({
      to: owner.email,
      subject: `Une modification a été détectée sur la fiche de "${subjectName}"`,
      text: `Bonjour,
Une mise à jour a été détectée sur OpenStreetMap pour votre établissement "${location.name}".
Pour votre sécurité, cette modification n'est PAS appliquée automatiquement : merci de la valider ou de la rejeter depuis votre espace pro.
${dashboardUrl}

Si vous n'êtes pas à l'origine de cette modification, vous pouvez simplement la rejeter.`,
      html: `<p>Bonjour,</p><p>Une mise à jour a été détectée sur OpenStreetMap pour votre établissement <strong>${safeName}</strong>.</p><p>Pour votre sécurité, cette modification n'est <strong>pas appliquée automatiquement</strong> : merci de la valider ou de la rejeter depuis votre espace pro.</p><p><a href="${dashboardUrl}">Accéder à mon espace pro</a></p><p>Si vous n'êtes pas à l'origine de cette modification, vous pouvez simplement la rejeter.</p>`,
    });
  } catch (e) {
    console.warn('[locationChange] Failed to send notification email:', e?.message || e);
  }
}

export async function getPendingChangeForLocation(locationId) {
  return LocationChangeRequest.findOne({ locationId, status: 'pending' }).lean();
}

export async function reviewChangeRequest(changeRequestId, ownerId, decision) {
  const changeRequest = await LocationChangeRequest.findById(changeRequestId);
  if (!changeRequest) {
    throw Object.assign(new Error('Demande introuvable'), { status: 404, code: 'CHANGE_REQUEST_NOT_FOUND' });
  }
  if (changeRequest.status !== 'pending') {
    throw Object.assign(new Error('Cette demande a déjà été traitée'), { status: 409, code: 'CHANGE_REQUEST_ALREADY_REVIEWED' });
  }
  const location = await Location.findById(changeRequest.locationId);
  if (!location || String(location.ownerId) !== String(ownerId)) {
    throw Object.assign(new Error('Vous ne gérez pas ce lieu'), { status: 403, code: 'FORBIDDEN' });
  }

  if (decision === 'approve') {
    Object.assign(location, changeRequest.proposedChanges);
    await location.save({ validateModifiedOnly: true });
    await invalidateLocationDetailCache(location._id);
  }

  changeRequest.status = decision === 'approve' ? 'approved' : 'rejected';
  changeRequest.reviewedAt = new Date();
  await changeRequest.save();

  return changeRequest;
}


// --- Corrections proposées par les utilisateurs (in-app), flux modération ---

const VALID_LOCATION_TYPES = [
  'Café ☕', 'Coworking 🧑‍💻', 'Salle de sport 🏋️', 'Centre sportif 🏟️',
  'Parc 🌳', 'Plage 🏖️', "Parc d'attractions 🎢", 'Bibliothèque 📚',
  'Éducation 🎓', 'Glacier 🍦', 'Marché 🛒', 'Musée 🏛️', 'Brunch 🥞',
  'Bar 🍺', 'Boîte de nuit 💃', 'Restaurant 🍴', 'Cinéma 🎬', 'Loisir 🎯',
  'Rooftop 🌆', 'Karaoké 🎤', 'Club de jeux 🎮',
];

export async function proposeUserCorrection(locationId, userId, { name, type, reason } = {}) {
  const location = await Location.findById(locationId);
  if (!location) {
    throw Object.assign(new Error('Lieu introuvable'), { status: 404, code: 'LOCATION_NOT_FOUND' });
  }
  const changes = {};
  const previous = {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName && trimmedName !== location.name) {
    changes.name = trimmedName;
    previous.name = location.name;
  }
  if (type && type !== location.type) {
    if (!VALID_LOCATION_TYPES.includes(type)) {
      throw Object.assign(new Error('Type de lieu invalide'), { status: 400, code: 'INVALID_TYPE' });
    }
    changes.type = type;
    previous.type = location.type;
  }
  if (Object.keys(changes).length === 0) {
    throw Object.assign(new Error('Aucune modification proposée'), { status: 400, code: 'NO_CHANGE' });
  }
  const safeReason = String(reason || '').slice(0, 500);

  const existing = await LocationChangeRequest.findOne({
    locationId,
    submittedBy: userId,
    source: 'user_report',
    status: 'pending',
  });
  if (existing) {
    existing.proposedChanges = changes;
    existing.previousValues = previous;
    existing.reason = safeReason;
    await existing.save();
    return existing;
  }
  return LocationChangeRequest.create({
    locationId,
    proposedChanges: changes,
    previousValues: previous,
    source: 'user_report',
    submittedBy: userId,
    reason: safeReason,
  });
}

export async function listPendingUserCorrections() {
  return LocationChangeRequest.find({ source: 'user_report', status: 'pending' })
    .populate('locationId', 'name city type isPro')
    .populate('submittedBy', 'username')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

export async function reviewUserCorrection(changeRequestId, decision) {
  const cr = await LocationChangeRequest.findById(changeRequestId);
  if (!cr) {
    throw Object.assign(new Error('Demande introuvable'), { status: 404, code: 'CHANGE_REQUEST_NOT_FOUND' });
  }
  if (cr.status !== 'pending') {
    throw Object.assign(new Error('Cette demande a déjà été traitée'), { status: 409, code: 'CHANGE_REQUEST_ALREADY_REVIEWED' });
  }
  if (decision === 'approve') {
    const location = await Location.findById(cr.locationId);
    if (location) {
      const applied = {};
      if (cr.proposedChanges.name) applied.name = cr.proposedChanges.name;
      if (cr.proposedChanges.type) applied.type = cr.proposedChanges.type;
      Object.assign(location, applied);
      await location.save({ validateModifiedOnly: true });
      await invalidateLocationDetailCache(location._id);
    }
  }
  cr.status = decision === 'approve' ? 'approved' : 'rejected';
  cr.reviewedAt = new Date();
  await cr.save();
  return cr;
}
