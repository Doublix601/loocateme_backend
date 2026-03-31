import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/loocateme';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query for bar, nightclub, gym, restaurant in Compiègne area (around 10km)
const query = `
[out:json];
(
  node["amenity"~"bar|nightclub|restaurant"](around:10000, 49.4178, 2.8261);
  node["leisure"~"fitness_centre"](around:10000, 49.4178, 2.8261);
  way["amenity"~"bar|nightclub|restaurant"](around:10000, 49.4178, 2.8261);
  way["leisure"~"fitness_centre"](around:10000, 49.4178, 2.8261);
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

    const ops = data.elements.map((el) => {
      let type = 'restaurant';
      const amenity = el.tags.amenity;
      const leisure = el.tags.leisure;

      if (amenity === 'bar') type = 'bar';
      else if (amenity === 'nightclub') type = 'nightclub';
      else if (leisure === 'fitness_centre') type = 'gym';
      else if (amenity === 'restaurant') type = 'restaurant';

      const lat = el.lat || el.center?.lat;
      const lon = el.lon || el.center?.lon;
      const name = el.tags.name || 'Unknown';

      return {
        updateOne: {
          filter: {
            name: name,
            'location.coordinates': [lon, lat],
          },
          update: {
            $set: {
              name: name,
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
