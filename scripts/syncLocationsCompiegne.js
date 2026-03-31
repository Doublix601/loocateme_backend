import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query restricted to Compiègne area (around 5km for a tight fit)
// Includes bar, nightclub, gym, restaurant, park, beach, amusement_park, coffee, library, education, food_court, cinema, ice_cream, sports_centre, bowling
const query = `
[out:json];
(
  node["amenity"~"bar|nightclub|restaurant|cafe|library|university|college|food_court|cinema|ice_cream"](around:5000, 49.4179497, 2.8263171);
  node["leisure"~"fitness_centre|park|beach_resort|theme_park|sports_centre|bowling_alley"](around:5000, 49.4179497, 2.8263171);
  way["amenity"~"bar|nightclub|restaurant|cafe|library|university|college|food_court|cinema|ice_cream"](around:5000, 49.4179497, 2.8263171);
  way["leisure"~"fitness_centre|park|beach_resort|theme_park|sports_centre|bowling_alley"](around:5000, 49.4179497, 2.8263171);
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
      body: 'data=' + encodeURIComponent(query),
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Found ${data.elements.length} elements in Compiègne.`);

    // Cleanup excluded locations
    console.log('Cleaning up excluded locations (Unknown name or excluded categories)...');
    const deleteResult = await Location.deleteMany({
      $or: [
        { name: 'Unknown' },
        { type: { $in: ['THEATRE', 'COMMUNITYCENTRE', 'SOCIALFACILITY', 'theatre', 'communityCentre', 'socialFacility'] } },
      ],
    });
    console.log(`Deleted ${deleteResult.deletedCount} excluded locations.`);

    const ops = data.elements
      .filter((el) => {
        const name = el.tags.name || 'Unknown';
        const amenity = el.tags.amenity;
        if (name === 'Unknown') return false;
        if (['theatre', 'community_centre', 'social_facility'].includes(amenity)) return false;
        return true;
      })
      .map((el) => {
        let type = 'Restaurant 🍴';
        const amenity = el.tags.amenity;
        const leisure = el.tags.leisure;

        if (amenity === 'bar') type = 'Bar 🍺';
        else if (amenity === 'nightclub') type = 'Boîte de nuit 💃';
        else if (leisure === 'fitness_centre') type = 'Salle de sport 🏋️';
        else if (amenity === 'restaurant') type = 'Restaurant 🍴';
        else if (leisure === 'park') type = 'Parc 🌳';
        else if (leisure === 'beach_resort') type = 'Plage 🏖️';
        else if (leisure === 'theme_park') type = 'Parc d\'attractions 🎢';
        else if (amenity === 'cafe') type = 'Café ☕';
        else if (amenity === 'library') type = 'Bibliothèque 📚';
        else if (leisure === 'sports_centre') type = 'Centre sportif 🏟️';
        else if (leisure === 'bowling_alley') type = 'Bowling 🎳';
        else if (amenity === 'university' || amenity === 'college') type = 'Éducation 🎓';
        else if (amenity === 'food_court') type = 'Espace restauration 🍱';
        else if (amenity === 'cinema') type = 'Cinéma 🎬';
        else if (amenity === 'ice_cream') type = 'Glacier 🍦';

        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        const name = el.tags.name;
        const city = el.tags['addr:city'] || '';
        const osmId = el.id;

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
      });

    if (ops.length > 0) {
      const result = await Location.bulkWrite(ops);
      console.log(`Sync for Compiègne completed: ${result.upsertedCount} new, ${result.modifiedCount} updated.`);
    } else {
      console.log('No elements to sync for Compiègne.');
    }
  } catch (error) {
    console.error('Error syncing locations for Compiègne:', error);
  } finally {
    await mongoose.disconnect();
  }
}

syncLocationsCompiegne();
