import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectMongo } from './config/mongo.js';
import { ensureDefaultFlags } from './models/FeatureFlag.js';
import { redisClient } from './config/redis.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import profileRoutes from './routes/profile.routes.js';
import socialRoutes from './routes/social.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import gdprRoutes from './routes/gdpr.routes.js';
import adminRoutes from './routes/admin.routes.js';
import eventsRoutes from './routes/events.routes.js';
import statsRoutes from './routes/stats.routes.js';
import pushRoutes from './routes/push.routes.js';
import premiumRoutes from './routes/premium.routes.js';
import proxyRoutes from './routes/proxy.routes.js';
import reportRoutes from './routes/report.routes.js';
import blocksRoutes from './routes/blocks.routes.js';
import followRoutes from './routes/follow.routes.js';
import { errorHandler, notFound } from './middlewares/error.js';
import { verifyMailTransport } from './services/email.service.js';
import { CronService } from './services/cron.service.js';

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
app.use('/api/admin', adminRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/follow', followRoutes);

// 404 and error
app.use(notFound);
app.use(errorHandler);

// Start server after DB connections
(async () => {
  await connectMongo();
  // Ensure default feature flags exist
  try {
    await ensureDefaultFlags();
    console.log('Feature flags ensured');
  } catch (e) {
    console.warn('Failed to ensure feature flags:', e?.message || e);
  }
  // Ensure indexes are created (notably 2dsphere on location)
  try {
    const { User } = await import('./models/User.js');
    await User.createIndexes();
    // Verify geospatial index exists on `location`
    const indexes = await User.collection.indexes();
    const hasLocationIndex = indexes.some((i) => i.key && i.key.location === '2dsphere');
    if (!hasLocationIndex) {
      await User.collection.createIndex({ location: '2dsphere' }, { name: 'location_2dsphere' });
      console.log('Created missing 2dsphere index on `location`');
    }
    // Optionally drop wrong index on `location.coordinates` if present (not used by $near on GeoJSON)
    const wrongIdx = indexes.find((i) => i.key && i.key['location.coordinates'] === '2dsphere');
    if (wrongIdx) {
      try {
        await User.collection.dropIndex(wrongIdx.name || 'location.coordinates_2dsphere');
        console.log('Dropped incorrect 2dsphere index on `location.coordinates`');
      } catch (dropErr) {
        console.warn('Could not drop incorrect `location.coordinates` index:', dropErr?.message || dropErr);
      }
    }
    console.log('MongoDB indexes ensured for User');
  } catch (e) {
    console.warn('Failed to ensure MongoDB indexes for User:', e?.message || e);
  }
  await redisClient.connect().catch(() => {
    console.warn('Redis connection failed. Continuing without Redis.');
  });
  // Verify SMTP transport at startup to surface configuration issues early
  try {
    const res = await verifyMailTransport();
    if (!res.ok) {
      console.warn('[email] SMTP not ready:', res.error);
    }
  } catch (e) {
    console.warn('[email] SMTP verification threw:', e?.message || e);
  }
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
