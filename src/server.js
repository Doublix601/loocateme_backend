import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectMongo } from './config/mongo.js';
import { redisClient } from './config/redis.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import profileRoutes from './routes/profile.routes.js';
import socialRoutes from './routes/social.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import gdprRoutes from './routes/gdpr.routes.js';
import { errorHandler, notFound } from './middlewares/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy so req.protocol respects X-Forwarded-Proto (useful behind reverse proxies)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: ORIGIN === '*' ? true : ORIGIN, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (profile images)
const uploadsDir = process.env.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, '..', uploadsDir)));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/gdpr', gdprRoutes);

// 404 and error
app.use(notFound);
app.use(errorHandler);

// Start server after DB connections
(async () => {
  await connectMongo();
  // Ensure indexes are created (notably 2dsphere on location)
  try {
    const { User } = await import('./models/User.js');
    await User.createIndexes();
    console.log('MongoDB indexes ensured for User');
  } catch (e) {
    console.warn('Failed to ensure MongoDB indexes for User:', e?.message || e);
  }
  await redisClient.connect().catch(() => {
    console.warn('Redis connection failed. Continuing without Redis.');
  });
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
