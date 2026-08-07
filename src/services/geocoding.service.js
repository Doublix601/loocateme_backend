import { User } from '../models/User.js';

// Reverse geocoding via l'API Nominatim d'OpenStreetMap (gratuite, pas de clé
// API). Politique d'usage Nominatim (https://operations.osmfoundation.org/policies/nominatim/) :
// - User-Agent descriptif obligatoire (pas de valeur par défaut générique)
// - Max ~1 requête/seconde
// Ce module ne doit donc JAMAIS être appelé de façon synchrone/bloquante sur
// le hot path du check-in (cf. maybeRefreshCity, appelé en fire-and-forget
// depuis user.service.js/updateLocation), et applique lui-même un throttle
// global minimal en plus du throttle par utilisateur (cf. plus bas).
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'LoocateMe/1.0 (contact: support@loocate.me)';

// Throttle "process-wide" best-effort : garantit qu'on n'envoie jamais plus
// d'une requête par seconde à Nominatim depuis ce process, quel que soit le
// nombre de check-ins simultanés. Ce n'est qu'un filet de sécurité en plus
// du throttle par utilisateur ci-dessous (qui limite déjà énormément le
// volume d'appels) : pas besoin d'une file d'attente distribuée pour ça.
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

async function throttleGlobalRate() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

async function reverseGeocode(lat, lon) {
  await throttleGlobalRate();
  const url = `${NOMINATIM_URL}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json&zoom=10`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  const address = data?.address || {};
  const city = address.city || address.town || address.village || address.municipality || '';
  return city;
}

// Distance haversine simplifiée (mètres) — suffisante pour la décision de
// throttling (précision de l'ordre du mètre non nécessaire ici).
function distanceMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MOVED_THRESHOLD_METERS = 2000; // ~2km
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Règle de throttling (simple et défensive, documentée ici plutôt qu'éclatée
// entre plusieurs endroits) : on ne relance le reverse geocoding que si
//   (a) l'utilisateur n'a encore aucune `city`, OU
//   (b) il s'est déplacé de plus de ~2km depuis les coordonnées du dernier
//       geocoding réussi (`lastGeocodedCoordinates`), OU
//   (c) le dernier geocoding réussi date de plus de 7 jours (cas d'un
//       déplacement lent/local qui ne franchit jamais le seuil de 2km mais
//       finit quand même par changer de ville avec le temps).
// Sinon on ne fait rien : pas d'appel réseau, pas d'écriture DB.
export function shouldRefreshCity(user, lat, lon) {
  if (!user.city) return true;
  const last = user.lastGeocodedCoordinates;
  if (Array.isArray(last) && last.length === 2) {
    const moved = distanceMeters(last, [lon, lat]);
    if (moved > MOVED_THRESHOLD_METERS) return true;
  } else {
    // Pas de coordonnées de référence enregistrées (ex: donnée legacy) : on
    // se base uniquement sur l'ancienneté ci-dessous.
  }
  if (!user.cityUpdatedAt) return true;
  const age = Date.now() - new Date(user.cityUpdatedAt).getTime();
  if (age > STALE_AFTER_MS) return true;
  return false;
}

// Déclenché en fire-and-forget après la réponse au client (cf.
// user.service.js/updateLocation) : ne doit jamais faire planter ni ralentir
// le hot path du check-in. Toute erreur (réseau, parsing, Nominatim down) est
// loggée et avalée.
export async function maybeRefreshCity(userId, lat, lon) {
  try {
    const user = await User.findById(userId).select('city cityUpdatedAt lastGeocodedCoordinates');
    if (!user) return;
    if (!shouldRefreshCity(user, lat, lon)) return;
    const city = await reverseGeocode(lat, lon);
    if (!city) return;
    await User.findByIdAndUpdate(userId, {
      $set: {
        city,
        cityUpdatedAt: new Date(),
        lastGeocodedCoordinates: [lon, lat],
      },
    });
  } catch (e) {
    console.warn('[geocoding] Failed to refresh city for user', String(userId), e?.message || e);
  }
}
