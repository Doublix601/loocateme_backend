import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../src/models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI;

async function refreshDemoUsers() {
  await mongoose.connect(MONGO_URI);
  const future = new Date(Date.now() + 6 * 60 * 60 * 1000); // stays visible 6h
  const result = await User.updateMany(
    { email: /^seed\.demo\.\d+@loocateme\.local$/ },
    { $set: { 'location.updatedAt': new Date(), boostUntil: future } }
  );
  console.log('Comptes de démo rafraîchis:', result.modifiedCount);
  await mongoose.disconnect();
}

refreshDemoUsers();
