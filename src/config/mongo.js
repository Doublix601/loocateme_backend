import mongoose from 'mongoose';

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL || 'mongodb://127.0.0.1:27017/loocateme';
  mongoose.set('strictQuery', true);

  const maxDelay = 30000; // 30s cap
  let attempt = 0;

  while (true) {
    try {
      attempt += 1;
      await mongoose.connect(uri, {
        autoIndex: true,
        dbName: undefined,
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 50,
      });
      console.log('MongoDB connected');
      return;
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, Math.min(attempt, 5)), maxDelay);
      console.error(`MongoDB connection error (attempt ${attempt}): ${err?.message || err}. Retrying in ${Math.round(delay/1000)}s...`);
      // Do not crash the process; wait and retry
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
