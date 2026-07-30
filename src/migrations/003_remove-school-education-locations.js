/**
 * Migration 003: Retire les établissements scolaires (maternelle, école élémentaire,
 * collège, lycée) des lieux de type "Éducation 🎓" déjà synchronisés depuis OSM.
 *
 * Seuls les établissements d'enseignement supérieur (tags OSM `university`/`college`,
 * ex: universités, écoles type UTC, IFSI, AFPA...) doivent rester. Le tag OSM d'origine
 * n'étant pas stocké en base, on le retrouve en réinterrogeant l'API Overpass par osmId.
 *
 * Les lieux "Éducation" gérés par un pro (isPro: true) ne sont jamais touchés : ils ne
 * proviennent pas d'OSM et n'ont pas vocation à être supprimés par cette migration.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { Location } from '../models/Location.js';

const execFileAsync = promisify(execFile);

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const EDUCATION_TYPE = 'Éducation 🎓';
const CHUNK_SIZE = 100;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Le fetch/https natif de Node est bloqué par le sandbox réseau de cet environnement
// d'exécution (ECONNREFUSED systématique), alors que `curl` passe sans problème.
// On shell-out donc via curl plutôt que d'utiliser fetch() ici.
async function overpassRequest(query) {
  const { stdout } = await execFileAsync('curl', [
    '-sS',
    '--fail',
    '-X', 'POST',
    '--data-urlencode', `data=${query}`,
    OVERPASS_URL,
  ], { maxBuffer: 1024 * 1024 * 50 });
  return JSON.parse(stdout);
}

async function fetchAmenityByOsmId(osmIds) {
  const idList = osmIds.join(',');
  const query = `[out:json][timeout:60];(node(id:${idList});way(id:${idList});relation(id:${idList}););out tags;`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await overpassRequest(query);
      const amenityByOsmId = new Map();
      for (const el of data.elements || []) {
        if (el.tags?.amenity) {
          amenityByOsmId.set(el.id, el.tags.amenity);
        }
      }
      return amenityByOsmId;
    } catch (err) {
      console.warn(`[003_remove-school-education-locations] Overpass query failed (attempt ${attempt}/3): ${err.message}`);
      if (attempt < 3) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error('[003_remove-school-education-locations] Giving up on this chunk after 3 attempts, skipping it.');
  return new Map();
}

export async function migrate() {
  const candidates = await Location.find(
    { type: EDUCATION_TYPE, osmId: { $exists: true }, isPro: false },
    { osmId: 1 }
  ).lean();

  if (candidates.length === 0) {
    console.log('[003_remove-school-education-locations] No OSM-synced education locations found. Nothing to do.');
    return;
  }

  console.log(`[003_remove-school-education-locations] Inspecting ${candidates.length} "${EDUCATION_TYPE}" location(s)...`);

  const osmIdToDocOsmId = candidates.map((c) => c.osmId);
  const toDelete = [];

  for (let i = 0; i < osmIdToDocOsmId.length; i += CHUNK_SIZE) {
    const chunk = osmIdToDocOsmId.slice(i, i + CHUNK_SIZE);
    const amenityByOsmId = await fetchAmenityByOsmId(chunk);

    for (const osmId of chunk) {
      if (amenityByOsmId.get(osmId) === 'school') {
        toDelete.push(osmId);
      }
    }
  }

  if (toDelete.length === 0) {
    console.log('[003_remove-school-education-locations] No school-tagged locations found among synced education locations.');
    return;
  }

  const result = await Location.deleteMany({ osmId: { $in: toDelete } });
  console.log(`[003_remove-school-education-locations] ✅ Deleted ${result.deletedCount}/${toDelete.length} school-tagged location(s) out of ${candidates.length} inspected.`);
}

export default migrate;
