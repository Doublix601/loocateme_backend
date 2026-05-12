import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query for bar, nightclub, gym, restaurant, park, beach, amusement_park, coffee, library, education, food_court, cinema, ice_cream, sports_centre, bowling
// Compiègne area (around 10km)
const query = `
[out:json];
(
  node["amenity"~"bar|nightclub|library|university|college|food_court|cinema|ice_cream"](around:10000, 49.4178, 2.8261);
  node["leisure"~"fitness_centre|beach_resort|theme_park|sports_centre|bowling_alley"](around:10000, 49.4178, 2.8261);
  way["amenity"~"bar|nightclub|library|university|college|food_court|cinema|ice_cream"](around:10000, 49.4178, 2.8261);
  way["leisure"~"fitness_centre|beach_resort|theme_park|sports_centre|bowling_alley"](around:10000, 49.4178, 2.8261);
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
        { type: { $in: ['THEATRE', 'COMMUNITYCENTRE', 'SOCIALFACILITY', 'theatre', 'communityCentre', 'socialFacility', 'Restaurant 🍴', 'Parc 🌳', 'Café ☕'] } },
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
        if (leisure === 'park') return false;
        return true;
      })
      .map((el) => {
        let type = null;
        const amenity = el.tags.amenity;
        const leisure = el.tags.leisure;

        if (amenity === 'bar') type = 'Bar 🍺';
        else if (amenity === 'nightclub') type = 'Boîte de nuit 💃';
        else if (leisure === 'fitness_centre') type = 'Salle de sport 🏋️';
        else if (leisure === 'beach_resort') type = 'Plage 🏖️';
        else if (leisure === 'theme_park') type = 'Parc d\'attractions 🎢';
        else if (amenity === 'library') type = 'Bibliothèque 📚';
        else if (leisure === 'sports_centre') type = 'Centre sportif 🏟️';
        else if (leisure === 'bowling_alley') type = 'Bowling 🎳';
        else if (amenity === 'university' || amenity === 'college') type = 'Éducation 🎓';
        else if (amenity === 'food_court') type = 'Fast food 🍔';
        else if (amenity === 'cinema') type = 'Cinéma 🎬';
        else if (amenity === 'ice_cream') type = 'Glacier 🍦';

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
      console.log(`Sync completed: ${result.upsertedCount} new, ${result.modifiedCount} updated.`);
    } else {
      console.log('No elements to sync.');
    }
  } catch (error) {
    console.error('Error syncing locations:', error);
  } finally {
    await mongoose.disconnect();
  }
}

syncLocations();
