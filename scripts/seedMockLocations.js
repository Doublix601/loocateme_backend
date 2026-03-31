import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Location } from '../src/models/Location.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://localhost:27017/loocateme';

/**
 * Generates a point at a given distance from a center point in a random direction.
 * @param {number} centerLon
 * @param {number} centerLat
 * @param {number} distanceInKm
 * @returns {[number, number]} [lon, lat]
 */
function getRandomPointAtDistance(centerLon, centerLat, distanceInKm) {
  const R = 6371; // Earth radius in km
  const angle = Math.random() * 2 * Math.PI;
  const dLat = (distanceInKm / R) * (180 / Math.PI);
  const dLon = (distanceInKm / (R * Math.cos((Math.PI * centerLat) / 180))) * (180 / Math.PI);

  const lat = centerLat + dLat * Math.sin(angle);
  const lon = centerLon + dLon * Math.cos(angle);

  return [parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))];
}

const centerLon = 2.808218;
const centerLat = 49.401037;

const testLocations = [
  { name: 'Point Central', type: 'bar', coordinates: [centerLon, centerLat], popularity: 50, radius: 100 },
  { name: 'Parc de la Ville', type: 'parc', coordinates: getRandomPointAtDistance(centerLon, centerLat, 0.5), popularity: 30, radius: 300 },
  { name: 'Plage du Nord', type: 'beach', coordinates: getRandomPointAtDistance(centerLon, centerLat, 5), popularity: 15, radius: 500 },
  { name: 'Disney-like', type: 'amusementPark', coordinates: getRandomPointAtDistance(centerLon, centerLat, 15), popularity: 100, radius: 1000 },
  { name: 'Café des Arts', type: 'coffee', coordinates: getRandomPointAtDistance(centerLon, centerLat, 0.2), popularity: 25, radius: 50 },
  { name: 'Médiathèque', type: 'library', coordinates: getRandomPointAtDistance(centerLon, centerLat, 0.8), popularity: 10, radius: 150 },
  { name: 'Point 100m', type: 'restaurant', coordinates: getRandomPointAtDistance(centerLon, centerLat, 0.1), popularity: 20, radius: 50 },
  { name: 'Point 1km', type: 'gym', coordinates: getRandomPointAtDistance(centerLon, centerLat, 1), popularity: 10, radius: 200 },
  { name: 'Point 10km', type: 'nightclub', coordinates: getRandomPointAtDistance(centerLon, centerLat, 10), radius: 300 },
  { name: 'Point 11km', type: 'bar', coordinates: getRandomPointAtDistance(centerLon, centerLat, 11), radius: 100 },
  { name: 'Chez Charles', type: 'restaurant', coordinates: [2.8309011459350586, 49.41493606567383], popularity: 0, radius: 150 },
  { name: 'Chez Nono', type: 'bar', coordinates: [2.822065, 49.413995], popularity: 0, radius: 100 },
];

async function seedMockLocations() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    for (const loc of testLocations) {
      await Location.updateOne(
        { name: loc.name },
        {
          $set: {
            name: loc.name,
            type: loc.type,
            radius: loc.radius || 100,
            location: {
              type: 'Point',
              coordinates: loc.coordinates,
            },
            popularity: loc.popularity || 0,
          },
        },
        { upsert: true }
      );
      console.log(`Seeded: ${loc.name} (popularity: ${loc.popularity || 0}, radius: ${loc.radius || 100}m)`);
    }
  } catch (error) {
    console.error('Error seeding mock locations:', error);
  } finally {
    await mongoose.disconnect();
  }
}

seedMockLocations();
