import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL || 'mongodb://127.0.0.1:27017/loocateme';

async function run() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const users = db.collection('users');

  // Ensure geospatial index
  await users.createIndex({ location: '2dsphere' });
  await users.createIndex({ email: 1 }, { unique: true });

  console.log('Indexes ensured on users collection');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
