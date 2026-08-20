import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';
import { proposeOsmChange } from '../src/services/locationChange.service.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query for bar, nightclub, gym, restaurant, park, beach, amusement_park, coffee, library, education, cinema, ice_cream, sports_centre, bowling
// Compiègne area (around 10km)
const query = `
[out:json];
(
  node["amenity"~"bar|nightclub|library|university|college|cinema|ice_cream"](around:10000, 49.4178, 2.8261);
  node["leisure"~"fitness_centre|beach_resort|theme_park|sports_centre|bowling_alley|park|escape_game|laser_tag|adult_gaming_centre"](around:10000, 49.4178, 2.8261);
  node["shop"~"marketplace"](around:10000, 49.4178, 2.8261);
  node["tourism"~"museum"](around:10000, 49.4178, 2.8261);
  node["sport"~"karting"](around:10000, 49.4178, 2.8261);
  way["amenity"~"bar|nightclub|library|university|college|cinema|ice_cream"](around:10000, 49.4178, 2.8261);
  way["leisure"~"fitness_centre|beach_resort|theme_park|sports_centre|bowling_alley|park|escape_game|laser_tag|adult_gaming_centre"](around:10000, 49.4178, 2.8261);
  way["shop"~"marketplace"](around:10000, 49.4178, 2.8261);
  way["tourism"~"museum"](around:10000, 49.4178, 2.8261);
  way["sport"~"karting"](around:10000, 49.4178, 2.8261);
);
out center;
`;

async function syncLocations() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    console.log('Fetching POIs from Overpass API...');
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      // Le serveur Overpass (Apache) répond 406 Not Acceptable aux requêtes sans
      // User-Agent explicite (absent par défaut du fetch de Node).
      headers: { 'User-Agent': 'loocateme-sync-script/1.0' },
      body: 'data=' + encodeURIComponent(query),
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Found ${data.elements.length} elements.`);

    // Cleanup manual locations and excluded locations
    console.log('Cleaning up manual and excluded locations...');
    const deleteResult = await Location.deleteMany({
      $or: [
        { osmId: { $exists: false }, stars: { $lt: 3 } },
        { name: 'Unknown' },
        { shouldDelete: true },
        // Types OSM devenus obsolètes/désactivés : uniquement les lieux synchronisés
        // depuis OSM (osmId présent), jamais les lieux créés par des pros.
        { osmId: { $exists: true }, type: { $in: ['THEATRE', 'COMMUNITYCENTRE', 'SOCIALFACILITY', 'theatre', 'communityCentre', 'socialFacility', 'Fast food 🍔'] } },
      ],
    });
    console.log(`Deleted ${deleteResult.deletedCount} locations.`);

    // Lieux déjà revendiqués par un pro : leurs champs ne doivent jamais être
    // écrasés silencieusement par la sync OSM (cf. proposeOsmChange), pour
    // éviter qu'une modification malveillante sur OSM ne change les
    // informations d'un établissement sans validation du gérant.
    const proLocationsByOsmId = new Map();
    const proLocations = await Location.find({ osmId: { $exists: true }, isPro: true }).select('osmId name city location ownerId');
    for (const loc of proLocations) {
      if (loc.osmId !== undefined && loc.osmId !== null) proLocationsByOsmId.set(loc.osmId, loc);
    }

    const ops = data.elements
      .filter((el) => {
        const name = el.tags.name || 'Unknown';
        const amenity = el.tags.amenity;
        const leisure = el.tags.leisure;
        if (name === 'Unknown') return false;
        if (['theatre', 'community_centre', 'social_facility', 'restaurant', 'cafe'].includes(amenity)) return false;
        return true;
      })
      .map((el) => {
        let type = null;
        const amenity = el.tags.amenity;
        const leisure = el.tags.leisure;
        const shop = el.tags.shop;
        const tourism = el.tags.tourism;
        const sport = el.tags.sport;

        if (amenity === 'bar') type = 'Bar 🍺';
        else if (amenity === 'nightclub') type = 'Boîte de nuit 💃';
        else if (leisure === 'fitness_centre') type = 'Salle de sport 🏋️';
        else if (leisure === 'beach_resort') type = 'Plage 🏖️';
        else if (leisure === 'theme_park') type = 'Parc d\'attractions 🎢';
        else if (amenity === 'library') type = 'Bibliothèque 📚';
        else if (leisure === 'sports_centre') type = 'Centre sportif 🏟️';
        else if (amenity === 'university' || amenity === 'college') type = 'Éducation 🎓';
        else if (amenity === 'cinema') type = 'Cinéma 🎬';
        else if (amenity === 'ice_cream') type = 'Glacier 🍦';
        else if (shop === 'marketplace') type = 'Marché 🛒';
        else if (tourism === 'museum') type = 'Musée 🏛️';
        else if (leisure === 'park') type = 'Parc 🌳';
        // Loisir 🎯 : bowling, karting, escape game, laser game, arcade — mode nuit exclusivement.
        else if (leisure === 'bowling_alley' || leisure === 'escape_game' || leisure === 'laser_tag' || leisure === 'adult_gaming_centre' || sport === 'karting')
          type = 'Loisir 🎯';

        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        const name = el.tags.name;
        const city = el.tags['addr:city'] || '';
        const osmId = el.id;

        if (!type) return null;

        // Lieu déjà revendiqué par un pro : ne pas écraser directement, on
        // met la modification en attente de validation par le gérant.
        if (proLocationsByOsmId.has(osmId)) {
          return {
            pending: true,
            location: proLocationsByOsmId.get(osmId),
            incoming: { name, city, location: { type: 'Point', coordinates: [lon, lat] } },
          };
        }

        return {
          updateOne: {
            filter: {
              osmId: osmId,
            },
            update: {
              $set: {
                osmId: osmId,
                name: name,
                city: city,
                type: type,
                location: {
                  type: 'Point',
                  coordinates: [lon, lat],
                },
              },
            },
            upsert: true,
          },
        };
      })
      .filter((op) => op !== null);

    const pendingOps = ops.filter((op) => op.pending);
    const bulkOps = ops.filter((op) => !op.pending);

    if (bulkOps.length > 0) {
      const result = await Location.bulkWrite(bulkOps);
      console.log(`Sync completed: ${result.upsertedCount} new, ${result.modifiedCount} updated.`);
    } else {
      console.log('No elements to sync.');
    }

    if (pendingOps.length > 0) {
      console.log(`Detected ${pendingOps.length} OSM change(s) on claimed pro locations, submitting for owner validation...`);
      for (const { location, incoming } of pendingOps) {
        try {
          const changeRequest = await proposeOsmChange(location, incoming);
          if (changeRequest) console.log(`  -> Pending change request created for "${location.name}" (${location._id}).`);
        } catch (e) {
          console.error(`  -> Failed to propose OSM change for "${location.name}":`, e?.message || e);
        }
      }
    }

    // Delete OSM locations that no longer exist in Overpass results
    const activeOsmIds = data.elements.map((el) => el.id);
    const staleDelete = await Location.deleteMany({
      osmId: { $exists: true, $nin: activeOsmIds },
      isPro: { $ne: true },
    });
    console.log(`Deleted ${staleDelete.deletedCount} stale OSM locations no longer in Overpass.`);
  } catch (error) {
    console.error('Error syncing locations:', error);
  } finally {
    await mongoose.disconnect();
  }
}

syncLocations();
