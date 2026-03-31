import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema(
  {
    osmId: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['bar', 'nightclub', 'gym', 'restaurant', 'parc', 'beach', 'amusementPark', 'coffee', 'library', 'sportsCentre', 'bowling', 'education', 'foodCourt', 'cinema', 'theatre', 'communityCentre', 'iceCream', 'socialFacility'], required: true },
    radius: { type: Number, default: 100 }, // Rayon de détection en mètres
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lon, lat]
    },
    popularity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

LocationSchema.index({ location: '2dsphere' });

export const Location = mongoose.model('Location', LocationSchema);
