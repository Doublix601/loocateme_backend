import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query restricted to Compiègne area (around 5km for a tight fit)
// Includes bar, nightclub, gym, restaurant, park, beach, amusement_park, coffee, library, education, cinema, ice_cream, sports_centre, bowling
const query = `
[out:json];
(
  node["amenity"~"bar|nightclub|library|university|college|cinema|ice_cream"](around:5000, 49.4179497, 2.8263171);
  node["leisure"~"fitness_centre|beach_resort|theme_park|sports_centre|bowling_alley|park|escape_game|laser_tag|adult_gaming_centre"](around:5000, 49.4179497, 2.8263171);
  node["shop"~"marketplace"](around:5000, 49.4179497, 2.8263171);
  node["tourism"~"museum"](around:5000, 49.4179497, 2.8263171);
  node["sport"~"karting"](around:5000, 49.4179497, 2.8263171);
  way["amenity"~"bar|nightclub|library|university|college|cinema|ice_cream"](around:5000, 49.4179497, 2.8263171);
  way["leisure"~"fitness_centre|beach_resort|theme_park|sports_centre|bowling_alley|park|escape_game|laser_tag|adult_gaming_centre"](around:5000, 49.4179497, 2.8263171);
  way["shop"~"marketplace"](around:5000, 49.4179497, 2.8263171);
  way["tourism"~"museum"](around:5000, 49.4179497, 2.8263171);
  way["sport"~"karting"](around:5000, 49.4179497, 2.8263171);
);
out center;
`;

async function syncLocationsCompiegne() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    console.log('Fetching POIs for Compiègne from Overpass API...');
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
    console.log(`Found ${data.elements.length} elements in Compiègne.`);

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

    if (ops.length > 0) {
      const result = await Location.bulkWrite(ops);
      console.log(`Sync for Compiègne completed: ${result.upsertedCount} new, ${result.modifiedCount} updated.`);
    } else {
      console.log('No elements to sync for Compiègne.');
    }

    // Delete OSM locations that no longer exist in Overpass results
    const activeOsmIds = data.elements.map((el) => el.id);
    const staleDelete = await Location.deleteMany({
      osmId: { $exists: true, $nin: activeOsmIds },
    });
    console.log(`Deleted ${staleDelete.deletedCount} stale OSM locations no longer in Overpass.`);
  } catch (error) {
    console.error('Error syncing locations for Compiègne:', error);
  } finally {
    await mongoose.disconnect();
  }
}

syncLocationsCompiegne();
