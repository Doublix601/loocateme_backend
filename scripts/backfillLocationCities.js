// Backfill unique de `Location.city` pour les lieux OSM déjà en base sans ville.
//
// Contexte : jusqu'ici la ville d'un lieu venait uniquement du tag OSM
// `addr:city`, absent sur la majorité des POI OpenStreetMap. Ces lieux ont donc
// `city` vide et l'app ne l'affiche pas. `geocoding.service.js` sait désormais
// compléter la ville par reverse-geocoding Nominatim, regroupé par maille (~2 km)
// et caché, pour respecter la politique d'usage Nominatim (pas de géocodage en
// masse). Ce script rejoue ce backfill sur l'existant, sans plafond de mailles.
//
//   docker exec -w /app loocateme-api node scripts/backfillLocationCities.js
//
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Location } from '../src/models/Location.js';
import { backfillCitiesForLocations } from '../src/services/geocoding.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI =
  process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://mongo:27017/loocateme';

// Curseur par _id croissant : on avance toujours, que la ville ait été trouvée
// ou non. Chaque lot est regroupé par maille par backfillCitiesForLocations,
// donc le nombre d'appels Nominatim reste ~= nombre de mailles distinctes.
const BATCH = 500;

async function run() {
  console.log('--- Backfill Location.city (reverse geocoding) ---');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const baseFilter = {
    osmId: { $exists: true },
    $or: [{ city: { $exists: false } }, { city: '' }],
    'location.coordinates': { $exists: true, $type: 'array' },
  };

  const total = await Location.countDocuments(baseFilter);
  console.log(`${total} lieux sans ville à traiter`);

  let lastId = null;
  let seen = 0;
  while (true) {
    const filter = lastId ? { ...baseFilter, _id: { $gt: lastId } } : baseFilter;
    const batch = await Location.find(filter)
      .select('osmId location.coordinates')
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean();
    if (batch.length === 0) break;

    lastId = batch[batch.length - 1]._id;
    const items = batch.map((l) => ({ osmId: l.osmId, coordinates: l.location?.coordinates }));
    await backfillCitiesForLocations(items, { maxCells: Infinity });

    seen += batch.length;
    const filled = total - (await Location.countDocuments(baseFilter));
    console.log(`  ${seen}/${total} parcourus — ${filled} villes renseignées`);
  }

  await mongoose.disconnect();
  console.log('--- Terminé ---');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
