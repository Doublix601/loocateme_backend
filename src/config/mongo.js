import mongoose from 'mongoose';

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL || 'mongodb://127.0.0.1:27017/loocateme';
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      autoIndex: true,
      dbName: undefined,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 50,
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error', err.message);
    process.exit(1);
  }
}
